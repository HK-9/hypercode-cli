import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const [manifestPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !outputPath) throw new Error('Usage: node scripts/inspect-release-pack.js pack.json GITHUB_OUTPUT');
const [pack] = JSON.parse(await readFile(manifestPath, 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const expected = [
  'LICENSE', 'README.md', 'bin/hypercode-init.js', 'package.json',
  'src/cli.js', 'src/desktop.js', 'src/generate.js', 'src/review.js', 'src/skills.js', 'src/templates.js',
].sort();
const files = pack.files.map((file) => file.path).sort();
if (pack.name !== 'hypercode-init' || pack.version !== pkg.version || pack.entryCount !== expected.length ||
    JSON.stringify(files) !== JSON.stringify(expected) || !pack.integrity?.startsWith('sha512-') ||
    path.basename(pack.filename) !== pack.filename) {
  throw new Error('Packed artifact identity, integrity or exact file manifest failed validation.');
}
await appendFile(outputPath, `artifact_name=npm-release-${pack.version}\ntarball=${pack.filename}\nintegrity=${pack.integrity}\n`);
console.log(`Checked ${pack.name}@${pack.version}: ${pack.entryCount} exact files, ${pack.integrity}`);
