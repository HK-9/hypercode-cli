import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareStableVersions } from './release-version.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const changesets = JSON.parse(await readFile(path.join(root, '.changeset', 'config.json'), 'utf8'));
const requiredFiles = [
  '.github/CODEOWNERS',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/ci.yml',
  '.github/workflows/changesets.yml',
  '.github/workflows/npm-release.yml',
  'scripts/release-version.js',
  'scripts/release-notes.js',
];
const failures = [];

if (pkg.name !== 'hypercode-init') failures.push('package.name must stay hypercode-init.');
try {
  if (compareStableVersions(pkg.version, '0.1.0') < 0) failures.push('package.version must be at or above the published 0.1.0 baseline.');
} catch {
  failures.push('package.version must be a stable numeric version at or above the published 0.1.0 baseline.');
}
if (pkg.private === true) failures.push('package.private must not be true for public publishing.');
if (pkg.license !== 'MIT') failures.push('package.license must be MIT.');
if (pkg.bin?.['hypercode-init'] !== './bin/hypercode-init.js') failures.push('The hypercode-init executable mapping is missing.');
if (!pkg.engines?.node || !/^>=22\./.test(pkg.engines.node)) failures.push('A supported Node engine minimum must be declared.');
if (pkg.repository?.url !== 'git+https://github.com/HK-9/hypercode-cli.git') failures.push('Repository metadata must point to HK-9/hypercode-cli.');
if (!pkg.devDependencies?.['@changesets/cli']) failures.push('@changesets/cli must be a development dependency.');
if (changesets.baseBranch !== 'main' || changesets.access !== 'public' || changesets.commit !== false) failures.push('Changesets must target main, publish publicly and leave versioning to the bot PR.');
if (pkg.scripts?.['release:version'] !== 'changeset version && npm install --package-lock-only --ignore-scripts --no-audit --no-fund') failures.push('The release version script must run Changesets and synchronize the npm lockfile.');
if (pkg.scripts?.['validate:release'] !== 'node scripts/validate-release.js') failures.push('The release metadata validator script mapping is missing.');

for (const relative of requiredFiles) {
  try { await access(path.join(root, relative)); }
  catch { failures.push(`Required release file is missing: ${relative}`); }
}
const owners = await readFile(path.join(root, '.github', 'CODEOWNERS'), 'utf8').catch(() => '');
if (!owners.split(/\r?\n/).some((line) => /^\s*\*\s+@HK-9\s*(?:#.*)?$/.test(line))) failures.push('CODEOWNERS must require @HK-9 for all files.');
const ci = await readFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8').catch(() => '');
if (!/^name:\s*hypercode-ci\s*$/m.test(ci) || !/^\s{2}hypercode-ci:\s*$/m.test(ci) || !/workflow_dispatch:/m.test(ci)) failures.push('CI must expose stable hypercode-ci and support workflow_dispatch.');
if (!/fetch-depth:\s*0/.test(ci) || !/git fetch --no-tags origin \+refs\/heads\/main:refs\/remotes\/origin\/main/.test(ci)) failures.push('CI must fetch full history and the Changesets comparison base before checking PR changesets.');
const publish = await readFile(path.join(root, '.github', 'workflows', 'npm-release.yml'), 'utf8').catch(() => '');
if (!/environment:\s*\n\s*name:\s*npm-release/m.test(publish) || !/id-token:\s*write/m.test(publish) || !/contents:\s*write/m.test(publish)) failures.push('npm publication must use protected npm-release environment and scoped OIDC permissions.');
if (!/group:\s*npm-release-publish/.test(publish) || !/scripts\/check-release-registry\.js/.test(publish) || !/scripts\/verify-published-release\.js/.test(publish)) failures.push('npm publication must serialize releases and check registry state before and after publishing.');
if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(publish)) failures.push('Do not use long-lived npm publish tokens.');

if (failures.length) {
  console.error(`Release metadata validation failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Release metadata validated: package identity, Changesets, ownership, required workflows and protected OIDC publishing.');
}
