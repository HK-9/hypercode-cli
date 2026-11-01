import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, writeFile, symlink, rm, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../src/generate.js';
import { presets, combinations, templateFiles } from '../src/templates.js';
import { skillFiles, installSkills } from '../src/skills.js';
import { runCli } from '../src/cli.js';

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercode-skills-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

const base = { name: 'sample', preset: 'react', layout: 'single', agent: 'copilot' };
const binary = fileURLToPath(new URL('../bin/hypercode-init.js', import.meta.url));

function verifySkills(files, count) {
  const skills = Object.entries(files).filter(([file]) => file.endsWith('/SKILL.md'));
  assert.equal(skills.length, count);
  for (const [file, content] of skills) {
    const match = /^---\nname: ([a-z0-9-]+)\ndescription: ("[^\n]+")\n---\n\n/.exec(content);
    assert.ok(match, file);
    const [, name, description] = match;
    assert.ok(name.length <= 64);
    assert.doesNotMatch(name, /--|^-|-$|^verify$|^code-review$/);
    assert.equal(file.split('/').at(-2), name);
    const parsed = JSON.parse(description);
    assert.ok(parsed.length > 0 && parsed.length <= 1024);
    assert.match(parsed, /Use when/);
    assert.ok(content.split('\n').length < 500);
    assert.doesNotMatch(content, /allowed-tools:|hooks:|!`/);
    assert.match(content, /\]\(references\/conventions.md\)/);
    assert.ok(files[file.replace('SKILL.md', 'references/conventions.md')]);
  }
}

test('all presets/layouts generate standard namespaced skills for each agent without duplicate locations', async (t) => {
  const root = await setup(t);
  for (const preset of Object.keys(presets)) {
    for (const layout of ['single', 'monorepo']) {
      for (const agent of ['none', 'copilot', 'claude', 'both', 'all', 'copilot,claude']) {
        const options = { ...base, preset, layout, agent, directory: path.join(root, `${preset}-${layout}-${agent}`) };
        const skills = skillFiles(options);
        verifySkills(skills, agent === 'none' ? 0 : 3);
        const result = await generate({ ...options, dryRun: true });
        assert.equal(result.files.length, Object.keys(templateFiles(options)).length + Object.keys(skills).length);
        if (agent !== 'none') {
          const location = agent === 'copilot' ? '.github/skills/' : '.claude/skills/';
          assert.ok(Object.keys(skills).every((file) => file.startsWith(location)));
          const reference = skills[`${location}hypercode-${preset}/references/conventions.md`];
          assert.match(reference, /Single-project and monorepo layouts/);
          assert.match(reference, /actual project|actual source/);
        }
      }
    }
  }
  assert.deepEqual(await readdir(root), []);
});

test('bounded compositions include only selected stack skills and separate environment guidance', () => {
  for (const selected of combinations) {
    const files = skillFiles({ name: 'sample', presets: selected, layout: 'monorepo', agent: 'both' });
    verifySkills(files, 4);
    for (const id of Object.keys(presets)) {
      assert.equal(Object.keys(files).some((file) => file.endsWith(`hypercode-${id}/SKILL.md`)), selected.includes(id));
    }
    assert.match(Object.values(files).join('\n'), /never assume npm runs Python\/Rust checks/);
  }
});

test('skills teach real project inspection, documentation and native authority rather than automatic actions', () => {
  const files = skillFiles({ ...base, preset: 'tauri' });
  const content = Object.values(files).join('\n');
  for (const requirement of [/AppManifest/, /sender validation/, /production CSP/, /Conventional Commits/, /superseding decisions/, /actual manifests/, /not proof/, /Do not automatically commit/, /Do not claim they are configured or automatically publish\/sign/]) {
    assert.match(content, requirement);
  }
});

test('standalone previews and repeated installs preserve application code, docs, manifests and instructions', async (t) => {
  const root = await setup(t);
  const before = { 'package.json': '{"scripts":{"test":"custom runner"}}', 'README.md': '# Existing', 'CLAUDE.md': '# Instructions', 'copilot-instructions.md': '# Existing guidance', 'package-lock.json': '{}', 'app.ts': 'const existing = true;' };
  for (const [file, content] of Object.entries(before)) await writeFile(path.join(root, file), content);
  const options = { ...base, directory: root };
  const preview = await installSkills({ ...options, dryRun: true });
  assert.equal(preview.create.length, 6);
  assert.deepEqual((await readdir(root)).sort(), Object.keys(before).sort());
  const result = await installSkills(options);
  assert.deepEqual(result.create, preview.create);
  for (const [relative, content] of Object.entries(skillFiles(options))) assert.equal(await readFile(path.join(root, relative), 'utf8'), content);
  for (const [file, content] of Object.entries(before)) assert.equal(await readFile(path.join(root, file), 'utf8'), content);
  const repeated = await installSkills(options);
  assert.deepEqual(repeated.create, []);
  assert.deepEqual(repeated.unchanged, preview.create);
});

test('incremental stack additions retain stable common skills and previously installed stacks', async (t) => {
  const root = await setup(t);
  await installSkills({ ...base, directory: root });
  const next = await installSkills({ ...base, preset: 'tauri', directory: root });
  assert.equal(next.create.length, 2);
  assert.equal(next.unchanged.length, 4);
  const repeated = await installSkills({ ...base, presets: ['react', 'tauri'], preset: undefined, directory: root });
  assert.equal(repeated.create.length, 0);
  assert.equal(repeated.unchanged.length, 8);
  const reactFile = path.join(root, '.github', 'skills', 'hypercode-react', 'SKILL.md');
  await writeFile(reactFile, '# User-customized React guidance');
  const third = await installSkills({ ...base, preset: 'electron', directory: root });
  assert.equal(third.create.length, 2);
  assert.equal(await readFile(reactFile, 'utf8'), '# User-customized React guidance');
  const alternate = path.join(root, '.claude', 'skills', 'hypercode-python-package');
  await mkdir(alternate, { recursive: true });
  await writeFile(path.join(alternate, 'SKILL.md'), '# Unrelated customized skill');
  const fourth = await installSkills({ ...base, preset: 'fastapi', directory: root });
  assert.equal(fourth.create.length, 2);
  assert.equal(await readFile(path.join(alternate, 'SKILL.md'), 'utf8'), '# Unrelated customized skill');
});

test('bootstrap skills can be extended without repeating their layout and remain stable across layout hints', async (t) => {
  const root = await setup(t);
  const directory = path.join(root, 'sample');
  await generate({ ...base, agent: 'all', directory });
  const added = await runCli(['skills', 'add', directory, '--agent', 'all', '--presets', 'react,tauri', '--yes'], { interactive: false, log: () => {} });
  assert.equal(added.create.length, 2);
  assert.equal(added.unchanged.length, 6);
  const repeated = await installSkills({ ...base, preset: undefined, presets: ['react', 'tauri'], agent: 'all', layout: 'monorepo', directory });
  assert.equal(repeated.create.length, 0);
  assert.equal(repeated.unchanged.length, 8);
});

test('nonexistent configured home does not block a valid project installation', async (t) => {
  const root = await setup(t);
  const result = await installSkills({ ...base, directory: root }, { homeDirectory: path.join(root, 'absent-home') });
  assert.equal(result.create.length, 6);
});

test('preflight rejects a last-output conflict without writing any earlier outputs', async (t) => {
  const root = await setup(t);
  const files = Object.keys(skillFiles(base));
  const conflict = path.join(root, files.at(-1));
  await mkdir(path.dirname(conflict), { recursive: true });
  await writeFile(conflict, 'User changes');
  for (const dryRun of [true, false]) await assert.rejects(installSkills({ ...base, directory: root, dryRun }), /Existing skill differs.*Nothing was written/);
  assert.equal(await readFile(conflict, 'utf8'), 'User changes');
  await assert.rejects(readFile(path.join(root, files[0])), { code: 'ENOENT' });
});

test('user edits, extra resources and switching discovery locations fail transparently', async (t) => {
  const root = await setup(t);
  const options = { ...base, directory: root };
  await installSkills(options);
  await assert.rejects(installSkills({ ...options, agent: 'all' }), /alternate discovery location/);
  const folder = path.join(root, '.github', 'skills', 'hypercode-react');
  await writeFile(path.join(folder, 'notes.md'), 'User-owned resource');
  await assert.rejects(installSkills(options), /user resources/);
  await rm(path.join(folder, 'notes.md'));
  const filename = path.join(folder, 'SKILL.md');
  await writeFile(filename, '# Customized');
  await assert.rejects(installSkills(options), /Existing skill differs/);
  assert.equal(await readFile(filename, 'utf8'), '# Customized');
});

test('skills-only refuses missing/file destinations and symlinks in destinations, ancestors or resources', async (t) => {
  const root = await setup(t);
  const project = path.join(root, 'project');
  await mkdir(project);
  const invoke = (directory) => installSkills({ ...base, directory });
  await assert.rejects(invoke(path.join(root, 'absent')), /existing project directory/);
  await writeFile(path.join(root, 'file'), 'not a directory');
  await assert.rejects(invoke(path.join(root, 'file')), /existing project directory/);
  const link = path.join(root, 'linked');
  await symlink(project, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(invoke(link), /symlink/);
  await mkdir(path.join(project, 'nested'));
  await assert.rejects(invoke(path.join(link, 'nested')), /symlink/);
  await symlink(project, path.join(project, '.github'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(invoke(project), /symlink/);
  await rm(path.join(project, '.github'));
  const folder = path.join(project, '.github', 'skills', 'hypercode-react');
  await mkdir(folder, { recursive: true });
  await symlink(project, path.join(folder, 'references'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(invoke(project), /symlink/);
  assert.deepEqual(await readdir(folder), ['references']);
});

test('installed operation requires explicit selections and rejects unknown/duplicate presets and global destinations', async (t) => {
  const root = await setup(t);
  const flags = ['skills', 'add', root, '--agent', 'copilot', '--yes'];
  for (const args of [
    flags, [...flags, '--preset', 'unknown'],
    [...flags, '--presets', 'react,react', '--layout', 'monorepo'],
    [...flags, '--presets', 'electron,missing', '--layout', 'monorepo'],
    [...flags, '--preset', 'react', '--layout', 'single', '--name', 'other'],
    [root, '--preset', 'react', '--layout', 'single', '--agent', 'unknown', '--yes'],
    [...flags, '--agent-skills', 'claude'],
  ]) {
    const result = spawnSync(process.execPath, [binary, ...args], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /hypercode-init:/);
  }
  await assert.rejects(installSkills({ ...base, directory: os.homedir() }), /project-local/);
  if (process.platform === 'win32') await assert.rejects(installSkills({ ...base, directory: os.homedir().toUpperCase() }), /project-local/);
  await assert.rejects(installSkills({ ...base, directory: path.parse(root).root }), /project-local/);
  assert.deepEqual(await readdir(root), []);
});

test('skills-only accepts any unique known stack set, with optional layout and no scaffold composition claims', async (t) => {
  const root = await setup(t);
  for (const [index, selected] of [['electron', 'tauri'], ['react', 'electron', 'tauri']].entries()) {
    const directory = path.join(root, `existing-${index}`);
    await mkdir(directory);
    const result = await runCli(['skills', 'add', directory, '--agent', 'all', '--presets', selected.join(','), '--yes'], { interactive: false, log: () => {} });
    assert.equal(result.create.length, (2 + selected.length) * 2);
    for (const id of selected) assert.match(await readFile(path.join(directory, '.claude', 'skills', `hypercode-${id}`, 'SKILL.md'), 'utf8'), new RegExp(`name: hypercode-${id}`));
    assert.match(await readFile(path.join(directory, '.claude', 'skills', 'hypercode-electron', 'references', 'conventions.md'), 'utf8'), /Discover the actual layout/);
    assert.deepEqual(await readdir(directory), ['.claude']);
  }
});

test('late exclusive-write conflicts roll back only this invocation and preserve the conflicting external file', async (t) => {
  const root = await setup(t);
  let count = 0;
  const files = Object.keys(skillFiles(base));
  const result = installSkills({ ...base, directory: root }, {
    openFile: async (filename, flags) => {
      if (++count === 4) await writeFile(filename, 'Concurrent user write');
      return open(filename, flags);
    },
  });
  await assert.rejects(result, /EEXIST.*rolled back/);
  assert.equal(await readFile(path.join(root, files[3]), 'utf8'), 'Concurrent user write');
  for (const file of files.filter((_, index) => index !== 3)) await assert.rejects(readFile(path.join(root, file)), { code: 'ENOENT' });
});

test('late write failures roll back newly created files and directories; rollback preserves external edits and reports failure', async (t) => {
  const root = await setup(t);
  const options = { ...base, directory: root };
  let count = 0;
  await assert.rejects(installSkills(options, { openFile: async (filename, flags) => {
    if (++count === 3) throw Object.assign(new Error('Injected disk failure'), { code: 'EIO' });
    return open(filename, flags);
  } }), /Injected disk failure.*rolled back/);
  assert.deepEqual(await readdir(root), []);
  count = 0;
  const first = path.join(root, Object.keys(skillFiles(base))[0]);
  await assert.rejects(installSkills(options, { openFile: async (filename, flags) => {
    if (++count === 3) {
      await writeFile(first, 'External edit preserved');
      throw new Error('Late failure');
    }
    return open(filename, flags);
  } }), /Rollback incomplete.*changed externally/);
  assert.equal(await readFile(first, 'utf8'), 'External edit preserved');
});

test('a failure during an exclusive file write closes the handle and rolls back even partial bytes', async (t) => {
  const root = await setup(t);
  let count = 0;
  await assert.rejects(installSkills({ ...base, directory: root }, {
    openFile: async (filename, flags) => {
      const handle = await open(filename, flags);
      if (++count !== 3) return handle;
      return {
        stat: (...args) => handle.stat(...args),
        close: () => handle.close(),
        writeFile: async () => {
          await handle.writeFile('partial content');
          throw Object.assign(new Error('Injected mid-write failure'), { code: 'EIO' });
        },
      };
    },
  }), /mid-write failure.*rolled back/);
  assert.deepEqual(await readdir(root), []);
});

test('flags aliases and --yes remain noninteractive and old flags add no skill files', async (t) => {
  const root = await setup(t);
  const io = { interactive: true, log: () => {}, question: () => assert.fail('No prompts for full flags') };
  for (const [flag, agent] of [['--agent', 'all'], ['--agent-skills', 'copilot,claude'], ['--agent', 'none']]) {
    const directory = path.join(root, `out-${agent.replace(',', '-')}`);
    const result = await runCli([directory, '--preset', 'electron', '--layout', 'single', flag, agent, '--yes'], io);
    assert.equal(result.files.filter((file) => file.endsWith('/SKILL.md')).length, agent === 'none' ? 0 : 3);
  }
  const old = await runCli([path.join(root, 'old'), '--preset', 'react', '--layout', 'single'], io);
  assert.equal(old.files.some((file) => file.includes('/skills/')), false);
  const project = path.join(root, 'existing');
  await mkdir(project);
  const result = await runCli(['skills', 'add', project, '--agent', 'claude', '--presets', 'react,fastapi', '--layout', 'monorepo', '--yes', '--dry-run'], io);
  assert.equal(result.create.length, 8);
  assert.deepEqual(await readdir(project), []);
});

function terminal(answers, before = async () => {}) {
  const logs = [];
  return {
    logs, interactive: true, log: (text) => logs.push(text),
    question: async (prompt) => {
      await before(prompt);
      assert.ok(answers.length, `Unexpected prompt ${prompt}`);
      return answers.shift();
    },
  };
}

test('wizard retries agent choices, reviews skill outputs and confirms before writes', async (t) => {
  const root = await setup(t);
  const tty = terminal(['', '1', 'missing', '4', 'yes'], async () => assert.deepEqual(await readdir(root), []));
  const result = await runCli([path.join(root, 'sample')], tty);
  assert.ok(result.files.includes('.claude/skills/hypercode-react/SKILL.md'));
  assert.ok(tty.logs.some((text) => text.includes('Please try again: Agent')));
  assert.ok(tty.logs.some((text) => text.includes('Skill outputs:') && text.includes('hypercode-react/SKILL.md')));
});

test('agent-step cancellation, default-no confirmation and dry-run write nothing', async (t) => {
  const root = await setup(t);
  for (const answers of [['', '1', ':cancel'], ['', '1', 'copilot', ''], ['', '1', 'claude', 'no']]) {
    const result = await runCli([path.join(root, 'sample')], terminal(answers));
    assert.equal(result.cancelled, true);
    assert.deepEqual(await readdir(root), []);
  }
  const result = await runCli([path.join(root, 'sample'), '--dry-run'], terminal(['', '1', 'copilot']));
  assert.equal(result.dryRun, true);
  assert.ok(result.files.includes('.github/skills/hypercode-react/SKILL.md'));
  assert.deepEqual(await readdir(root), []);
});

test('existing-project guided installation reviews new files, supports cancellation and retries confirmation', async (t) => {
  const root = await setup(t);
  const flags = ['skills', 'add', root, '--preset', 'tauri', '--layout', 'single'];
  const rejected = await runCli(flags, terminal(['copilot', '']));
  assert.equal(rejected.cancelled, true);
  assert.deepEqual(await readdir(root), []);
  const tty = terminal(['all', 'maybe', 'yes'], async () => assert.deepEqual(await readdir(root), []));
  const installed = await runCli(flags, tty);
  assert.equal(installed.create.length, 6);
  assert.ok(tty.logs.some((text) => text.includes('Review skill installation')));
  assert.ok(tty.logs.some((text) => text.includes('Please enter yes or no')));
});
