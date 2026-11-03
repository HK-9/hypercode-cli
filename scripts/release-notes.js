import { readFile, writeFile } from 'node:fs/promises';
import { extractChangelogEntry } from './release-version.js';

const [version, sourcePullRequestsPath, outputPath] = process.argv.slice(2);
if (!version || !sourcePullRequestsPath || !outputPath) {
  throw new Error('Usage: node scripts/release-notes.js version source-pull-requests.json output.md');
}
const changelog = await readFile('CHANGELOG.md', 'utf8');
const entry = extractChangelogEntry(changelog, version);
if (!entry) throw new Error(`CHANGELOG.md has no generated release entry for ${version}.`);
const pullRequests = JSON.parse(await readFile(sourcePullRequestsPath, 'utf8'));
if (!Array.isArray(pullRequests)) throw new Error('Source pull requests must be a JSON array.');
const links = pullRequests.map(({ number, url }) => {
  if (!Number.isSafeInteger(number) || number < 1 ||
      typeof url !== 'string' || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url)) {
    throw new Error('Source pull request entry is invalid.');
  }
  return `- [#${number}](${url})`;
});
const sources = links.length ? links.join('\n') : '- See the reviewed Changesets release PR for the source change summary.';
await writeFile(outputPath, `## hypercode-init ${version}\n\n${entry}\n\n### Source pull requests\n\n${sources}\n`, { flag: 'wx' });
console.log(`Prepared changelog entry and ${links.length} linked source PR(s).`);
