export function compareStableVersions(left, right) {
  const parse = (value) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? '');
    if (!match) throw new Error(`Invalid stable version: ${value}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function getRegistryReleaseAction(version, latestVersion, existing, expectedIntegrity) {
  const latestComparison = compareStableVersions(version, latestVersion);
  if (!expectedIntegrity?.startsWith('sha512-')) throw new Error('Expected artifact integrity must use sha512.');
  if (!existing) {
    if (latestComparison <= 0) {
      throw new Error(`Refusing to publish ${version}: npm latest is already ${latestVersion}, so publishing could downgrade the latest tag.`);
    }
    return 'publish';
  }
  if (existing.name !== 'hypercode-init' || existing.version !== version) {
    throw new Error('Registry returned a mismatched package identity.');
  }
  if (existing.dist?.integrity !== expectedIntegrity) {
    throw new Error(`Version ${version} already exists with different integrity; refusing to overwrite or republish.`);
  }
  if (latestComparison > 0) {
    throw new Error(`Version ${version} exists, but npm latest is ${latestVersion}; refusing to record a release while the latest tag is behind.`);
  }
  return 'skip';
}

export function extractChangelogEntry(changelog, version) {
  const heading = `## ${version}`;
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const entry = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return entry || null;
}
