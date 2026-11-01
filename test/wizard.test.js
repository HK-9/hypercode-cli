import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCli } from '../src/cli.js';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-wizard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function terminal(answers, onPrompt = () => {}) {
  const logs = [];
  const prompts = [];
  let closed = false;
  return {
    logs, prompts,
    io: {
      interactive: true, log: (line) => logs.push(line),
      finishPrompt: () => { closed = true; },
      question: async (prompt) => {
        assert.equal(closed, false);
        assert.ok(answers.length > 0, `Unexpected prompt: ${prompt}`);
        prompts.push(prompt);
        await onPrompt(prompt);
        return answers.shift();
      },
    },
  };
}

test('full wizard retries names, destinations, layouts, stacks and confirmation without early writes', async (t) => {
  const root = await setup(t);
  const existing = path.join(root, 'existing');
  await mkdir(existing);
  const output = path.join(root, 'output');
  const tty = terminal([
    'Bad Name', 'sample',
    existing, path.join(root, 'missing', 'child'), output,
    'wrong', '2',
    'react,react', 'react,next', '11',
    '', 'maybe', 'yes',
  ], async () => { assert.deepEqual(await readdir(root), ['existing']); });
  const result = await runCli([], tty.io);
  assert.ok(result.files.includes('apps/api/src/sample_fastapi/main.py'));
  assert.ok(result.files.includes('apps/web/package.json'));
  assert.ok(tty.logs.some((line) => line.includes('Review your setup') && line.includes(output)));
  assert.ok(tty.logs.some((line) => line.includes('Duplicate presets')));
  assert.ok(tty.logs.some((line) => line.includes('Unsupported combination')));
  assert.ok(tty.logs.some((line) => line.includes('Next steps:') && line.includes('sample-react')));
  const pkg = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.workspaces, ['apps/web']);
});

for (const answer of ['', 'no', 'N', ':cancel']) {
  test(`confirmation ${JSON.stringify(answer)} cancels without writing`, async (t) => {
    const root = await setup(t);
    const tty = terminal(['', '4', '', answer]);
    const result = await runCli([path.join(root, 'sample')], tty.io);
    assert.equal(result.cancelled, true);
    assert.deepEqual(await readdir(root), []);
    assert.ok(tty.logs.some((line) => line.includes('No files were written')));
  });
}

test('cancellation at early prompts and rejected question write nothing', async (t) => {
  const root = await setup(t);
  for (const answers of [[':cancel'], ['sample', ':cancel'], ['sample', path.join(root, 'out'), ':cancel']]) {
    const tty = terminal(answers);
    const result = await runCli([], tty.io);
    assert.equal(result.cancelled, true);
    assert.deepEqual(await readdir(root), []);
  }
  await assert.rejects(runCli([], { interactive: true, log: () => {}, question: async () => { throw new Error('Abort'); } }), /Abort/);
});

test('wizard dry run reviews but never asks for creation confirmation', async (t) => {
  const root = await setup(t);
  const tty = terminal(['2', '12', '']);
  const result = await runCli([path.join(root, 'sample'), '--dry-run'], tty.io);
  assert.equal(result.dryRun, true);
  assert.ok(result.files.includes('apps/web/src/app/page.tsx'));
  assert.ok(result.files.includes('apps/api/pyproject.toml'));
  assert.ok(tty.logs.some((line) => line.includes('Review your setup')));
  assert.equal(tty.prompts.some((prompt) => prompt.includes('Create these files')), false);
  assert.deepEqual(await readdir(root), []);
});

test('explicit noninteractive flags bypass wizard, including on a TTY', async (t) => {
  const root = await setup(t);
  for (const interactive of [false, true]) {
    const tty = terminal([]);
    const result = await runCli([path.join(root, `out-${interactive}`), '--preset', 'ts-library', '--layout', 'single'], { ...tty.io, interactive });
    assert.equal(result.dryRun, false);
    assert.equal(tty.prompts.length, 0);
  }
  const tty = terminal(['', '']);
  const result = await runCli(['--name', 'sample', '--presets', 'react,fastapi', '--dry-run', path.join(root, 'mixed')], tty.io);
  assert.ok(tty.prompts[0].includes('[monorepo]'));
  assert.ok(result.files.includes('apps/api/pyproject.toml'));
});

test('destination is rechecked after confirmation', async (t) => {
  const root = await setup(t);
  const output = path.join(root, 'out');
  const tty = terminal(['', '4', '', 'yes'], async (prompt) => {
    if (prompt.includes('Create these files')) await mkdir(output);
  });
  await assert.rejects(runCli([output], tty.io), /already exists/);
  assert.deepEqual(await readdir(output), []);
});

test('neutral naming accepts Python keywords for Node but retries them for Python', async (t) => {
  const root = await setup(t);
  const node = terminal(['class', path.join(root, 'node'), '', '1', '', 'yes']);
  const generated = await runCli([], node.io);
  assert.ok(generated.files.includes('src/App.tsx'));
  assert.equal(node.logs.some((line) => line.includes('Python keyword')), false);
  const python = terminal(['class', path.join(root, 'python'), '', '6', 'python-project', '', 'yes']);
  const output = await runCli([], python.io);
  assert.ok(output.files.includes('src/python_project/__init__.py'));
  assert.ok(python.logs.some((line) => line.includes('Python keyword')));
  assert.ok(python.logs.some((line) => line.includes('Review your setup') && line.includes('Project: python-project')));
});

test('two Python projects print absolute working directories for sequential next steps', async (t) => {
  const root = await setup(t);
  const directory = path.join(root, 'sample');
  const tty = terminal([]);
  await runCli([directory, '--presets', 'fastapi,python-package', '--layout', 'monorepo', '--yes'], tty.io);
  const next = tty.logs.find((line) => line.includes('Next steps:'));
  const cdLines = next.split('\n').filter((line) => line.trim().startsWith('cd '));
  const destinations = cdLines.map((line) => JSON.parse(line.trim().slice(3)));
  assert.deepEqual(destinations, [directory, path.join(directory, 'apps', 'api'), path.join(directory, 'packages', 'core')]);
  assert.ok(destinations.every((destination) => path.isAbsolute(destination)));
});
