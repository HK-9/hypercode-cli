import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generate, validateOptions } from '../src/generate.js';
import { presets, templateFiles } from '../src/templates.js';

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

for (const preset of Object.keys(presets)) {
  for (const layout of ['single', 'monorepo']) {
    test(`generates complete ${preset} ${layout} manifest`, async (t) => {
      const root = await temporary(t);
      const options = { name: 'sample-project', preset, layout, directory: path.join(root, 'output') };
      const result = await generate(options);
      const expected = templateFiles(options);
      assert.deepEqual(result.files, Object.keys(expected).sort());
      for (const [relative, content] of Object.entries(expected)) {
        if (Buffer.isBuffer(content)) assert.deepEqual(await readFile(path.join(result.target, relative)), content);
        else assert.equal(await readFile(path.join(result.target, relative), 'utf8'), content);
        assert.ok(!relative.startsWith('/') && !relative.split('/').includes('..'));
      }
      for (const required of ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.editorconfig', '.gitignore', 'docs/architecture.md', 'docs/operations.md', 'docs/adr/template.md', 'docs/adr/0001-project-structure.md']) {
        assert.ok(result.files.includes(required), required);
      }
      const prefix = layout === 'monorepo' ? `${presets[preset].folder}/` : '';
      if (presets[preset].ecosystem === 'node') {
        const pkg = JSON.parse(expected[prefix + 'package.json']);
        assert.equal(pkg.name, options.name);
        assert.ok(pkg.scripts.build && pkg.scripts.test && pkg.scripts.typecheck);
        assert.equal(pkg.private, preset !== 'ts-library');
        if (layout === 'monorepo') {
          const workspace = JSON.parse(expected['package.json']);
          assert.equal(workspace.private, true);
          assert.deepEqual(workspace.workspaces, ['apps/*', 'packages/*']);
          assert.equal(workspace.scripts.test, 'npm run test --workspaces');
        }
        if (preset === 'next') assert.ok(expected[prefix + 'src/app/page.tsx']);
        if (preset === 'ts-library') assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
      } else {
        assert.match(expected[prefix + 'pyproject.toml'], /where = \["src"\]/);
        assert.ok(expected[prefix + 'src/sample_project/__init__.py'] !== undefined);
        assert.equal(expected['package.json'], undefined);
      }
      assert.match(expected['docs/architecture.md'], /Repository layout does not require microservices/);
    });
  }
}

test('dry run returns the manifest but writes nothing', async (t) => {
  const root = await temporary(t);
  const result = await generate({ name: 'preview', preset: 'react', layout: 'single', directory: path.join(root, 'preview'), dryRun: true });
  assert.equal(result.dryRun, true);
  assert.ok(result.files.includes('src/App.tsx'));
  assert.deepEqual(await readdir(root), []);
});

test('refuses files, empty directories, nonempty directories, and symlink destinations', async (t) => {
  const root = await temporary(t);
  await writeFile(path.join(root, 'file'), 'preserve');
  await mkdir(path.join(root, 'empty'));
  await mkdir(path.join(root, 'populated'));
  await writeFile(path.join(root, 'populated', 'README.md'), 'preserve');
  await symlink(path.join(root, 'populated'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['file', 'empty', 'populated', 'link']) {
    await assert.rejects(generate({ name: 'sample', preset: 'fastapi', layout: 'single', directory: path.join(root, name) }), /already exists/);
  }
  assert.equal(await readFile(path.join(root, 'file'), 'utf8'), 'preserve');
  assert.equal(await readFile(path.join(root, 'populated', 'README.md'), 'utf8'), 'preserve');
});

test('refuses symlink ancestors and missing parents without creating output', async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, 'real'));
  await symlink(path.join(root, 'real'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const base = { name: 'sample', preset: 'react', layout: 'single' };
  await assert.rejects(generate({ ...base, directory: path.join(root, 'link', 'output') }), /symlink ancestor/);
  await assert.rejects(generate({ ...base, directory: path.join(root, 'missing', 'output') }), /ENOENT/);
  assert.deepEqual(await readdir(path.join(root, 'real')), []);
});

test('concurrent generators cannot overwrite the same destination', async (t) => {
  const root = await temporary(t);
  const options = { name: 'sample', preset: 'ts-library', layout: 'single', directory: path.join(root, 'output') };
  const results = await Promise.allSettled([generate(options), generate(options)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await readFile(path.join(root, 'output', 'src', 'index.ts'), 'utf8'), templateFiles(options)['src/index.ts']);
});

test('validates names, Python modules, presets, layouts and paths', async () => {
  const base = { name: 'sample', preset: 'react', layout: 'single' };
  for (const name of ['', '../escape', 'hello world', 'AName', 'with_quote\'', 'a--b', '-name', '1name', 'a'.repeat(65), 'nul', 'con', 'com1']) {
    assert.throws(() => validateOptions({ ...base, name }), /Name/);
  }
  for (const preset of ['missing', '__proto__', 'constructor']) {
    assert.throws(() => validateOptions({ ...base, preset }), /Unknown preset/);
  }
  assert.throws(() => validateOptions({ ...base, layout: 'mixed' }), /Layout/);
  assert.throws(() => validateOptions({ ...base, name: 'class', preset: 'python-package' }), /Python keyword/);
  validateOptions({ ...base, name: 'class' });
  await assert.rejects(generate({ ...base, directory: '' }), /non-empty path/);
  await assert.rejects(generate({ ...base, directory: path.parse(process.cwd()).root }), /filesystem root/);
});
