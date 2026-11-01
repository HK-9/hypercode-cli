import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { combinations, projectSelections, templateFiles } from '../src/templates.js';
import { generate, validateOptions } from '../src/generate.js';
import { runCli } from '../src/cli.js';

for (const ids of combinations) {
  test(`composes ${ids.join('+')} with explicit ownership and no collisions`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-composition-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const options = { name: 'sample', presets: ids, layout: 'monorepo', directory: path.join(root, 'output') };
    const result = await generate(options);
    const projects = projectSelections(options);
    assert.equal(new Set(projects.map((project) => project.folder)).size, projects.length);
    assert.equal(new Set(projects.map((project) => project.name)).size, projects.length);
    const expected = templateFiles(options);
    for (const file of result.files) {
      assert.equal(await readFile(path.join(result.target, file), 'utf8'), expected[file]);
    }
    for (const project of projects) {
      const manifest = expected[`${project.folder}/${project.ecosystem === 'node' ? 'package.json' : 'pyproject.toml'}`];
      if (project.ecosystem === 'node') assert.equal(JSON.parse(manifest).name, `sample-${project.id}`);
      else {
        assert.match(manifest, new RegExp(`name = "sample-${project.id}"`));
        assert.ok(result.files.includes(`${project.folder}/src/sample_${project.id.replaceAll('-', '_')}/__init__.py`));
      }
      assert.match(expected['README.md'], new RegExp(project.name));
    }
    const nodeProjects = projects.filter((project) => project.ecosystem === 'node');
    if (nodeProjects.length) {
      const pkg = JSON.parse(expected['package.json']);
      assert.deepEqual(pkg.workspaces, nodeProjects.map((project) => project.folder));
      assert.equal(pkg.private, true);
      assert.match(expected['README.md'], /only Node workspaces/);
    } else assert.equal(expected['package.json'], undefined);
    assert.doesNotMatch(expected['docs/architecture.md'], /one initial workspace/);
    assert.doesNotMatch(expected['docs/adr/0001-project-structure.md'], /one initial workspace/);
    assert.match(expected['README.md'], /not pre-wired integrations/);
    const reversed = templateFiles({ ...options, presets: [...ids].reverse() });
    for (const project of projects) {
      const manifest = `${project.folder}/${project.ecosystem === 'node' ? 'package.json' : 'pyproject.toml'}`;
      assert.equal(reversed[manifest], expected[manifest]);
    }
  });
}

test('rejects duplicate, conflicting, incompatible and malformed selections before writing', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const base = { name: 'sample', layout: 'monorepo', directory: path.join(root, 'output') };
  for (const overrides of [
    { presets: [] }, { presets: 'react,fastapi' }, { presets: ['react', 'react'] },
    { presets: ['react', 'next'] }, { presets: ['fastify', 'fastapi'] },
    { presets: ['react', 'fastapi', 'ts-library'] }, { presets: ['react', 'missing'] },
    { preset: 'react', presets: ['react', 'fastapi'] },
    { presets: ['react', 'fastapi'], layout: 'single' },
  ]) {
    await assert.rejects(generate({ ...base, ...overrides }));
    assert.deepEqual(await readdir(root), []);
  }
  validateOptions({ ...base, name: 'a'.repeat(49), presets: ['fastapi', 'python-package'] });
  assert.throws(() => validateOptions({ ...base, name: 'a'.repeat(50), presets: ['fastapi', 'python-package'] }), /exceeds 64/);
  assert.deepEqual(
    templateFiles({ ...base, presets: ['react'] }),
    templateFiles({ ...base, preset: 'react' }),
  );
});

test('binary composition flags create a mixed monorepo and report invalid selections', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-flags-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const binary = fileURLToPath(new URL('../bin/hypercode-init.js', import.meta.url));
  const invoke = (args) => spawnSync(process.execPath, [binary, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  const flags = ['--presets', 'react,fastapi', '--layout', 'monorepo', '--yes'];
  const preview = invoke(['sample', ...flags, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(JSON.parse(preview.stdout).files.includes('apps/api/src/sample_fastapi/main.py'));
  assert.deepEqual(await readdir(root), []);
  const output = invoke(['sample', ...flags]);
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /React \+ Vite \+ FastAPI/);
  const pkg = JSON.parse(await readFile(path.join(root, 'sample', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.workspaces, ['apps/web']);
  for (const args of [
    ['--presets', 'react,fastapi', '--preset', 'react'],
    ['--presets', 'react,react'], ['--presets', 'react,'], ['--presets', 'react,next'],
  ]) {
    const result = invoke(['other', ...args, '--layout', 'monorepo', '--yes']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hypercode-init:/);
  }
});

test('interactive comma selections compose monorepos and preserve numeric selection', async () => {
  const answers = ['', '2', '1,5', ''];
  const prompts = [];
  const result = await runCli(['--name', 'interactive', '--dry-run'], {
    interactive: true, log: () => {},
    question: async (prompt) => { prompts.push(prompt); return answers.shift(); },
  });
  assert.ok(prompts[1].includes('[single]'));
  assert.ok(result.files.includes('apps/web/package.json'));
  assert.ok(result.files.includes('apps/api/pyproject.toml'));
  const invalidAnswers = ['', 'react,fastapi', ':cancel'];
  const logs = [];
  const cancelled = await runCli(['--name', 'sample', '--layout', 'single', '--dry-run'], {
    interactive: true, log: (line) => logs.push(line), question: async () => invalidAnswers.shift(),
  });
  assert.equal(cancelled.cancelled, true);
  assert.ok(logs.some((line) => line.includes('Multiple presets require')));
});
