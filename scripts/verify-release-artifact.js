import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [tarball, manifestPath, expectedVersion, expectedIntegrity, outputPath] = process.argv.slice(2);
if (!tarball || !manifestPath || !expectedVersion || !expectedIntegrity || !outputPath) {
  throw new Error('Usage: node scripts/verify-release-artifact.js tarball pack.json version integrity GITHUB_OUTPUT');
}
const [pack] = JSON.parse(await readFile(manifestPath, 'utf8'));
const bytes = await readFile(tarball);
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
if (pack.name !== 'hypercode-init' || pack.version !== expectedVersion ||
    pack.integrity !== expectedIntegrity || integrity !== expectedIntegrity) {
  throw new Error('Downloaded release artifact does not match the reviewed package/version/integrity.');
}
await appendFile(outputPath, `integrity=${integrity}\n`);
console.log(`Immutable ${pack.name}@${pack.version} tarball verified: ${integrity}`);
