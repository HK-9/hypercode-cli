import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.js';

const binary = fileURLToPath(new URL('../bin/hypercode-init.js', import.meta.url));
const invoke = (args, cwd) => spawnSync(process.execPath, [binary, ...args], { cwd, encoding: 'utf8', timeout: 10_000 });

test('binary help and version work without prompting', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const help = invoke(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /HyperCodeLabs/);
  assert.match(help.stdout, /monorepo/);
  assert.match(help.stdout, /Bootstrap: supported monorepo pair; skills-only: unique known presets/);
  assert.match(help.stdout, /Skills-only: optional, validated; does not change skill content/);
  assert.match(help.stdout, /Bootstrap also requires --layout; skills-only requires --agent/);
  assert.match(help.stdout, /Skills-only accepts any unique known preset set; no layout is required or inferred/);
  const version = invoke(['--version']);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), pkg.version);
});

test('binary rejects invalid or incomplete arguments with a nonzero exit', () => {
  for (const args of [[], ['--yes'], ['--unknown'], ['one', 'two'], ['--preset', 'missing', '--layout', 'single', '--name', 'sample']]) {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hypercode-init:/);
  }
});

test('non-interactive binary generates and dry-runs in a path containing spaces', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode cli '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const flags = ['--yes', '--preset', 'fastify', '--layout', 'monorepo'];
  const preview = invoke(['sample', ...flags, '--dry-run'], root);
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(JSON.parse(preview.stdout).files.includes('apps/api/src/server.ts'));
  assert.deepEqual(await readdir(root), []);
  const created = invoke(['sample', ...flags], root);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /Dependencies have not been installed/);
  const again = invoke(['sample', ...flags], root);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
});

test('interactive selection explains tradeoffs and defaults to single', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-interactive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const answers = ['', '2', '', 'yes'];
  const prompts = [];
  const logs = [];
  const result = await runCli([path.join(root, 'sample')], {
    interactive: true, version: 'test', log: (text) => logs.push(text),
    question: async (prompt) => { prompts.push(prompt); return answers.shift(); },
  });
  assert.equal(prompts.length, 4);
  assert.ok(result.files.includes('src/app/page.tsx'));
  assert.ok(logs.some((text) => text.includes('extra CI/release coupling')));
});

test('interactive name and id selection, and fully supplied options never prompt', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-name-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const answers = ['monorepo', 'python-package', '', 'yes'];
  const result = await runCli(['--name', 'sample', path.join(root, 'output')], {
    interactive: true, log: () => {},
    question: async () => answers.shift(),
  });
  assert.ok(result.files.includes('packages/core/pyproject.toml'));
  await runCli([path.join(root, 'other'), '--preset', 'react', '--layout', 'single', '--yes', '--dry-run'], {
    interactive: true, log: () => {},
    question: async () => { assert.fail('should not prompt'); },
  });
  await assert.rejects(runCli(['--name', 'sample', '--yes'], { interactive: true, log: () => {} }), /Non-interactive/);
});

test('interactive name selection can preview and cancellation never creates files', async (t) => {
  const answers = ['named-project', '', '', '6', ''];
  const prompts = [];
  let finished = false;
  const preview = await runCli(['--dry-run'], {
    interactive: true, log: () => {},
    question: async (prompt) => { prompts.push(prompt); return answers.shift(); },
    finishPrompt: () => { finished = true; },
  });
  assert.equal(finished, true);
  assert.equal(prompts.length, 5);
  assert.ok(preview.files.includes('src/named_project/__init__.py'));
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercode-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(runCli([path.join(root, 'cancelled')], {
    interactive: true, log: () => {},
    question: async () => { throw new Error('Cancelled'); },
  }), /Cancelled/);
  assert.deepEqual(await readdir(root), []);
});
