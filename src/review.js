import { constants } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { inspectPath } from './skills.js';

const defaults = { depth: 8, entries: 5000, fileBytes: 131072, totalBytes: 1048576, sourceFiles: 40 };
const excludedDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', '.venv', 'venv', 'env',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox',
  'dist', 'build', 'target', 'coverage', '.next', '.nuxt', '.output', '.turbo',
  '.cache', '.vite', '.idea', '.vscode', '.terminal-check',
]);
const manifests = new Set(['package.json', 'pyproject.toml', 'Cargo.toml', 'pnpm-workspace.yaml', 'tauri.conf.json']);
const docName = /^(readme|contributing|changelog|changes|history)(?:\.(?:md|rst|txt))?$/i;
const secretName = /^(?:\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?)$|\.(?:pem|key|p12|pfx|keystore)$/i;
const sourceName = /\.(?:[cm]?[jt]sx?|py|rs|go|java|rb|cs|[ch](?:pp)?)$/i;
const testPath = (file) => /(?:^|\/)(?:tests?|__tests__)\//.test(file) ||
  /(?:^|\/)test_[^/]+\.py$|(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$|(?:^|\/)[^/]+_test\.go$/.test(file);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const join = (parent, child) => parent === '.' ? child : `${parent}/${child}`;
const within = (file, folder) => folder === '.' || file === folder || file.startsWith(`${folder}/`);
const parent = (file) => file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
const label = (file) => file.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '?');

async function readBounded(filename, limit) {
  const initial = await lstat(filename);
  if (!initial.isFile() || initial.isSymbolicLink()) throw Object.assign(new Error('Not a regular file'), { code: 'UNSAFE_FILE' });
  if (initial.size > limit) throw Object.assign(new Error('Read limit'), { code: 'FILE_LIMIT' });
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const entry = await handle.stat();
    if (!entry.isFile() || initial.dev !== entry.dev || initial.ino !== entry.ino) throw Object.assign(new Error('File changed'), { code: 'UNSAFE_FILE' });
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    for (;;) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      length += result.bytesRead;
      if (!result.bytesRead || length === bytes.length) break;
    }
    if (length > limit) throw Object.assign(new Error('Read limit'), { code: 'FILE_LIMIT' });
    return bytes.subarray(0, length).toString('utf8');
  } finally {
    await handle.close();
  }
}

// TOML inspection is deliberately lexical: it does not pretend to validate all TOML.
function tomlSections(text) {
  const sections = new Map();
  let current = '';
  let quote = '';
  let triple = false;
  let escaped = false;
  const brackets = [];
  sections.set(current, '');
  for (const line of text.split(/\r?\n/)) {
    if (!quote && !brackets.length) {
      const heading = /^\s*(\[\[?)([^[\]]+)(\]\]?)\s*(?:#.*)?$/.exec(line);
      if (heading) {
        if (heading[1].length !== heading[3].length) throw new Error('Unbalanced table');
        current = heading[2].replace(/["']/g, '').trim();
        if (sections.has(current) && heading[1] === '[') throw new Error('Repeated table');
        if (!sections.has(current)) sections.set(current, '');
        continue;
      }
      if (/^\s*\[/.test(line)) throw new Error('Unrecognized table header');
      if (/^\s*(?:#.*)?$/.test(line)) continue;
      if (!/^\s*(?:[A-Za-z0-9_.-]+|"[^"]+"|'[^']+')\s*=\s*\S/.test(line)) throw new Error('Unrecognized assignment');
    }
    let cleaned = '';
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quote) {
        cleaned += char;
        if (quote === '"' && escaped) { escaped = false; continue; }
        if (quote === '"' && char === '\\') { escaped = true; continue; }
        if (char === quote && (!triple || line.slice(index, index + 3) === quote.repeat(3))) {
          if (triple) { cleaned += quote.repeat(2); index += 2; }
          quote = ''; triple = false;
        }
      } else {
        if (char === '#') break;
        cleaned += char;
        if (char === '"' || char === "'") {
          quote = char;
          triple = line.slice(index, index + 3) === char.repeat(3);
          if (triple) { cleaned += char.repeat(2); index += 2; }
        } else if (char === '[' || char === '{') brackets.push(char);
        else if (char === ']' || char === '}') {
          if (brackets.pop() !== (char === ']' ? '[' : '{')) throw new Error('Unbalanced value');
        }
      }
    }
    if (quote && !triple) throw new Error('Unterminated quoted value');
    sections.set(current, sections.get(current) + '\n' + cleaned);
    escaped = false;
  }
  if (quote || brackets.length) throw new Error('Unterminated value');
  return sections;
}

function workspacePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.startsWith('!') ||
      pattern.startsWith('/') || /[:\\{}[\]]/.test(pattern) || pattern.split('/').includes('..')) return null;
  let expression = '';
  const normalized = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];
    if (char === '*' && normalized[index + 1] === '*') {
      index++;
      if (normalized[index + 1] === '/') { expression += '(?:.*/)?'; index++; }
      else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[.+^$()|]/g, '\\$&');
  }
  return new RegExp(`^${expression}$`);
}

export async function reviewDirectory(directory = '.', { limits: overrides = {}, read = readBounded } = {}) {
  const limits = { ...defaults, ...overrides };
  if (Object.values(limits).some((value) => !Number.isInteger(value) || value < 1)) throw new Error('Review limits must be positive integers.');
  const target = path.resolve(directory);
  if (!(await inspectPath(target))?.isDirectory()) throw new Error('Review requires an existing directory without symlink ancestors.');
  const files = new Set();
  const directories = new Set(['.']);
  const scope = {
    complete: true, limits, entriesVisited: 0, filesObserved: 0, bytesRead: 0,
    excludedDirectories: [...excludedDirectories].sort(compare),
    excludedSensitiveFiles: 0, skipped: [],
  };
  const gaps = [];
  const diagnostics = [];
  const skip = (relative, reason, incomplete = true) => {
    scope.skipped.push({ path: label(relative), reason });
    if (incomplete) { scope.complete = false; gaps.push(relative); }
  };
  const inspect = async (relative, depth) => {
    if (depth > limits.depth) { skip(relative, 'depth-limit'); return; }
    if (scope.entriesVisited >= limits.entries) { skip(relative, 'entry-limit'); return; }
    let entries = [];
    try {
      const absolute = path.join(target, relative);
      const entry = await inspectPath(absolute);
      if (!entry?.isDirectory()) { skip(relative, 'directory-changed'); return; }
      const handle = await opendir(absolute);
      for await (const child of handle) {
        if (entries.length >= limits.entries - scope.entriesVisited) {
          entries = [];
          scope.entriesVisited = limits.entries;
          skip(relative, 'entry-limit');
          break;
        }
        entries.push(child);
      }
    } catch (error) {
      skip(relative, `unreadable-directory:${safeCode(error)}`);
      return;
    }
    entries.sort((a, b) => compare(a.name, b.name));
    scope.entriesVisited += entries.length;
    for (const entry of entries) {
      const relativeChild = join(relative, entry.name);
      if (entry.isSymbolicLink()) { skip(relativeChild, 'symlink-not-followed'); continue; }
      if (secretName.test(entry.name)) { scope.excludedSensitiveFiles++; continue; }
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name) || /^\.hypercode-|^\.skills-discovery-/.test(entry.name)) {
          skip(relativeChild, 'dependency-build-vcs-cache-excluded', false);
          continue;
        }
        directories.add(relativeChild);
        await inspect(relativeChild, depth + 1);
      } else if (entry.isFile()) files.add(relativeChild);
      else skip(relativeChild, 'non-regular-entry');
    }
  };
  await inspect('.', 0);
  scope.filesObserved = files.size;
  const metadata = new Map();
  const contents = new Map();
  const sorted = [...files].sort(compare);
  for (const relative of sorted) {
    const basename = relative.split('/').at(-1);
    if (!manifests.has(basename) && !docName.test(basename)) continue;
    try {
      if (scope.bytesRead >= limits.totalBytes) throw Object.assign(new Error('Budget'), { code: 'TOTAL_LIMIT' });
      await inspectPath(path.join(target, relative));
      const text = await read(path.join(target, relative), Math.min(limits.fileBytes, limits.totalBytes - scope.bytesRead));
      scope.bytesRead += Buffer.byteLength(text);
      if (text.includes('\0')) throw Object.assign(new Error('Binary metadata'), { code: 'BINARY_FILE' });
      contents.set(relative, text);
      if (!manifests.has(basename)) continue;
      if (basename.endsWith('.json')) {
        let value;
        try { value = JSON.parse(text); }
        catch { throw Object.assign(new Error('Invalid JSON'), { code: 'INVALID_JSON' }); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Invalid manifest'), { code: 'INVALID_MANIFEST_SHAPE' });
        metadata.set(relative, { format: 'json', value, status: 'parsed' });
      } else if (basename.endsWith('.toml')) {
        let sections;
        try { sections = tomlSections(text); }
        catch { throw Object.assign(new Error('Invalid lexical structure'), { code: 'TOML_LEXICAL_ERROR' }); }
        metadata.set(relative, { format: 'toml', sections, status: 'lexically-inspected-not-validated' });
      } else metadata.set(relative, { format: 'yaml', text, status: 'lexically-inspected-not-validated' });
    } catch (error) {
      const code = safeCode(error);
      skip(relative, `metadata-not-evaluated:${code}`);
      diagnostics.push({ path: label(relative), code, kind: manifests.has(basename) ? 'manifest' : 'documentation' });
      if (manifests.has(basename)) metadata.set(relative, { status: 'not-evaluated', error: code });
    }
  }
  const sourceCandidates = sorted.filter((file) => sourceName.test(file) && !testPath(file));
  const sourceMetrics = [];
  scope.sourceSampling = { candidateFiles: sourceCandidates.length, sampledFiles: 0, complete: true };
  for (const [index, relative] of sourceCandidates.entries()) {
    if (index >= limits.sourceFiles) {
      skip(relative, 'source-sample-file-limit');
      scope.sourceSampling.complete = false;
      continue;
    }
    try {
      if (scope.bytesRead >= limits.totalBytes) throw Object.assign(new Error('Budget'), { code: 'TOTAL_LIMIT' });
      await inspectPath(path.join(target, relative));
      const text = await read(path.join(target, relative), Math.min(limits.fileBytes, limits.totalBytes - scope.bytesRead));
      const bytes = Buffer.byteLength(text);
      scope.bytesRead += bytes;
      if (text.includes('\0')) throw Object.assign(new Error('Binary source'), { code: 'BINARY_FILE' });
      const lines = text ? text.split(/\r\n|\r|\n/) : [];
      if (lines.at(-1) === '') lines.pop();
      sourceMetrics.push({ path: label(relative), bytes, lines: lines.length, nonEmptyLines: lines.filter((line) => line.trim()).length });
      scope.sourceSampling.sampledFiles++;
    } catch (error) {
      const code = safeCode(error);
      skip(relative, `source-not-evaluated:${code}`);
      scope.sourceSampling.complete = false;
      diagnostics.push({ path: label(relative), code, kind: 'source' });
    }
  }
  const projects = new Map();
  const getProject = (folder) => {
    if (!projects.has(folder)) projects.set(folder, { path: folder, manifests: [], stacks: new Set(), signals: [], commands: [], workspacePatterns: [] });
    return projects.get(folder);
  };
  const signal = (project, stack, file, basis) => {
    project.stacks.add(stack);
    project.signals.push({ path: label(file), basis });
  };
  for (const [relative, meta] of metadata) {
    const basename = relative.split('/').at(-1);
    let folder = parent(relative);
    if (['Cargo.toml', 'tauri.conf.json'].includes(basename) && folder.split('/').at(-1) === 'src-tauri') folder = parent(folder);
    const project = getProject(folder);
    project.manifests.push({ path: label(relative), status: meta.status });
    if (meta.status === 'not-evaluated') continue;
    if (basename === 'package.json') {
      const pkg = meta.value;
      const dependencies = new Set();
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        if (pkg[field] !== undefined && (!pkg[field] || typeof pkg[field] !== 'object' || Array.isArray(pkg[field]))) {
          diagnostics.push({ path: label(relative), code: `INVALID_${field.toUpperCase()}`, kind: 'manifest' });
          scope.complete = false;
          gaps.push(relative);
        } else {
          for (const [key, value] of Object.entries(pkg[field] ?? {})) {
            if (typeof value !== 'string') {
              diagnostics.push({ path: label(relative), code: `INVALID_${field.toUpperCase()}_VALUE`, kind: 'manifest' });
              scope.complete = false; gaps.push(relative);
            } else dependencies.add(key);
          }
        }
      }
      for (const [dependency, stack] of [
        ['react', 'react'], ['next', 'next'], ['fastify', 'fastify'], ['electron', 'electron'],
        ['@tauri-apps/api', 'tauri'], ['@tauri-apps/cli', 'tauri'],
      ]) if (dependencies.has(dependency)) signal(project, stack, relative, `declares ${dependency}`);
      if (dependencies.has('typescript') && pkg.exports !== undefined && !['react', 'next', 'fastify', 'electron', 'tauri'].some((id) => project.stacks.has(id))) {
        signal(project, 'ts-library', relative, 'declares TypeScript and a package exports boundary');
      }
      project.commands = Object.keys(pkg.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts) ? pkg.scripts : {}).filter((key) => /^[a-zA-Z0-9:_-]{1,64}$/.test(key)).sort(compare);
      if (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts) || Object.values(pkg.scripts).some((value) => typeof value !== 'string'))) {
        diagnostics.push({ path: label(relative), code: 'INVALID_SCRIPTS', kind: 'manifest' });
        scope.complete = false; gaps.push(relative);
      }
      if (pkg.workspaces !== undefined) {
        const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
        if (!Array.isArray(patterns)) {
          diagnostics.push({ path: label(relative), code: 'INVALID_WORKSPACES', kind: 'manifest' });
          scope.complete = false; gaps.push(relative);
        } else project.workspacePatterns.push(...patterns.map((pattern) => ({ pattern, path: relative, ecosystem: 'node' })));
      }
    } else if (basename === 'pyproject.toml') {
      const sections = meta.sections;
      const projectDeps = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(sections.get('project') ?? '')?.[1] ?? '';
      const deps = projectDeps + (sections.get('project.optional-dependencies') ?? '');
      if (/["']fastapi(?:[<=>~!\[ "';]|$)/im.test(deps) || /^\s*["']?fastapi["']?\s*=/im.test(sections.get('tool.poetry.dependencies') ?? '')) {
        signal(project, 'fastapi', relative, 'FastAPI dependency token in project metadata (lexical)');
      }
      if (sections.has('project') || sections.has('tool.poetry')) signal(project, 'python-package', relative, 'Python project metadata table (lexical)');
      const uv = sections.get('tool.uv.workspace') ?? '';
      const members = /\bmembers\s*=\s*\[([\s\S]*?)\]/.exec(uv);
      if (members) project.workspacePatterns.push(...[...members[1].matchAll(/["']([^"']+)["']/g)].map((match) => ({ pattern: match[1], path: relative, ecosystem: 'python' })));
    } else if (basename === 'Cargo.toml') {
      if (/^\s*tauri\s*=/m.test(meta.sections.get('dependencies') ?? '') || meta.sections.has('dependencies.tauri')) {
        signal(project, 'tauri', relative, 'Tauri dependency token in Cargo metadata (lexical)');
      }
    } else if (basename === 'tauri.conf.json') signal(project, 'tauri', relative, 'Tauri configuration file observed; native configuration not validated');
    else if (basename === 'pnpm-workspace.yaml') {
      const match = /^packages:\s*(?:#.*)?\r?\n((?:[ \t]+[^\n]*\n?|[ \t]*\n)*)/m.exec(meta.text);
      if (match) project.workspacePatterns.push(...[...match[1].matchAll(/^\s*-\s*['"]?([^'"\r\n#]+?)['"]?\s*(?:#.*)?$/gm)].map((item) => ({ pattern: item[1].trim(), path: relative, ecosystem: 'node' })));
      else { diagnostics.push({ path: label(relative), code: 'WORKSPACE_YAML_NOT_EVALUATED', kind: 'manifest' }); scope.complete = false; gaps.push(relative); }
    }
  }
  const observations = [...projects.values()].sort((a, b) => compare(a.path, b.path));
  const recommendations = [];
  const recommend = (priority, id, folder, summary, evidence, action) => {
    recommendations.push({ priority, id, project: label(folder), summary, evidence, action });
  };
  const uncertain = (folder) => gaps.some((gap) => within(gap, folder) || within(folder, gap));
  for (const diagnostic of diagnostics) {
    if (diagnostic.kind === 'source') recommend('low', 'inspect-source-scope', parent(diagnostic.path),
      'A source file could not be sampled for line metrics.', [diagnostic],
      'Inspect the skipped-file reason locally. No cohesion conclusion is possible for this file; do not restructure it based on missing metrics.');
    else recommend('high', 'inspect-metadata', parent(diagnostic.path),
      'Relevant metadata could not be fully evaluated.', [diagnostic],
      'Inspect this file locally and resolve its reported syntax, shape, read or size issue before trusting stack/command conclusions. No file content or parser error text is emitted.');
  }
  for (const metric of sourceMetrics.filter((file) => file.nonEmptyLines >= 400)) {
    const owner = observations.filter((project) => within(metric.path, label(project.path))).sort((a, b) => b.path.length - a.path.length)[0];
    recommend('low', 'inspect-large-module', owner?.path ?? '.',
      'A sampled first-party source module has at least 400 non-empty lines.',
      [{ path: metric.path, basis: `${metric.lines} physical lines, ${metric.nonEmptyLines} non-empty lines, ${metric.bytes} bytes from bounded source read` }],
      'Review responsibilities, public interfaces and existing tests before extracting cohesive modules. Generated code, declarations, comments or a single coherent implementation may justify its size. Line metrics do not prove complexity or semantic cohesion; preserve existing architecture and avoid arbitrary splits.');
  }
  for (const project of observations) {
    project.workspaces = [];
    project.workspaceMembership = [];
    for (const declaration of project.workspacePatterns) {
      const matcher = workspacePattern(declaration.pattern);
      if (!matcher) {
        skip(declaration.path, 'workspace-pattern-not-supported');
        recommend('medium', 'verify-workspace-membership', project.path, 'Workspace pattern was not evaluated.',
          [{ path: label(declaration.path), basis: 'pattern outside supported relative *, ** and ? subset' }],
          'Check declared members with your existing workspace manager. Review does not expand exclusions, braces, absolute paths or parent traversal.');
        continue;
      }
      const matched = observations.filter((candidate) => candidate.path !== project.path && within(candidate.path, project.path) &&
        candidate.manifests.some((file) => file.path.endsWith(declaration.ecosystem === 'node' ? 'package.json' : 'pyproject.toml')) &&
        matcher.test(project.path === '.' ? candidate.path : candidate.path.slice(project.path.length + 1))).map((candidate) => candidate.path);
      project.workspaces.push(...matched);
      project.workspaceMembership.push(...matched.map((folder) => ({ path: label(folder), ecosystem: declaration.ecosystem, evidence: label(declaration.path) })));
      if (!matched.length) recommend('medium', 'verify-workspace-membership', project.path,
        'No manifest-backed member matched an evaluated workspace pattern in the observed scope.',
        [{ path: label(declaration.path), basis: uncertain(project.path) ? 'scan incomplete; members may be outside scope' : 'no matching manifest within bounded scan' }],
        'Check declared member paths and scan coverage; do not delete or reorganize workspaces from this heuristic alone.');
    }
    project.workspaces = [...new Set(project.workspaces)].sort(compare);
  }
  const roots = observations.filter((project) => project.stacks.size || project.manifests.some((file) => /(?:package\.json|pyproject\.toml|Cargo\.toml)$/.test(file.path)));
  const meaningful = roots.filter((project) => !(project.workspacePatterns.length && !project.stacks.size));
  const layout = meaningful.length > 1 ? 'multi-project-observed' : meaningful.length === 1 ? 'single-project-observed' : 'unknown';
  const conventionRoots = observations.length ? observations : [getProject('.')];
  if (!conventionRoots.some((project) => project.path === '.')) conventionRoots.unshift(getProject('.'));
  for (const project of conventionRoots) {
    const ownFiles = sorted.filter((file) => within(file, project.path) && !observations.some((child) =>
      child !== project && child.path !== project.path && within(child.path, project.path) && within(file, child.path)));
    const rootDocs = ownFiles.filter((file) => parent(file) === project.path && docName.test(file.split('/').at(-1)));
    const readme = rootDocs.find((file) => /^readme(?:\.|$)/i.test(file.split('/').at(-1)));
    if (!readme) recommend('medium', 'document-entry-point', project.path, 'No root README entry point observed.',
      [{ path: label(project.path), basis: uncertain(project.path) ? 'not observed; scope incomplete' : 'no README filename in scanned project root' }],
      'If no existing entry point serves this project, add concise purpose, prerequisites, setup and verified development/test commands. Link root guidance rather than duplicating it in every package.');
    else if (contents.has(readme) && !/\b(test|pytest|vitest|unittest|check|validation)\b/i.test(contents.get(readme))) {
      recommend('medium', 'document-validation', project.path, 'README has no recognizable validation guidance.',
        [{ path: label(readme), basis: 'no validation keyword in bounded README text; linked documentation not semantically evaluated' }],
        'Check linked docs first; document how to validate changes using actual scripts/tooling. Do not add a test runner solely to satisfy this heuristic.');
    }
    const testEvidence = ownFiles.filter(testPath);
    const commands = project.commands.filter((key) => /^(?:test|check|typecheck|lint)(?::|$)/.test(key));
    const pythonTools = project.manifests.some((entry) => {
      if (!/pyproject\.toml$/.test(entry.path)) return false;
      const sections = metadata.get(entry.path)?.sections ?? new Map();
      return [...sections].some(([section, content]) =>
        /^tool\.(?:pytest|unittest)(?:\.|$)/.test(section) ||
        /^(?:dependency-groups|project\.optional-dependencies|tool\.poetry\.(?:dev-dependencies|group\..*\.dependencies))$/.test(section) && /\b(?:pytest|unittest)\b/.test(content));
    });
    if (project.manifests.length && !testEvidence.length && !commands.length && !pythonTools) recommend('medium', 'establish-validation', project.path,
      'No conventional test files or recognized validation script/tool tokens observed.',
      project.manifests.map((entry) => ({ path: entry.path, basis: uncertain(project.path) ? 'validation unknown in incomplete scope' : 'no recognized test/check signals in inspected metadata and filenames' })),
      'Inspect existing CI, custom scripts, inline/native tests and external checks before adding tests. Cover meaningful behavior with the existing ecosystem; this scan never runs or proves test quality.');
    const inherited = project.path !== '.' && sorted.some((file) => parent(file) === '.' && /^contributing(?:\.|$)/i.test(file));
    if (project.path === '.' && !rootDocs.some((file) => /^contributing(?:\.|$)/i.test(file.split('/').at(-1)))) {
      recommend('low', 'document-contribution-workflow', project.path, 'No root CONTRIBUTING document observed.',
        [{ path: '.', basis: uncertain('.') ? 'not observed; scope incomplete' : 'no conventional contribution entry filename' }],
        'If README or team docs do not already cover it, explain local validation, review expectations and commit conventions. Do not enforce a new process or commit automatically.');
    }
    const docs = ownFiles.filter((file) => /\.(?:md|rst|txt)$/i.test(file));
    const adr = docs.find((file) => /(?:^|\/)(?:adr|adrs|decisions)(?:\/|\.|$)/i.test(file) || /architecture.?decision/i.test(file));
    if (project.path === '.' && !adr) recommend('low', 'record-consequential-decisions', '.', 'No conventional ADR/decision-record path observed.',
      [{ path: '.', basis: uncertain('.') ? 'not observed; decisions may be outside scan' : 'no ADR/decisions filename in scanned paths' }],
      'Preserve existing architecture rationale wherever it lives. For consequential future choices, consider a small status/context/decision/consequences record; do not backfill speculative ADRs or create empty layers.');
    const changelog = rootDocs.find((file) => /^(?:changelog|changes|history)(?:\.|$)/i.test(file.split('/').at(-1)));
    if (project.path === '.' && !changelog) recommend('low', 'document-user-visible-changes', '.', 'No conventional root changelog observed.',
      [{ path: '.', basis: uncertain('.') ? 'not observed; scope incomplete' : 'no root changelog/changes/history filename' }],
      'If this project ships user-facing artifacts, check existing release notes first. Consider unreleased user-visible entries; choose versioning and coordinated/per-package releases only when needed. Do not generate release automation.');
    if (project.stacks.has('next') && !directories.has(join(project.path, 'src/app')) && !directories.has(join(project.path, 'app')) &&
        !directories.has(join(project.path, 'pages')) && !directories.has(join(project.path, 'src/pages'))) {
      recommend('medium', 'inspect-next-routing', project.path, 'Next dependency observed without a conventional app/pages directory.',
        project.signals.filter((entry) => entry.basis.includes('next')),
        'Inspect this package role and custom routing before changing anything. Preserve App Router or Pages Router decisions; dependency declarations alone do not prove an application.');
    }
    if (['react', 'fastify', 'fastapi', 'ts-library', 'python-package'].some((id) => project.stacks.has(id))) {
      const code = ownFiles.filter((file) => /\.(?:[cm]?[jt]sx?|py)$/.test(file) && !testEvidence.includes(file) && !/vite\.config|forge\.config/.test(file));
      project.sourceOrganization = {
        filesObserved: code.length,
        conventionalModuleDirectories: [...directories].filter((folder) => within(folder, project.path) &&
          /(?:^|\/)(?:features|modules|routes|components)$/.test(folder)).map(label).sort(compare),
      };
      if (code.length >= 12 && !project.sourceOrganization.conventionalModuleDirectories.length) recommend('low', 'inspect-module-cohesion', project.path,
        'Source exists without conventional feature/module directory names.',
        [{ path: label(project.path), basis: `${code.length} source filenames observed; contents and cohesion not evaluated` }],
        'Inspect actual domain boundaries and public APIs before restructuring. Existing packages or framework routes may already be cohesive; extract modules only for real responsibilities, not controller/service/repository ceremony.');
    }
    if (project.stacks.has('electron')) recommend('medium', 'review-electron-boundaries', project.path,
      'Electron metadata signals a privileged desktop boundary requiring manual review.',
      project.signals.filter((entry) => entry.basis.includes('electron')),
      'Inspect main/preload/renderer responsibilities, narrow contextBridge contracts, payload AND sender validation, sandbox/context isolation, navigation and production CSP. These source/runtime controls are not evaluated here. Preserve packaging choices; signing, notarization and updates remain owner decisions.');
    if (project.stacks.has('tauri')) {
      const native = join(project.path, 'src-tauri');
      project.nativeCapabilityFilesObserved = ownFiles.filter((file) => within(file, join(native, 'capabilities')) && file.endsWith('.json')).map(label);
      recommend('medium', 'review-tauri-authority', project.path, 'Tauri signals require native command/permission review.',
        [...project.signals.filter((entry) => /Tauri|tauri/.test(entry.basis)), ...project.nativeCapabilityFilesObserved.map((file) => ({ path: file, basis: 'capability filename only; permission contents not evaluated' }))],
        'Inspect Rust input validation, AppManifest::commands and least-privilege capabilities together; capability presence alone does not scope custom commands. Check actual frontend/Cargo validation commands and platform prerequisites. No compiler, runtime bridge, signing or updater is checked.');
    }
    project.documentation = { readme: readme ? label(readme) : null, readmeEvaluated: readme ? contents.has(readme) : false, contributionInherited: inherited };
    project.validation = { scriptNames: commands, testFilesObserved: testEvidence.length, pythonToolTokenObserved: pythonTools, execution: 'not-run' };
    project.sourceMetrics = sourceMetrics.filter((file) => ownFiles.some((relative) => label(relative) === file.path));
  }
  const priority = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => priority[a.priority] - priority[b.priority] || compare(a.project, b.project) || compare(a.id, b.id) || compare(JSON.stringify(a.evidence), JSON.stringify(b.evidence)));
  scope.skipped.sort((a, b) => compare(a.path, b.path) || compare(a.reason, b.reason));
  return {
    schemaVersion: 1, target, method: 'deterministic-local-heuristics', scope,
    layout: { observed: layout, confidence: scope.complete ? 'metadata-and-path-signals' : 'partial-scan', projectRoots: meaningful.map((project) => label(project.path)),
      declaredWorkspaceRoots: observations.filter((project) => project.workspacePatterns.length).map((project) => label(project.path)) },
    projects: conventionRoots.sort((a, b) => compare(a.path, b.path)).map((project) => {
      const { workspacePatterns, ...rest } = project;
      return { ...rest, path: label(project.path), stacks: [...project.stacks].sort(compare), workspaces: (project.workspaces ?? []).map(label) };
    }),
    diagnostics, recommendations,
    limitations: [
      'Read-only bounded scan; no network, model account, repository commands, dependency installation or writes.',
      'Selected manifests/entry documents and at most 40 first-party source files are read within shared byte limits. Source content is reduced to physical/non-empty line counts and byte sizes, not semantic code analysis; no raw content or script values are printed.',
      'JSON syntax/selected shapes are checked; TOML checks lexical tables/quotes/bracket balance and YAML uses conservative list signals, not full parsing/validation. Indirect dependencies, custom workspace patterns and nonstandard layouts may be unknown.',
      'Excluded dependency/build/VCS/cache and sensitive files are not evaluated. Symlinks are not followed. Missing observations in incomplete scope are not proof of absence.',
      'Presence is not quality: tests, security controls, architectural cohesion, releases and runtime/native behavior are not verified. Recommendations preserve existing decisions and are not enforced standards.',
      'Filesystem reads are not a sandbox against hostile concurrent changes.',
    ],
  };
}

function safeCode(error) {
  return /^[A-Z][A-Z0-9_]{0,60}$/.test(error?.code ?? '') ? error.code : 'READ_ERROR';
}

export function formatReview(report) {
  const lines = [
    `HyperCodeLabs codebase review: ${label(report.target)}`,
    `Method: deterministic local heuristics (not a semantic/security audit)`,
    `Layout: ${report.layout.observed} (${report.layout.confidence})`,
    `Scope: ${report.scope.filesObserved} file paths, ${report.scope.bytesRead} text bytes; ${report.scope.complete ? 'complete within configured exclusions/limits' : 'INCOMPLETE - inspect skipped paths'}`,
    `Source metrics: ${report.scope.sourceSampling.sampledFiles}/${report.scope.sourceSampling.candidateFiles} candidate files sampled (${report.scope.sourceSampling.complete ? 'all observed candidates' : 'INCOMPLETE sample'})`,
    '',
    'Observed projects:',
    ...report.projects.map((project) => `  ${project.path}: ${project.stacks.join(', ') || 'stack unknown'}; ${project.manifests.length} manifest(s); checks not run`),
    '',
    'Prioritized recommendations:',
    ...report.recommendations.flatMap((item) => [
      `  [${item.priority.toUpperCase()}] ${item.project}: ${item.summary}`,
      ...item.evidence.map((entry) => `    Evidence: ${entry.path} - ${entry.basis ?? entry.code}`),
      `    Suggestion: ${item.action}`,
    ]),
    ...(!report.recommendations.length ? ['  No applicable heuristic recommendations; this is not a clean bill of health.'] : []),
    '',
    `Sensitive files excluded: ${report.scope.excludedSensitiveFiles}`,
    'Skipped paths:',
    ...report.scope.skipped.map((item) => `  ${item.path}: ${item.reason}`),
    ...(!report.scope.skipped.length ? ['  None observed.'] : []),
    '',
    'Limitations:',
    ...report.limitations.map((item) => `  ${item}`),
  ];
  return lines.join('\n');
}
