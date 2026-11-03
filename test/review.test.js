import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { reviewDirectory, formatReview } from '../src/review.js';
import { runCli } from '../src/cli.js';
import { generate } from '../src/generate.js';

const binary = fileURLToPath(new URL('../bin/hypercode-init.js', import.meta.url));
const invoke = (args, cwd) => spawnSync(process.execPath, [binary, ...args], { cwd, encoding: 'utf8', timeout: 15000 });
const json = (value) => JSON.stringify(value);
const standardDocs = {
  'README.md': '# Product\n\nSetup: use the project prerequisites. Development, tests and validation are documented here.',
  'CONTRIBUTING.md': '# Contributing\nFollow existing validation and review.',
  'CHANGELOG.md': '# Changelog\n## Unreleased\n### Added',
  'docs/adr/0001-current-boundaries.md': '# Accepted\nContext, decision and consequences.',
};
async function setup(t, files = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercode-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await fixture(directory, files);
  return directory;
}
async function fixture(root, files) {
  for (const [file, content] of Object.entries(files)) {
    const filename = path.join(root, file);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
}
async function snapshot(root, relative = '.') {
  const result = {};
  for (const name of (await readdir(path.join(root, relative))).sort()) {
    const child = relative === '.' ? name : path.join(relative, name);
    const entry = await lstat(path.join(root, child));
    if (entry.isDirectory()) Object.assign(result, await snapshot(root, child));
    else result[child] = {
      modified: entry.mtimeMs, size: entry.size, symlink: entry.isSymbolicLink(),
      digest: entry.isSymbolicLink() ? null : createHash('sha256').update(await readFile(path.join(root, child))).digest('hex'),
    };
  }
  return result;
}
const ids = (report) => report.recommendations.map((item) => item.id);
const project = (report, folder = '.') => report.projects.find((item) => item.path === folder);

test('healthy conventional project has accurate observations without prescribing new architecture or release tooling', async (t) => {
  const root = await setup(t, {
    ...standardDocs,
    'package.json': json({ dependencies: { react: '^19' }, devDependencies: { vite: '^7' }, scripts: { test: 'vitest run', build: 'vite build' } }),
    'src/features/cart/cart.ts': 'export const cart = [];',
    'test/cart.test.ts': '// Existing behavior test',
  });
  const before = await snapshot(root);
  const report = await reviewDirectory(root);
  assert.equal(report.layout.observed, 'single-project-observed');
  assert.equal(report.scope.complete, true);
  assert.deepEqual(project(report).stacks, ['react']);
  assert.deepEqual(project(report).validation.scriptNames, ['test']);
  assert.equal(project(report).validation.testFilesObserved, 1);
  assert.deepEqual(project(report).sourceOrganization.conventionalModuleDirectories, ['src/features']);
  assert.equal(report.recommendations.length, 0);
  assert.match(formatReview(report), /not a clean bill of health/);
  assert.deepEqual(await snapshot(root), before);
});

test('deficient project produces prioritized, concrete and qualified convention suggestions', async (t) => {
  const root = await setup(t, {
    'package.json': json({ dependencies: { fastify: '^5' }, scripts: { start: 'node index.js' } }),
    'src/server.ts': 'const signal = "SOURCE_MUST_NOT_APPEAR";',
  });
  const report = await reviewDirectory(root);
  assert.ok(ids(report).includes('document-entry-point'));
  assert.ok(ids(report).includes('establish-validation'));
  assert.ok(ids(report).includes('document-contribution-workflow'));
  assert.ok(ids(report).includes('record-consequential-decisions'));
  assert.ok(ids(report).includes('document-user-visible-changes'));
  assert.equal(report.recommendations[0].priority, 'medium');
  const validation = report.recommendations.find((item) => item.id === 'establish-validation');
  assert.ok(validation.evidence.some((item) => item.path === 'package.json'));
  assert.match(validation.action, /custom scripts, inline\/native tests and external checks/);
  assert.doesNotMatch(JSON.stringify(report), /SOURCE_MUST_NOT_APPEAR/);
  assert.ok(report.recommendations.every((item) => item.evidence.length && item.action));
});

test('mixed nested workspaces, Python and an npm coordinator retain per-project evidence and environment ownership', async (t) => {
  const root = await setup(t, {
    ...standardDocs,
    'package.json': json({ private: true, workspaces: ['apps/*', 'groups/*'], scripts: { test: 'npm test --workspaces --if-present' } }),
    'apps/web/package.json': json({ dependencies: { next: '^16', react: '^19' }, scripts: { test: 'vitest run' } }),
    'apps/web/src/app/page.tsx': 'export default function Page() {}',
    'apps/web/README.md': '# Web\nRun tests.',
    'groups/services/package.json': json({ private: true, workspaces: ['packages/*'] }),
    'groups/services/packages/core/package.json': json({ devDependencies: { typescript: '^5' }, exports: { '.': './dist/index.js' }, scripts: { check: 'tsc' } }),
    'groups/services/packages/core/README.md': '# Library\nValidation is documented.',
    'apps/api/pyproject.toml': '[build-system]\nrequires = ["setuptools"]\n[project]\nname = "api"\ndependencies = [\n  "fastapi>=0.100",\n]\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    'apps/api/src/api/routes/health.py': 'from fastapi import APIRouter',
    'apps/api/tests/test_health.py': 'def test_health(): pass',
    'apps/api/README.md': '# API\nUse pytest in the Python environment.',
  });
  const report = await reviewDirectory(root);
  assert.equal(report.layout.observed, 'multi-project-observed');
  assert.deepEqual(project(report).workspaces, ['apps/web', 'groups/services']);
  assert.ok(project(report).workspaceMembership.every((member) => member.ecosystem === 'node'));
  assert.deepEqual(project(report, 'groups/services').workspaces, ['groups/services/packages/core']);
  assert.deepEqual(project(report, 'apps/api').stacks, ['fastapi', 'python-package']);
  assert.deepEqual(project(report, 'apps/web').stacks, ['next', 'react']);
  assert.deepEqual(project(report, 'groups/services/packages/core').stacks, ['ts-library']);
  assert.equal(project(report, 'apps/api').validation.pythonToolTokenObserved, true);
  assert.equal(project(report, 'apps/api').documentation.contributionInherited, true);
  assert.ok(!ids(report).includes('inspect-next-routing'));
  assert.ok(report.layout.declaredWorkspaceRoots.includes('groups/services'));
});

test('pnpm and uv declarations are lexical observations, not invented npm/Python integration', async (t) => {
  const root = await setup(t, {
    'package.json': json({ private: true }),
    'pnpm-workspace.yaml': 'packages:\n  - "packages/*"\n',
    'packages/ui/package.json': json({ dependencies: { react: '*' } }),
    'pyproject.toml': '[tool.uv.workspace]\nmembers = ["services/*"]\n',
    'services/api/pyproject.toml': '[project]\nname = "api"\ndependencies = ["fastapi"]\n',
  });
  const report = await reviewDirectory(root);
  assert.deepEqual(project(report).workspaces, ['packages/ui', 'services/api']);
  assert.ok(project(report).workspaceMembership.some((member) => member.path === 'services/api' && member.ecosystem === 'python'));
  assert.ok(project(report).manifests.some((item) => item.path === 'pnpm-workspace.yaml' && item.status === 'lexically-inspected-not-validated'));
  assert.equal(report.layout.observed, 'multi-project-observed');
  assert.match(report.limitations.join('\n'), /not full parsing/);
});

test('Electron and Tauri signals trigger manual boundary review, never a security pass/fail claim', async (t) => {
  const root = await setup(t, {
    ...standardDocs,
    'package.json': json({ private: true, workspaces: ['apps/*'] }),
    'apps/desktop/package.json': json({ devDependencies: { electron: '^45', '@electron-forge/cli': '8.0.1' }, scripts: { test: 'vitest' } }),
    'apps/desktop/src/main/main.ts': 'const maliciousSource = "DESKTOP_SECRET_SENTINEL";',
    'apps/desktop/src/preload/preload.ts': '',
    'apps/desktop/src/renderer/App.tsx': '',
    'apps/native/package.json': json({ dependencies: { react: '^19', '@tauri-apps/api': '^2' }, scripts: { test: 'vitest', 'check:rust': 'cargo check' } }),
    'apps/native/src-tauri/Cargo.toml': '[package]\nname = "native"\n[dependencies]\ntauri = { version = "2" }\n',
    'apps/native/src-tauri/tauri.conf.json': '{"app":{"security":{"capabilities":["main"]}}}',
    'apps/native/src-tauri/capabilities/main.json': '{"permissions":["allow-greet"]}',
  });
  const report = await reviewDirectory(root);
  assert.deepEqual(project(report, 'apps/desktop').stacks, ['electron']);
  assert.deepEqual(project(report, 'apps/native').stacks, ['react', 'tauri']);
  assert.ok(!project(report, 'apps/native/src-tauri'));
  const tauri = report.recommendations.find((item) => item.id === 'review-tauri-authority');
  assert.match(tauri.action, /AppManifest::commands/);
  assert.ok(tauri.evidence.some((item) => item.path === 'apps/native/src-tauri/capabilities/main.json' && item.basis.includes('contents not evaluated')));
  const electron = report.recommendations.find((item) => item.id === 'review-electron-boundaries');
  assert.match(electron.action, /sender validation/);
  assert.match(electron.action, /not evaluated/);
  assert.doesNotMatch(JSON.stringify(report), /DESKTOP_SECRET_SENTINEL|allow-greet/);
});

test('native-only Tauri project is detected from Cargo without claiming plain Rust is a supported stack', async (t) => {
  const root = await setup(t, {
    'src-tauri/Cargo.toml': '[package]\nname = "desktop"\n[dependencies.tauri]\nversion = "2"\n',
    'crates/helper/Cargo.toml': '[package]\nname = "helper"\n',
  });
  const report = await reviewDirectory(root);
  assert.deepEqual(project(report).stacks, ['tauri']);
  assert.deepEqual(project(report, 'crates/helper').stacks, []);
  assert.ok(report.layout.projectRoots.includes('crates/helper'));
});

test('empty and unsupported repositories get general, conditional guidance only', async (t) => {
  for (const files of [{}, { 'Gemfile': 'gem "rails"', 'app/controllers/product.rb': 'class Product; end' }]) {
    const root = await setup(t, files);
    const report = await reviewDirectory(root);
    assert.equal(report.layout.observed, 'unknown');
    assert.deepEqual(project(report).stacks, []);
    assert.ok(report.recommendations.every((item) => [
      'document-entry-point', 'document-contribution-workflow', 'record-consequential-decisions', 'document-user-visible-changes',
    ].includes(item.id)));
    assert.doesNotMatch(report.recommendations.map((item) => item.action).join('\n'), /install React|use FastAPI|create a monorepo/i);
  }
});

test('Next Pages Router and alternate decision/changelog names avoid forced App Router/ADR migrations', async (t) => {
  const root = await setup(t, {
    'package.json': json({ dependencies: { next: '^16' }, scripts: { test: 'custom runner' } }),
    'README.rst': 'Validation and tests are described here.',
    'CONTRIBUTING': 'Contributing',
    'HISTORY.txt': 'Existing release notes',
    'architecture-decisions/choices.md': 'Existing accepted rationale.',
    'pages/index.tsx': '',
  });
  const report = await reviewDirectory(root);
  assert.ok(!ids(report).includes('inspect-next-routing'));
  assert.ok(!ids(report).includes('record-consequential-decisions'));
  assert.ok(!ids(report).includes('document-user-visible-changes'));
  assert.ok(!ids(report).includes('document-contribution-workflow'));
});

test('size-based module recommendation is qualified, never a semantic cohesion claim', async (t) => {
  const files = { ...standardDocs, 'package.json': json({ dependencies: { fastify: '*' }, scripts: { test: 'custom' } }) };
  for (let index = 0; index < 12; index++) files[`src/domain${index}.ts`] = '/* not analyzed */';
  const root = await setup(t, files);
  const report = await reviewDirectory(root);
  assert.equal(project(report).sourceOrganization.filesObserved, 12);
  const item = report.recommendations.find((item) => item.id === 'inspect-module-cohesion');
  assert.equal(item.priority, 'low');
  assert.match(item.action, /may already be cohesive/);
  assert.match(item.evidence[0].basis, /contents and cohesion not evaluated/);
});

test('malformed and structurally invalid manifests are surfaced without raw content or raw parser errors', async (t) => {
  const root = await setup(t, {
    'package.json': '{"scripts": SECRET_MALFORMED_TOKEN}',
    'apps/invalid/package.json': json({ dependencies: 'BAD_SHAPE_SECRET', scripts: { test: 123 }, workspaces: 'WRONG_WORKSPACE' }),
    'apps/array/package.json': '[]',
    'python/pyproject.toml': '[project\nsecret = "TOML_SECRET"',
    'native/src-tauri/tauri.conf.json': 'null',
  });
  const report = await reviewDirectory(root);
  assert.equal(report.scope.complete, false);
  for (const code of ['INVALID_JSON', 'INVALID_DEPENDENCIES', 'INVALID_SCRIPTS', 'INVALID_WORKSPACES', 'INVALID_MANIFEST_SHAPE', 'TOML_LEXICAL_ERROR']) {
    assert.ok(report.diagnostics.some((item) => item.code === code), code);
  }
  assert.ok(report.recommendations.filter((item) => item.priority === 'high').length >= 6);
  assert.doesNotMatch(JSON.stringify(report), /SECRET_MALFORMED_TOKEN|BAD_SHAPE_SECRET|TOML_SECRET|WRONG_WORKSPACE/);
  assert.equal(project(report).manifests[0].status, 'not-evaluated');
});

test('TOML lexical balance errors surface; comments/descriptions are not dependency or validation evidence', async (t) => {
  const root = await setup(t, {
    'pyproject.toml': '[project]\nname = "tool"\ndescription = "fastapi pytest"\n# "fastapi" is only an idea\ndependencies = ["httpx"]\n',
    'broken-quote/pyproject.toml': '[project]\nname = "PRIVATE_UNTERMINATED\n',
    'broken-array/pyproject.toml': '[project]\ndependencies = ["fastapi"\n',
    'native/Cargo.toml': '[package]\nname = "tool"\n[dependencies]\n# tauri = "2"\nserde = "1"\n',
  });
  const report = await reviewDirectory(root);
  assert.deepEqual(project(report).stacks, ['python-package']);
  assert.equal(project(report).validation.pythonToolTokenObserved, false);
  assert.deepEqual(project(report, 'native').stacks, []);
  assert.equal(report.diagnostics.filter((item) => item.code === 'TOML_LEXICAL_ERROR').length, 2);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_UNTERMINATED/);
});

test('read failures are explicit and missing observations are qualified in incomplete scopes', async (t) => {
  const root = await setup(t, {
    'package.json': '{}', 'README.md': 'Private doc content',
    'child/pyproject.toml': '[project]\nname = "child"',
  });
  const report = await reviewDirectory(root, {
    read: async (filename) => {
      if (filename.endsWith('README.md')) throw Object.assign(new Error('PRIVATE_ERROR_CONTENT'), { code: 'EACCES' });
      if (filename.endsWith('pyproject.toml')) throw new Error('PRIVATE_UNKNOWN_ERROR');
      return readFile(filename, 'utf8');
    },
  });
  assert.ok(report.diagnostics.some((item) => item.code === 'EACCES' && item.kind === 'documentation'));
  assert.ok(report.diagnostics.some((item) => item.code === 'READ_ERROR'));
  assert.equal(project(report).documentation.readmeEvaluated, false);
  assert.ok(!ids(report).includes('document-validation'));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_ERROR_CONTENT|PRIVATE_UNKNOWN_ERROR/);
  assert.ok(report.recommendations.find((item) => item.id === 'record-consequential-decisions').evidence[0].basis.includes('outside scan'));
});

test('metadata byte budgets and file/depth/entry caps expose skipped scope rather than false absence', async (t) => {
  const root = await setup(t, {
    'package.json': json({ scripts: { test: 't'.repeat(100) } }),
    'README.md': '# Documentation text',
    'nested/deep/package.json': json({ dependencies: { react: '*' } }),
    'nested/deep/README.md': '# Hidden by depth cap',
  });
  const size = await reviewDirectory(root, { limits: { fileBytes: 30 } });
  assert.ok(size.diagnostics.some((item) => item.code === 'FILE_LIMIT'));
  assert.equal(size.scope.complete, false);
  const depth = await reviewDirectory(root, { limits: { depth: 1 } });
  assert.ok(depth.scope.skipped.some((item) => item.path === 'nested/deep' && item.reason === 'depth-limit'));
  assert.ok(!project(depth, 'nested/deep'));
  assert.equal(depth.layout.confidence, 'partial-scan');
  const entries = await reviewDirectory(root, { limits: { entries: 1 } });
  assert.equal(entries.scope.filesObserved, 0);
  assert.ok(entries.scope.skipped.some((item) => item.reason === 'entry-limit'));
  assert.deepEqual(entries, await reviewDirectory(root, { limits: { entries: 1 } }));
  const budget = await reviewDirectory(root, { limits: { totalBytes: 20 } });
  assert.ok(budget.scope.skipped.some((item) => /FILE_LIMIT|TOTAL_LIMIT/.test(item.reason)));
  await assert.rejects(reviewDirectory(root, { limits: { depth: 0 } }), /positive integers/);
});

test('excluded dependencies, artifacts, caches, VCS and sensitive files are never read or treated as projects', async (t) => {
  const root = await setup(t, {
    ...standardDocs, 'package.json': '{}',
    'node_modules/foreign/package.json': '{"dependencies":{"electron":"*"}}',
    '.git/config': 'PRIVATE_GIT_DATA',
    'dist/package.json': '{"dependencies":{"next":"*"}}',
    'target/Cargo.toml': 'PRIVATE_BUILD_DATA',
    '.venv/pyproject.toml': '[project]\ndependencies=["fastapi"]',
    '.env': 'EXAMPLE_SECRET_VALUE', '.env.local': 'EXAMPLE_SECRET_VALUE',
    'certificate.pem': 'EXAMPLE_SECRET_VALUE', '.npmrc': 'EXAMPLE_SECRET_VALUE',
    'src/main.ts': 'SOURCE_SECRET_VALUE',
  });
  const reads = [];
  const before = await snapshot(root);
  const report = await reviewDirectory(root, { read: async (filename) => { reads.push(path.relative(root, filename)); return readFile(filename, 'utf8'); } });
  assert.deepEqual(reads.sort(), ['CHANGELOG.md', 'CONTRIBUTING.md', 'README.md', 'package.json', path.join('src', 'main.ts')].sort());
  assert.equal(report.projects.length, 1);
  assert.equal(report.scope.excludedSensitiveFiles, 4);
  assert.equal(report.scope.complete, true);
  assert.ok(report.scope.skipped.some((item) => item.path === 'node_modules'));
  assert.doesNotMatch(JSON.stringify(report), /EXAMPLE_SECRET_VALUE|PRIVATE_GIT_DATA|SOURCE_SECRET_VALUE/);
  assert.deepEqual(await snapshot(root), before);
});

test('symlinked roots/ancestors are refused; nested symlinks and nonregular files are skipped without following', async (t) => {
  const root = await setup(t, { 'package.json': '{}' });
  const external = await setup(t, { 'package.json': '{"dependencies":{"electron":"*"}}', 'README.md': 'OUTSIDE_SECRET' });
  const link = path.join(root, 'outside');
  await symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(reviewDirectory(link), /symlink/);
  await mkdir(path.join(external, 'nested'));
  await assert.rejects(reviewDirectory(path.join(link, 'nested')), /symlink/);
  const report = await reviewDirectory(root);
  assert.ok(report.scope.skipped.some((item) => item.path === 'outside' && item.reason === 'symlink-not-followed'));
  assert.ok(!project(report, 'outside'));
  assert.doesNotMatch(JSON.stringify(report), /OUTSIDE_SECRET/);
  assert.equal(report.scope.complete, false);
});

test('unsupported or unmatched workspace declarations are qualified and never used to escape scan root', async (t) => {
  const root = await setup(t, {
    'package.json': json({ workspaces: ['../external', 'apps/{a,b}', '!apps/no', 'Z:\\external', 'missing/*', 'apps/**/pkg'] }),
    'apps/nested/pkg/package.json': json({ dependencies: { react: '*' } }),
  });
  const report = await reviewDirectory(root);
  assert.deepEqual(project(report).workspaces, ['apps/nested/pkg']);
  assert.ok(report.scope.skipped.some((item) => item.reason === 'workspace-pattern-not-supported'));
  assert.ok(report.recommendations.some((item) => item.id === 'verify-workspace-membership' && item.evidence[0].basis.includes('incomplete')));
  assert.doesNotMatch(JSON.stringify(report), /Z:\\\\external/);
});

test('deterministic JSON and terminal output are stable across repeated reviews and creation order', async (t) => {
  const files = { 'package.json': '{"dependencies":{"react":"*"}}', 'src/z.ts': '', 'src/a.ts': '', 'README.md': '# Setup only' };
  const first = await setup(t, files);
  const second = await setup(t, Object.fromEntries(Object.entries(files).reverse()));
  const one = await reviewDirectory(first);
  const two = await reviewDirectory(second);
  assert.deepEqual({ ...one, target: '' }, { ...two, target: '' });
  assert.deepEqual(one, await reviewDirectory(first));
  assert.equal(formatReview(one), formatReview(await reviewDirectory(first)));
  assert.ok(ids(one).includes('document-validation'));
});

test('terminal formatting does not forward filename control sequences', async (t) => {
  if (process.platform === 'win32') return;
  const root = await setup(t, { 'odd\u001b[31m/package.json': '{}', 'line\nbreak/package.json': '{}' });
  const report = await reviewDirectory(root);
  const text = formatReview(report);
  assert.doesNotMatch(text, /\u001b|line\nbreak/);
  assert.ok(report.projects.some((item) => item.path.includes('?')));
});

test('binary review defaults to cwd, never prompts/runs commands/writes, and JSON contains no source/script values', async (t) => {
  const root = await setup(t, {
    ...standardDocs,
    'package.json': json({ dependencies: { react: '*' }, scripts: { test: `node -e "require('fs').writeFileSync('DO_NOT_CREATE','oops')"` } }),
    'src/index.ts': 'const source = "RAW_SOURCE_SENTINEL";',
  });
  const before = await snapshot(root);
  const jsonResult = invoke(['codebase', 'review', '--json'], root);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.target, root);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.method, 'deterministic-local-heuristics');
  assert.equal(report.projects[0].validation.execution, 'not-run');
  assert.doesNotMatch(jsonResult.stdout, /RAW_SOURCE_SENTINEL|writeFileSync|DO_NOT_CREATE/);
  const terminal = invoke(['codebase', 'review'], root);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.match(terminal.stdout, /Prioritized recommendations:/);
  assert.match(terminal.stdout, /Skipped paths:/);
  assert.deepEqual(await snapshot(root), before);
  const result = await runCli(['codebase', 'review', root, '--json'], { interactive: true, log: () => {}, question: () => assert.fail('Review cannot prompt') });
  assert.equal(result.target, root);
});

test('invalid review inputs/options fail explicitly without affecting bootstrap/skills flag handling', async (t) => {
  const root = await setup(t, { 'file': 'not a directory' });
  for (const args of [
    ['codebase', 'review', path.join(root, 'missing')], ['codebase', 'review', path.join(root, 'file')],
    ['codebase', 'review', root, root], ['codebase', 'review', '--preset', 'react'], ['codebase', 'review', '--yes'],
    ['--json'], ['codebase', 'review', '--unknown'],
  ]) {
    const result = invoke(args, root);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /hypercode-init:/);
  }
  const help = invoke(['codebase', 'review', '--help'], root);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Defaults to the current directory/);
  const scaffold = path.join(root, 'scaffold');
  await generate({ name: 'scaffold', preset: 'react', layout: 'single', directory: scaffold });
  const report = JSON.parse(invoke(['codebase', 'review', scaffold, '--json'], root).stdout);
  assert.deepEqual(project(report).stacks, ['react']);
  const skills = invoke(['skills', 'add', scaffold, '--agent', 'all', '--presets', 'react,tauri', '--yes'], root);
  assert.equal(skills.status, 0, skills.stderr);
  const preview = invoke([path.join(root, 'preview'), '--preset', 'tauri', '--layout', 'single', '--dry-run', '--yes'], root);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(JSON.parse(preview.stdout).files.includes('src-tauri/Cargo.toml'));
});

test('review and codebase project names preserve fully specified bootstrap and bare destination wizard behavior', async (t) => {
  const root = await setup(t);
  const flags = invoke(['review', '--preset', 'react', '--layout', 'single', '--yes'], root);
  assert.equal(flags.status, 0, flags.stderr);
  assert.equal(JSON.parse(await readFile(path.join(root, 'review', 'package.json'), 'utf8')).name, 'review');
  const prompts = [];
  const answers = ['', '1', '', 'yes'];
  const previous = process.cwd();
  // Cwd changes are scoped to this single test file's process and restored.
  process.chdir(root);
  try {
    const result = await runCli(['codebase'], {
      interactive: true, log: () => {},
      question: async (prompt) => { prompts.push(prompt); assert.ok(answers.length); return answers.shift(); },
    });
    assert.ok(result.files.includes('src/App.tsx'));
    assert.equal(JSON.parse(await readFile(path.join(root, 'codebase', 'package.json'), 'utf8')).name, 'codebase');
    await rm(path.join(root, 'review'), { recursive: true });
    const reviewAnswers = ['', '1', '', 'yes'];
    const wizard = await runCli(['review'], {
      interactive: true, log: () => {},
      question: async (prompt) => { assert.ok(reviewAnswers.length, prompt); return reviewAnswers.shift(); },
    });
    assert.ok(wizard.files.includes('src/App.tsx'));
    assert.equal(JSON.parse(await readFile(path.join(root, 'review', 'package.json'), 'utf8')).name, 'review');
    assert.ok(prompts.some((prompt) => prompt.includes('Stack selection')));
  } finally {
    process.chdir(previous);
  }
});

test('actual source content affects bounded module metrics at the exact conditional recommendation threshold', async (t) => {
  const root = await setup(t, {
    ...standardDocs, 'package.json': json({ dependencies: { fastify: '*' }, scripts: { test: 'custom check' } }),
    'src/service.ts': Array.from({ length: 399 }, () => 'const privateSourceSentinel = true;').join('\n') + '\n',
  });
  const before = await reviewDirectory(root);
  assert.equal(before.scope.sourceSampling.sampledFiles, 1);
  assert.equal(project(before).sourceMetrics[0].nonEmptyLines, 399);
  assert.ok(!ids(before).includes('inspect-large-module'));
  await writeFile(path.join(root, 'src', 'service.ts'), Array.from({ length: 400 }, () => 'const privateSourceSentinel = true;').join('\n') + '\n\n');
  const report = await reviewDirectory(root);
  assert.equal(project(report).sourceMetrics[0].nonEmptyLines, 400);
  assert.equal(project(report).sourceMetrics[0].lines, 401);
  const item = report.recommendations.find((entry) => entry.id === 'inspect-large-module');
  assert.equal(item.priority, 'low');
  assert.equal(item.evidence[0].path, 'src/service.ts');
  assert.match(item.evidence[0].basis, /400 non-empty lines/);
  assert.match(item.action, /may justify its size/);
  assert.doesNotMatch(JSON.stringify(report), /privateSourceSentinel/);
  assert.doesNotMatch(formatReview(report), /privateSourceSentinel/);
});

test('source sampling budget, oversized/unreadable files and tests are explicit without exposing source', async (t) => {
  const root = await setup(t, {
    'package.json': '{}',
    'src/a.ts': 'privateSourceA\n',
    'src/b.py': 'privateSourceB\n',
    'src/c.rs': 'privateSourceC\n',
    'test/large.test.ts': 'testOnlySource\n'.repeat(500),
    '.env.ts': 'hiddenSecretSource',
    'credentials.py': 'hiddenSecretSource',
  });
  const sample = await reviewDirectory(root, { limits: { sourceFiles: 1 } });
  assert.equal(sample.scope.sourceSampling.candidateFiles, 3);
  assert.equal(sample.scope.sourceSampling.sampledFiles, 1);
  assert.equal(sample.scope.sourceSampling.complete, false);
  assert.equal(sample.scope.complete, false);
  assert.ok(sample.scope.skipped.some((entry) => entry.path === 'src/b.py' && entry.reason === 'source-sample-file-limit'));
  assert.equal(project(sample).sourceMetrics.length, 1);
  const unreadable = await reviewDirectory(root, { read: async (filename, limit) => {
    if (filename.endsWith('.rs')) throw Object.assign(new Error('SOURCE_PRIVATE_ERROR'), { code: 'EACCES' });
    const text = await readFile(filename, 'utf8');
    if (Buffer.byteLength(text) > limit) throw Object.assign(new Error('Size'), { code: 'FILE_LIMIT' });
    return text;
  } });
  assert.ok(unreadable.diagnostics.some((entry) => entry.kind === 'source' && entry.code === 'EACCES'));
  assert.ok(unreadable.scope.skipped.some((entry) => entry.reason === 'source-not-evaluated:EACCES'));
  const oversized = await reviewDirectory(root, { limits: { fileBytes: 5 } });
  assert.equal(oversized.scope.sourceSampling.sampledFiles, 0);
  assert.ok(oversized.diagnostics.some((entry) => entry.kind === 'source' && entry.code === 'FILE_LIMIT'));
  assert.doesNotMatch(JSON.stringify(unreadable), /privateSourceA|privateSourceB|privateSourceC|testOnlySource|hiddenSecretSource|SOURCE_PRIVATE_ERROR/);
});
