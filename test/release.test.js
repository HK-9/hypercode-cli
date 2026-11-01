import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareStableVersions, extractChangelogEntry, getRegistryReleaseAction } from '../scripts/release-version.js';

const integrity = 'sha512-dGVzdA==';

test('stable SemVer comparison orders numeric components', () => {
  assert.equal(compareStableVersions('0.1.1', '0.1.0'), 1);
  assert.equal(compareStableVersions('0.2.0', '0.1.9'), 1);
  assert.equal(compareStableVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareStableVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareStableVersions('0.1.9', '0.2.0'), -1);
  assert.throws(() => compareStableVersions('v1.0.0', '1.0.0'), /Invalid stable version/);
});

test('registry gate permits only a new version above npm latest', () => {
  assert.equal(getRegistryReleaseAction('0.1.1', '0.1.0', null, integrity), 'publish');
  assert.throws(() => getRegistryReleaseAction('0.1.0', '0.1.0', null, integrity), /downgrade/);
  assert.throws(() => getRegistryReleaseAction('0.1.1', '0.2.0', null, integrity), /downgrade/);
});

test('registry retry skips an exact artifact only when latest is not behind', () => {
  const existing = { name: 'hypercode-init', version: '0.1.1', dist: { integrity } };
  assert.equal(getRegistryReleaseAction('0.1.1', '0.1.1', existing, integrity), 'skip');
  assert.equal(getRegistryReleaseAction('0.1.1', '0.2.0', existing, integrity), 'skip');
  assert.throws(() => getRegistryReleaseAction('0.1.1', '0.1.0', existing, integrity), /latest is 0.1.0/);
  assert.throws(() => getRegistryReleaseAction('0.1.1', '0.1.1', existing, 'sha512-other'), /different integrity/);
  assert.throws(() => getRegistryReleaseAction('0.1.1', '0.1.1', { ...existing, name: 'wrong' }, integrity), /mismatched package identity/);
});

test('changelog extraction keeps multiline Changesets sections and stops at adjacent releases', () => {
  const changelog = `# Changelog

## 0.1.1

### Patch Changes

- Fix scanner.
- Preserve the second release note.

## 0.1.0

- Initial release.
`;
  assert.equal(
    extractChangelogEntry(changelog, '0.1.1'),
    '### Patch Changes\n\n- Fix scanner.\n- Preserve the second release note.',
  );
  assert.equal(extractChangelogEntry(changelog, '0.1.0'), '- Initial release.');
  assert.equal(extractChangelogEntry(changelog, '0.2.0'), null);
});

test('release notes script writes the checked changelog section and source links', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercode-release-notes-'));
  try {
    const sourcesPath = path.join(directory, 'sources.json');
    const outputPath = path.join(directory, 'release-notes.md');
    await writeFile(sourcesPath, JSON.stringify([{ number: 42, url: 'https://github.com/HK-9/hypercode-cli/pull/42' }]));
    const script = path.resolve('scripts/release-notes.js');
    const result = spawnSync(process.execPath, [script, '0.1.0', sourcesPath, outputPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const notes = await readFile(outputPath, 'utf8');
    assert.match(notes, /## hypercode-init 0\.1\.0/);
    assert.match(notes, /### Source pull requests\n\n- \[#42\]\(https:\/\/github\.com\/HK-9\/hypercode-cli\/pull\/42\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
