import { parseArgs } from 'node:util';
import path from 'node:path';
import { generate, validateOptions } from './generate.js';
import { combinations, presets, selectedPresets, projectSelections } from './templates.js';
import { agents, validateAgent, skillSelections, installSkills } from './skills.js';
import { reviewDirectory, formatReview } from './review.js';

export const help = `hypercode-init - project bootstrapper by HyperCodeLabs

Usage: hypercode-init [directory] [options]
       hypercode-init codebase review [directory] [--json]

  codebase review    Read-only local convention review (defaults to current directory)
  --json             Machine-readable review; deterministic heuristics, no commands run

  No selections? A guided terminal wizard reviews and confirms before writing.
  --name <slug>       Project/package name (defaults to directory basename)
  --preset <id>       ${Object.keys(presets).join(', ')}
  --presets <ids>     Bootstrap: supported monorepo pair; skills-only: unique known presets
                     Cannot be combined with --preset
  --layout <layout>   Bootstrap: required single or monorepo
                     Skills-only: optional, validated; does not change skill content
  --agent <choice>    none (default), copilot, claude, both; project-local skills
  --agent-skills <choice>  Alias for --agent; copilot,claude or all selects both
  --skills-only      Add skills to an existing directory; no scaffold changes
  skills add <dir>   Alias for --skills-only; explicit presets, optional layout
  --yes              Non-interactive; requires explicit --preset/--presets
                     Bootstrap also requires --layout; skills-only requires --agent
  --dry-run          Print the file manifest without writing
  --help             Show usage
  --version          Show CLI version

Single: simple ownership, installation and independent releases.
Monorepo: coordinated changes and shared tooling; more CI/release coupling.
Supported bootstrap pairs: ${combinations.map((pair) => pair.join('+')).join(', ')}.
Skills-only accepts any unique known preset set; no layout is required or inferred.
Single presets remain supported; Python dependencies stay separate from npm.
Bootstrap: choose a new destination in an existing parent directory.
Skills-only: choose an explicit existing project directory.
No dependencies are installed, Git initialized, or packages published.
Generated Node projects require Node.js 22.12+ (Electron 22.13+); Python requires 3.11+.
`;

class WizardCancelled extends Error {}

async function agentChoice(question, log) {
  log('\nOptional AI Agent Skills\n1. None - no agent files\n2. GitHub Copilot - .github/skills\n3. Claude Code - .claude/skills\n4. Both - one shared .claude/skills copy (Copilot support depends on surface/version)\nThese are discoverable guidance, not enforced policy. No global settings or tools are installed.');
  for (;;) {
    const answer = (await question('Agent skills (number/id) [none]: ')).trim();
    if (answer.toLowerCase() === ':cancel') throw new WizardCancelled();
    const agent = /^[1-4]$/.test(answer) ? agents[Number(answer) - 1] : answer || 'none';
    try { return validateAgent(agent); }
    catch (error) { log(`Please try again: ${error.message}`); }
  }
}

async function wizard(options, { question, log }) {
  log('\nHyperCodeLabs project setup\nUse numbered choices or their ids, then Enter. Type :cancel at any prompt or press Ctrl+C to exit without writing.\n');
  const ask = async (prompt) => {
    const answer = (await question(prompt)).trim();
    if (answer.toLowerCase() === ':cancel') throw new WizardCancelled();
    return answer;
  };
  const retry = async (prompt, resolve) => {
    for (;;) {
      const answer = await ask(prompt);
      try {
        return await resolve(answer);
      } catch (error) {
        log(`Please try again: ${error.message}`);
      }
    }
  };
  if (!options.name) {
    log('1. Name your project\nUse a lowercase slug such as customer-portal. Python imports use underscores.');
    options.name = await retry('Project name: ', (name) => {
      validateOptions({ name, preset: 'react', layout: 'single' });
      return name;
    });
  }
  const promptedDirectory = !options.directory;
  if (promptedDirectory) {
    log('\n2. Choose a destination\nChoose a new directory in an existing parent. Existing directories, even empty ones, are never overwritten.');
    options.directory = await retry(`Destination [${options.name}]: `, async (answer) => {
      const directory = answer || options.name;
      await generate({ name: options.name, preset: 'react', layout: 'single', directory, dryRun: true });
      return directory;
    });
  }
  if (!options.layout) {
    log('\n3. Choose repository layout\n1. Single project - simplest ownership, installation and independent releases.\n2. Monorepo - coordinated changes and shared tooling, with extra CI/release coupling and explicit project boundaries.\nA monorepo does not require microservices or a shared deployment.');
    const defaultLayout = options.presets?.length > 1 ? 'monorepo' : 'single';
    options.layout = await retry(`Layout (1/single, 2/monorepo) [${defaultLayout}]: `, (answer) => {
      const layout = { '1': 'single', '2': 'monorepo' }[answer] ?? (answer || defaultLayout);
      if (!['single', 'monorepo'].includes(layout)) throw new Error('Choose 1/single or 2/monorepo.');
      if (options.presets?.length > 1 && layout !== 'monorepo') throw new Error('Multiple presets require a monorepo.');
      return layout;
    });
  }
  if (!options.preset && !options.presets) {
    const ids = Object.keys(presets);
    log('\n4. Choose your foundation\n' + ids.map((id, index) =>
      `${index + 1}. ${presets[id].label} (${id}) - ${id === 'electron' ? 'Node.js 22.13+' : presets[id].ecosystem === 'node' ? 'Node.js 22.12+' : 'Python 3.11+'}`).join('\n'));
    if (options.layout === 'monorepo') {
      log('Supported two-project choices:\n' + combinations.map((pair, index) =>
        `${index + ids.length + 1}. ${pair.map((id) => presets[id].label).join(' + ')} (${pair.join(',')})`).join('\n'));
      log('Choose a listed pair number, comma-separated ids, or comma-separated single-preset numbers (e.g. 1,5).');
    }
    const chosen = await retry('Stack selection: ', (answer) => {
      const pair = /^\d+$/.test(answer) && Number(answer) > ids.length
        ? combinations[Number(answer) - ids.length - 1] : undefined;
      const selections = pair ?? answer.split(',').map((value) => value.trim()).map((value) =>
        /^\d+$/.test(value) ? (ids[Number(value) - 1] ?? value) : value);
      const selection = selections.length === 1 ? { preset: selections[0] } : { presets: selections };
      selectedPresets({ ...options, ...selection });
      return selection;
    });
    Object.assign(options, chosen);
  }
  try {
    validateOptions(options);
  } catch (error) {
    if (options.nameFromFlag) throw error;
    log(`Please update the project name: ${error.message}`);
    options.name = await retry('Project name: ', (name) => {
      validateOptions({ ...options, name });
      return name;
    });
  }
  if (options.agent === undefined) options.agent = await agentChoice(question, log);
  const preview = await generate({ ...options, dryRun: true });
  const projects = projectSelections(options);
  log(`\nReview your setup\nProject: ${options.name}\nDestination: ${preview.target}\nLayout: ${options.layout}\nAgent skills: ${options.agent}\n` +
    projects.map((project) => `- ${project.label}: ${project.name} in ${options.layout === 'single' ? '.' : project.folder}`).join('\n') +
    `\nGenerate ${preview.files.length} files: working source, tests, framework manifests, READMEs, architecture/operations guides, ADRs, changelog and contribution conventions.\n` +
    'No dependencies will be installed, Git initialized, or packages published. Python environments remain separate from npm. Composed projects are not automatically integrated.' +
    (options.agent === 'none' ? '' : '\nSkill outputs:\n' + preview.files.filter((file) => file.includes('/skills/')).join('\n')));
  if (!options.dryRun) {
    const confirmed = await retry('Create these files? (yes/no) [no]: ', (answer) => {
      if (['y', 'yes'].includes(answer.toLowerCase())) return true;
      if (['', 'n', 'no'].includes(answer.toLowerCase())) return false;
      throw new Error('Enter yes to create, or no to cancel.');
    });
    if (!confirmed) throw new WizardCancelled();
  } else {
    log('Dry run: preview only; no files will be written.');
  }
  return options;
}

function nextSteps(options) {
  const projects = projectSelections(options);
  const lines = [`Next steps:\n  cd ${JSON.stringify(path.resolve(options.directory))}`];
  if (projects.some((project) => project.ecosystem === 'node')) {
    lines.push('  npm install\n  npm test\n  npm run typecheck\n  npm run build');
  }
  for (const project of projects) {
    if (project.ecosystem === 'python') {
      lines.push(`  Python (${project.name}):\n  cd ${JSON.stringify(path.resolve(options.directory, options.layout === 'single' ? '.' : project.folder))}\n  python -m venv .venv`);
      lines.push('  Activate: Windows PowerShell .venv\\Scripts\\Activate.ps1; POSIX source .venv/bin/activate');
      lines.push('  python -m pip install -e ".[dev]"\n  python -m pytest\n  python -m ruff check .');
      if (project.id === 'fastapi') lines.push(`  python -m uvicorn ${project.name.replaceAll('-', '_')}.main:app --reload`);
    } else if (project.id !== 'ts-library') {
      lines.push(`  Start ${project.label}: npm run dev${options.layout === 'monorepo' ? ` --workspace=${project.name}` : ''}`);
      if (project.id === 'tauri') {
        lines.push('  Tauri native build requires Rust, platform C++/WebView dependencies; inspect prerequisites in the project README (no system tools installed by this CLI).');
        lines.push(`  From ${options.layout === 'single' ? 'the destination' : project.folder}: npm run fmt:rust; npm run check:rust; npm run lint:rust; npm run test:rust`);
      }
    }
  }
  lines.push('Read the generated README for configuration, ports, packaging and integration guidance.');
  return lines.join('\n');
}

export async function runCli(args, { interactive, question, finishPrompt, log, version }) {
  if (args[0] === 'codebase' && args[1] === 'review') {
    const { values, positionals } = parseArgs({
      args: args.slice(2), allowPositionals: true,
      options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } },
    });
    if (values.help) return log('Usage: hypercode-init codebase review [directory] [--json]\nRead-only, bounded local convention heuristics. Defaults to the current directory; never runs commands or modifies files.\nJSON diagnostics/skipped paths identify incomplete scans. This is not a semantic or security audit.');
    if (positionals.length > 1) throw new Error('Review accepts only one existing directory.');
    finishPrompt?.();
    const report = await reviewDirectory(positionals[0]);
    log(values.json ? JSON.stringify(report, null, 2) : formatReview(report));
    return report;
  }
  if (args[0] === 'skills' && args[1] === 'add') args = ['--skills-only', ...args.slice(2)];
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: {
      name: { type: 'string' }, preset: { type: 'string' }, presets: { type: 'string' }, layout: { type: 'string' },
      agent: { type: 'string' }, 'agent-skills': { type: 'string' }, 'skills-only': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }, version: { type: 'boolean', default: false },
    },
  });
  if (values.help) return log(help);
  if (values.version) return log(version);
  if (positionals.length > 1) throw new Error('Provide only one destination directory.');
  const directory = positionals[0];
  const name = values.name ?? (directory ? path.basename(path.resolve(directory)) : undefined);
  const preset = values.preset;
  const selections = values.presets?.split(',').map((id) => id.trim());
  if (preset !== undefined && selections !== undefined) throw new Error('Use either --preset or --presets, not both.');
  const layout = values.layout;
  if (values.agent !== undefined && values['agent-skills'] !== undefined) throw new Error('Use either --agent or --agent-skills, not both.');
  const agentFlag = values.agent ?? values['agent-skills'];
  const agentSelection = agentFlag === undefined ? undefined : validateAgent(agentFlag);
  if (values['skills-only']) {
    if (!directory) throw new Error('Skills-only requires an explicit existing project directory.');
    if (values.name !== undefined) throw new Error('--name does not apply to skills-only installation.');
    skillSelections({ preset, presets: selections, layout });
    let agent = agentSelection;
    const guided = interactive && !values.yes;
    try {
      if (agent === undefined) {
        if (!guided) throw new Error('Skills-only requires --agent copilot, claude, or both.');
        agent = await agentChoice(question, log);
      }
      if (agent === 'none' && guided) throw new WizardCancelled();
      const options = { directory, preset, presets: selections, layout, agent, dryRun: true };
      const preview = await installSkills(options);
      if (guided && !values['dry-run']) {
        log(`\nReview skill installation\nDestination: ${preview.target}\nAgent: ${agent}\nCreate:\n${preview.create.join('\n') || '(none)'}\nUnchanged:\n${preview.unchanged.join('\n') || '(none)'}\nOnly project-local skill files are touched; application files and existing instructions are preserved.`);
        for (;;) {
          const answer = (await question('Install these skills? (yes/no) [no]: ')).trim().toLowerCase();
          if (['', 'n', 'no', ':cancel'].includes(answer)) throw new WizardCancelled();
          if (['yes', 'y'].includes(answer)) break;
          log('Please enter yes or no.');
        }
      }
      const result = await installSkills({ ...options, dryRun: values['dry-run'] });
      log(result.dryRun ? JSON.stringify(result, null, 2) : `Project skills installed at ${result.target}: ${result.create.length} new files, ${result.unchanged.length} unchanged.\nSkill discovery depends on agent surface/version. No agent was run; no application or global settings were modified.`);
      return result;
    } catch (error) {
      if (!(error instanceof WizardCancelled)) throw error;
      log('Cancelled. No files were written.');
      return { cancelled: true };
    } finally {
      finishPrompt?.();
    }
  }
  const missing = !name || (!preset && !selections) || !layout;
  if (missing && (values.yes || !interactive)) {
    throw new Error('Non-interactive usage requires a directory or --name, --preset or --presets, and --layout. See --help.');
  }
  let options = { name, nameFromFlag: name !== undefined, preset, presets: selections, layout, directory, agent: agentSelection, dryRun: values['dry-run'] };
  if (missing) {
    try {
      options = await wizard(options, { question, log });
    } catch (error) {
      if (!(error instanceof WizardCancelled)) throw error;
      log('Cancelled. No files were written.');
      return { cancelled: true };
    } finally {
      finishPrompt?.();
    }
  } else {
    finishPrompt?.();
  }
  options.directory ??= options.name;
  const ids = selectedPresets(options);
  const result = await generate(options);
  log(result.dryRun
    ? JSON.stringify(result, null, 2)
    : `Created ${ids.map((id) => presets[id].label).join(' + ')} (${options.layout}) at ${result.target}\nDependencies have not been installed.\n\n${nextSteps(options)}`);
  return result;
}
