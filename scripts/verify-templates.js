import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { generate } from '../src/generate.js';
import { presets, projectSelections } from '../src/templates.js';

// Install and execute generated manifests rather than only checking their text.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this verification via npm run test:templates.');
const root = await mkdtemp(path.join(process.cwd(), '.hypercode-verify-'));
function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 1_800_000,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...extraEnv },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);
try {
  const desktopOnly = process.argv.includes('--desktop');
  const cases = Object.keys(presets).filter((preset) => !desktopOnly || ['electron', 'tauri'].includes(preset)).flatMap((preset) =>
    ['single', 'monorepo'].map((layout) => ({ preset, layout })));
  if (!desktopOnly) cases.push(...[['fastify', 'ts-library'], ['fastapi', 'python-package'], ['react', 'fastapi']]
    .map((ids) => ({ presets: ids, layout: 'monorepo' })));
  for (const selection of cases) {
    const label = selection.preset ?? selection.presets.join('-');
    const directory = path.join(root, `${label}-${selection.layout}`);
    const options = { ...selection, name: `verify-${label}`, directory };
    await generate(options);
    const projects = projectSelections(options);
    console.log(`Verifying ${label} (${selection.layout})`);
    if (projects.some((project) => project.ecosystem === 'node')) {
      npm(['install', '--no-audit', '--no-fund'], directory);
      npm(['test'], directory);
      npm(['run', 'typecheck'], directory);
      for (const project of projects.filter((project) => project.id === 'tauri')) {
        const native = selection.layout === 'single' ? directory : path.join(directory, ...project.folder.split('/'));
        npm(['run', 'build:web'], native);
        if (process.argv.includes('--skip-rust-tools')) {
          console.log('Explicitly skipping rustfmt and clippy; these checks are NOT verified.');
        } else {
          npm(['run', 'fmt:rust'], native);
          npm(['run', 'lint:rust'], native);
        }
        for (const script of ['check:rust', 'test:rust']) npm(['run', script], native);
      }
      npm(['run', 'build'], directory);
    }
    for (const project of projects) {
      const workspace = selection.layout === 'single' ? directory : path.join(directory, ...project.folder.split('/'));
      if (project.ecosystem === 'node') {
        if (project.id === 'electron') {
          npm(['run', 'make'], workspace);
          if (!(await readdir(path.join(workspace, 'out'))).some((file) => file.includes(process.platform))) {
            throw new Error('No host Electron package generated.');
          }
        }
        if (project.id === 'ts-library') {
          run(process.execPath, ['--input-type=module', '-e', "import { greet } from './dist/index.js'; if (greet('World') !== 'Hello, World!') throw new Error('Invalid public API');"], workspace);
          npm(['pack', '--dry-run'], workspace);
        }
      } else {
        run('python', ['-m', 'venv', '.venv'], workspace);
        const python = path.join(workspace, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
        run(python, ['-m', 'pip', 'install', '--quiet', '-e', '.[dev]'], workspace);
        run(python, ['-m', 'pytest', '-q'], workspace);
        run(python, ['-m', 'ruff', 'check', '.'], workspace);
        run(python, ['-m', 'ruff', 'format', '--check', '.'], workspace);
        run(python, ['-m', 'pip', 'wheel', '.', '--no-deps', '--wheel-dir', 'dist', '--quiet'], workspace);
        const wheel = (await readdir(path.join(workspace, 'dist'))).find((file) => file.endsWith('.whl'));
        if (!wheel) throw new Error('No installable Python wheel produced.');
        run(python, ['-m', 'pip', 'install', '--quiet', '--force-reinstall', '--no-deps', path.join('dist', wheel)], workspace);
        const module = project.name.replaceAll('-', '_');
        run(python, ['-c', project.id === 'fastapi' ? `from ${module}.main import app; assert app.title == "FastAPI"` : `from ${module} import greet; assert greet("World") == "Hello, World!"`], root);
      }
    }
  }
  console.log(`All ${cases.length} selected preset/layout cases passed install, test, build/package, and static checks.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
