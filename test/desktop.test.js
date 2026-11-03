import assert from 'node:assert/strict';
import { test } from 'node:test';
import { templateFiles } from '../src/templates.js';
import { validateOptions } from '../src/generate.js';
import { runCli } from '../src/cli.js';

test('Electron separates privileged processes and restricts authority', () => {
  const files = templateFiles({ name: 'desktop', preset: 'electron', layout: 'single' });
  const pkg = JSON.parse(files['package.json']);
  assert.equal(pkg.main, '.vite/build/main.cjs');
  assert.equal(pkg.engines.node, '>=22.13.0');
  assert.equal(pkg.scripts.build, 'electron-forge package');
  assert.equal(pkg.dependencies, undefined);
  assert.ok(files['src/preload/preload.ts'].includes('contextBridge'));
  assert.ok(files['src/shared/bridge.ts'].includes('Promise<string>'));
  const main = files['src/main/main.ts'];
  for (const requirement of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'senderFrame', 'trustedSender', "action: 'deny'", "protocol.handle('app'", 'setPermissionCheckHandler']) {
    assert.ok(main.includes(requirement), requirement);
  }
  assert.doesNotMatch(files['index.html'], /unsafe-inline|unsafe-eval/);
  const mono = templateFiles({ name: 'desktop', preset: 'electron', layout: 'monorepo' });
  assert.equal(mono['.npmrc'], 'install-strategy=nested\n');
  assert.equal(JSON.parse(mono['package.json']).engines.node, '>=22.13.0');
  assert.match(mono['README.md'], /22\.13\+/);
  assert.ok(mono['apps/desktop/forge.config.cjs']);
});

test('Tauri has explicit command permissions, Rust checks, static assets and typed invocation', () => {
  const files = templateFiles({ name: 'desktop', preset: 'tauri', layout: 'single' });
  const pkg = JSON.parse(files['package.json']);
  assert.equal(pkg.scripts.build, 'tauri build --no-bundle');
  assert.ok(pkg.scripts['lint:rust'].includes('-D warnings'));
  const config = JSON.parse(files['src-tauri/tauri.conf.json']);
  assert.deepEqual(config.app.security.capabilities, ['main']);
  const capability = JSON.parse(files['src-tauri/capabilities/main.json']);
  assert.deepEqual(capability.permissions, ['allow-greet']);
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.remote, undefined);
  assert.ok(files['src-tauri/build.rs'].includes('commands(&["greet"])'));
  assert.ok(files['src/native/greet.ts'].includes("invoke<string>('greet'"));
  assert.ok(files['src-tauri/src/commands.rs'].includes('#[test]'));
  assert.ok(Buffer.isBuffer(files['src-tauri/icons/icon.png']));
  assert.equal(config.bundle.active, false);
  assert.doesNotMatch(config.app.security.csp, /unsafe-inline/);
  assert.match(config.app.security.devCsp, /unsafe-inline/);
});

test('desktop documentation covers native boundaries and owner distribution responsibilities', () => {
  for (const preset of ['electron', 'tauri']) {
    const files = templateFiles({ name: 'desktop', preset, layout: 'single' });
    for (const term of ['signing', 'notarization', 'auto-update', 'distribution']) {
      assert.ok(files['README.md'].toLowerCase().includes(term), `${preset}: ${term}`);
    }
    assert.match(files['docs/architecture.md'], /Desktop boundary/);
    assert.match(files['docs/adr/0001-project-structure.md'], /Desktop decision/);
    assert.match(files['docs/operations.md'], /Desktop release readiness/);
    assert.throws(() => validateOptions({ name: 'desktop', presets: [preset, 'ts-library'], layout: 'monorepo' }), /Unsupported combination/);
  }
});

test('wizard dynamically includes desktop presets without conflicting pair numbers', async () => {
  for (const [id, number] of [['electron', '7'], ['tauri', '8']]) {
    const answers = ['', '', number, ''];
    const result = await runCli(['--name', 'desktop', '--dry-run'], {
      interactive: true, log: () => {}, question: async () => {
        assert.ok(answers.length);
        return answers.shift();
      },
    });
    assert.ok(result.files.includes(id === 'tauri' ? 'src-tauri/Cargo.toml' : 'forge.config.cjs'));
  }
});
