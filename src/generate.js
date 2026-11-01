import { lstat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { projectSelections, templateFiles } from './templates.js';
import { skillFiles, validateAgent } from './skills.js';

const pythonKeywords = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
const reservedPath = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export function validateOptions(options) {
  validateAgent(options.agent);
  const { name, layout } = options;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || reservedPath.test(name)) {
    throw new Error('Name must be a lowercase slug starting with a letter, up to 64 characters, and not a reserved device name.');
  }
  if (!['single', 'monorepo'].includes(layout)) throw new Error('Layout must be single or monorepo.');
  for (const project of projectSelections(options)) {
    if (project.name.length > 64) {
      throw new Error(`Generated package name ${project.name} exceeds 64 characters; use a shorter repository name.`);
    }
    if (project.ecosystem === 'python' && pythonKeywords.has(project.name.replaceAll('-', '_'))) {
      throw new Error('Name must not be a Python keyword.');
    }
  }
}

async function statOrMissing(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function generate(options) {
  validateOptions(options);
  if (options.directory !== undefined && (typeof options.directory !== 'string' || !options.directory.trim())) {
    throw new Error('Destination must be a non-empty path.');
  }
  const target = path.resolve(options.directory ?? options.name);
  const parent = path.dirname(target);
  if (target === parent) throw new Error('Cannot scaffold a filesystem root.');
  if (reservedPath.test(path.basename(target)) || /[. ]$/.test(path.basename(target))) {
    throw new Error('Destination has a non-portable directory name.');
  }
  for (let current = parent; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink ancestor: ${current}`);
    if (!stat.isDirectory()) throw new Error(`Parent is not a directory: ${current}`);
    if (path.dirname(current) === current) break;
  }
  if (await statOrMissing(target)) {
    throw new Error('Destination already exists. Choose a new directory; existing files are never overwritten.');
  }
  const files = { ...templateFiles(options), ...skillFiles(options) };
  const manifest = Object.keys(files).sort();
  if (options.dryRun) return { target, files: manifest, dryRun: true };
  // Exclusive creation refuses destinations created after the preflight check.
  await mkdir(target);
  try {
    for (const relative of manifest) {
      const filename = path.join(target, ...relative.split('/'));
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, files[relative], { flag: 'wx' });
    }
  } catch (error) {
    throw new Error(`Generation failed at ${target}; a partial scaffold may remain. Inspect it before removing it. ${error.message}`, { cause: error });
  }
  return { target, files: manifest, dryRun: false };
}
