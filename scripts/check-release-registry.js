import { appendFile } from 'node:fs/promises';
import { getRegistryReleaseAction } from './release-version.js';

const [version, expectedIntegrity, outputPath] = process.argv.slice(2);
if (!expectedIntegrity?.startsWith('sha512-') || !outputPath) {
  throw new Error('Usage: node scripts/check-release-registry.js version integrity GITHUB_OUTPUT');
}
if (version === '0.1.0') throw new Error('Refusing to publish or republish the already-published initial version 0.1.0.');

async function fetchRegistryJson(url) {
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/vnd.npm.install-v1+json' } });
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response.ok) throw new Error(`npm registry lookup failed with HTTP ${response.status}; refusing publication.`);
  return response.json();
}

const latestMetadata = await fetchRegistryJson('https://registry.npmjs.org/hypercode-init');
const latestVersion = latestMetadata['dist-tags']?.latest;
if (latestMetadata.name !== 'hypercode-init' || !latestVersion) {
  throw new Error('npm registry did not return a valid hypercode-init latest dist-tag; refusing publication.');
}
const versionUrl = `https://registry.npmjs.org/hypercode-init/${encodeURIComponent(version)}`;
let versionResponse;
for (let attempt = 0; attempt < 4; attempt++) {
  versionResponse = await fetch(versionUrl, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/vnd.npm.install-v1+json' } });
  if (versionResponse.status !== 429 && versionResponse.status < 500) break;
  await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
}
if (versionResponse.status === 404) {
  const action = getRegistryReleaseAction(version, latestVersion, null, expectedIntegrity);
  if (action !== 'publish') throw new Error(`Unexpected registry release action: ${action}`);
  await appendFile(outputPath, 'already_published=false\n');
  console.log(`Registry has no hypercode-init@${version}; latest is ${latestVersion}, so the approved version is safe to publish.`);
} else {
  if (!versionResponse.ok) throw new Error(`npm registry lookup failed with HTTP ${versionResponse.status}; refusing publication.`);
  const metadata = await versionResponse.json();
  const action = getRegistryReleaseAction(version, latestVersion, metadata, expectedIntegrity);
  if (action !== 'skip') throw new Error(`Unexpected registry release action: ${action}`);
  await appendFile(outputPath, 'already_published=true\n');
  console.log(`Registry already contains the identical ${version} artifact and latest is ${latestVersion}; retry will verify and record it without republishing.`);
}
