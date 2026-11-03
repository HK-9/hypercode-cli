import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run via npm run test:package.');
const root = await mkdtemp(path.join(process.cwd(), '.hypercode-package-'));
function npm(args, cwd = process.cwd()) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed:\n${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}
try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', root]));
  assert.deepEqual(packed.files.map(({ path }) => path).sort(), [
    'LICENSE', 'README.md', 'bin/hypercode-init.js', 'package.json',
    'src/cli.js', 'src/desktop.js', 'src/generate.js', 'src/review.js', 'src/skills.js', 'src/templates.js',
  ]);
  const install = path.join(root, 'install');
  npm(['install', '--prefix', install, path.join(root, packed.filename), '--no-audit', '--no-fund']);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(npm(['exec', '--offline', '--', 'hypercode-init', '--version'], install).trim(), pkg.version);
  npm(['exec', '--offline', '--', 'hypercode-init', 'example', '--preset', 'python-package', '--layout', 'monorepo', '--yes'], install);
  const generated = await readFile(path.join(install, 'example', 'packages', 'core', 'pyproject.toml'), 'utf8');
  assert.match(generated, /name = "example"/);
  npm(['exec', '--offline', '--', 'hypercode-init', 'mixed', '--presets', 'react,fastapi', '--layout', 'monorepo', '--yes'], install);
  const mixed = JSON.parse(await readFile(path.join(install, 'mixed', 'package.json'), 'utf8'));
  assert.deepEqual(mixed.workspaces, ['apps/web']);
  assert.match(await readFile(path.join(install, 'mixed', 'apps', 'api', 'pyproject.toml'), 'utf8'), /name = "mixed-fastapi"/);
  for (const preset of ['electron', 'tauri']) {
    const result = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', `preview-${preset}`, '--preset', preset, '--layout', 'monorepo', '--yes', '--dry-run'], install));
    assert.ok(result.files.includes(preset === 'tauri' ? 'apps/desktop/src-tauri/Cargo.toml' : 'apps/desktop/forge.config.cjs'));
  }
  npm(['exec', '--offline', '--', 'hypercode-init', 'skilled', '--preset', 'tauri', '--layout', 'single', '--agent', 'both', '--yes'], install);
  const skill = await readFile(path.join(install, 'skilled', '.claude', 'skills', 'hypercode-modular-development', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: hypercode-modular-development\ndescription:/);
  const incrementalArgs = ['skills', 'add', 'skilled', '--agent', 'all', '--presets', 'react,tauri', '--yes'];
  const incremental = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', ...incrementalArgs, '--dry-run'], install));
  assert.equal(incremental.create.length, 2);
  assert.equal(incremental.unchanged.length, 6);
  npm(['exec', '--offline', '--', 'hypercode-init', ...incrementalArgs], install);
  const skillArgs = ['skills', 'add', 'example', '--agent', 'copilot', '--preset', 'python-package', '--layout', 'monorepo', '--yes'];
  const preview = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', ...skillArgs, '--dry-run'], install));
  assert.equal(preview.create.length, 6);
  npm(['exec', '--offline', '--', 'hypercode-init', ...skillArgs], install);
  const repeated = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', ...skillArgs, '--dry-run'], install));
  assert.equal(repeated.create.length, 0);
  assert.equal(repeated.unchanged.length, 6);
  const reviewed = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', 'codebase', 'review', 'mixed', '--json'], install));
  assert.equal(reviewed.method, 'deterministic-local-heuristics');
  assert.equal(reviewed.layout.observed, 'multi-project-observed');
  assert.ok(reviewed.projects.some((project) => project.path === 'apps/web' && project.stacks.includes('react')));
  assert.ok(reviewed.projects.some((project) => project.path === 'apps/api' && project.stacks.includes('fastapi')));
  const desktopReview = JSON.parse(npm(['exec', '--offline', '--', 'hypercode-init', 'codebase', 'review', 'skilled', '--json'], install));
  assert.ok(desktopReview.projects.some((project) => project.stacks.includes('tauri')));
  assert.ok(desktopReview.recommendations.some((item) => item.id === 'review-tauri-authority'));
  const terminalReview = npm(['exec', '--offline', '--', 'hypercode-init', 'codebase', 'review', 'example'], install);
  assert.match(terminalReview, /Prioritized recommendations:/);
  assert.equal(await readFile(path.join(install, 'mixed', 'package.json'), 'utf8'), JSON.stringify(mixed, null, 2) + '\n');
  if (process.env.HYPERCODE_TERMINAL_PYTHON) {
    const terminal = spawnSync(process.env.HYPERCODE_TERMINAL_PYTHON, [
      path.join(process.cwd(), 'scripts', 'verify-terminal.py'),
      '--binary', path.join(install, 'node_modules', 'hypercode-init', 'bin', 'hypercode-init.js'),
    ], { encoding: 'utf8', timeout: 180_000 });
    if (terminal.error || terminal.status !== 0) {
      throw new Error(`Installed terminal wizard check failed:\n${terminal.error?.message ?? ''}\n${terminal.stdout}\n${terminal.stderr}`);
    }
    console.log(terminal.stdout.trim());
  }
  console.log('Packed npm command verified bootstrap, opt-in/incremental Agent Skills and read-only mixed/Python/Tauri codebase reviews.');
} finally {
  await rm(root, { recursive: true, force: true });
}
