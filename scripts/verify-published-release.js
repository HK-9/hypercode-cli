import { compareStableVersions } from './release-version.js';

const [version, expectedIntegrity] = process.argv.slice(2);
if (!expectedIntegrity?.startsWith('sha512-')) {
  throw new Error('Usage: node scripts/verify-published-release.js version integrity');
}
compareStableVersions(version, version);
const url = `https://registry.npmjs.org/hypercode-init/${encodeURIComponent(version)}`;
let metadata;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (response.ok) {
    metadata = await response.json();
    break;
  }
  if (response.status !== 404 && response.status < 500) throw new Error(`npm verification failed with HTTP ${response.status}.`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
if (!metadata) throw new Error(`Public npm metadata for ${version} is not visible yet; do not retry publishing blindly.`);
if (metadata.name !== 'hypercode-init' || metadata.version !== version || metadata.dist?.integrity !== expectedIntegrity) {
  throw new Error('Published npm metadata does not match the immutable checked artifact.');
}
const latestResponse = await fetch('https://registry.npmjs.org/hypercode-init', {
  signal: AbortSignal.timeout(15000),
  headers: { accept: 'application/vnd.npm.install-v1+json' },
});
if (!latestResponse.ok) throw new Error(`npm latest-tag verification failed with HTTP ${latestResponse.status}.`);
const latestMetadata = await latestResponse.json();
const latest = latestMetadata['dist-tags']?.latest;
if (latestMetadata.name !== 'hypercode-init' || !latest || compareStableVersions(latest, version) < 0) {
  throw new Error(`Published ${version} is verified, but npm latest (${latest ?? 'missing'}) is older or invalid.`);
}
console.log(`Verified https://www.npmjs.com/package/hypercode-init/v/${version} integrity ${expectedIntegrity}; npm latest is ${latest}.`);
