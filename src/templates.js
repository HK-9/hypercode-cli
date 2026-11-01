export const presets = {
  react: { label: 'React + Vite', ecosystem: 'node', folder: 'apps/web' },
  next: { label: 'Next.js App Router', ecosystem: 'node', folder: 'apps/web' },
  fastify: { label: 'Fastify API', ecosystem: 'node', folder: 'apps/api' },
  'ts-library': { label: 'TypeScript library', ecosystem: 'node', folder: 'packages/core' },
  fastapi: { label: 'FastAPI service', ecosystem: 'python', folder: 'apps/api' },
  'python-package': { label: 'Installable Python package', ecosystem: 'python', folder: 'packages/core' },
  electron: { label: 'Electron + Forge + React', ecosystem: 'node', folder: 'apps/desktop' },
  tauri: { label: 'Tauri 2 + React', ecosystem: 'node', folder: 'apps/desktop' },
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export const combinations = [
  ['react', 'fastify'], ['next', 'fastify'],
  ['react', 'fastapi'], ['next', 'fastapi'],
  ['fastify', 'ts-library'], ['fastapi', 'python-package'],
];

export function selectedPresets(options) {
  if (options.presets !== undefined && options.preset !== undefined) {
    throw new Error('Use either --preset or --presets, not both.');
  }
  const ids = options.presets ?? [options.preset];
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Select at least one preset.');
  for (const id of ids) {
    if (!Object.hasOwn(presets, id)) throw new Error(`Unknown preset: ${id}. Choose ${Object.keys(presets).join(', ')}.`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate presets are not allowed.');
  if (ids.length > 1) {
    if (options.layout !== 'monorepo') throw new Error('Multiple presets require layout monorepo.');
    if (!combinations.some((pair) => pair.length === ids.length && pair.every((id) => ids.includes(id)))) {
      throw new Error(`Unsupported combination. Supported pairs: ${combinations.map((pair) => pair.join('+')).join(', ')}.`);
    }
  }
  return ids;
}

export function projectSelections(options) {
  const ids = selectedPresets(options);
  return ids.map((id) => ({
    id, ...presets[id],
    name: ids.length > 1 ? `${options.name}-${id}` : options.name,
  }));
}

function nodeTemplate(name, preset) {
  if (['electron', 'tauri'].includes(preset)) return desktopFiles(name, preset, nodeTemplate(name, 'react'));
  const frontend = preset === 'react' || preset === 'next';
  const pkg = {
    name, version: '0.1.0', private: preset !== 'ts-library', type: 'module',
    engines: { node: '>=22.12.0' },
    scripts: frontend
      ? {
          dev: preset === 'react' ? 'vite' : 'next dev',
          build: preset === 'react' ? 'tsc --noEmit && vite build' : 'next build',
          ...(preset === 'next' ? { start: 'next start' } : { preview: 'vite preview' }),
          test: 'vitest run', typecheck: 'tsc --noEmit',
        }
      : {
          build: 'tsc', test: 'tsx --test test/*.test.ts', typecheck: 'tsc --noEmit',
          ...(preset === 'fastify' ? { dev: 'tsx watch src/server.ts', start: 'node dist/server.js' } : {}),
        },
    devDependencies: {
      typescript: '^5.9.0', '@types/node': '^22.0.0',
      ...(frontend
        ? { vitest: '4.0.18', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0' }
        : { tsx: '^4.20.0' }),
    },
  };
  const compilerOptions = frontend
    ? {
        target: 'ES2022', lib: ['DOM', 'DOM.Iterable', 'ES2022'], module: 'ESNext',
        moduleResolution: 'Bundler', jsx: preset === 'next' ? 'preserve' : 'react-jsx', noEmit: true,
        ...(preset === 'next' ? { allowJs: true, incremental: true, plugins: [{ name: 'next' }] } : {}),
      }
    : { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: 'src', outDir: 'dist', declaration: true };
  const files = {
    'tsconfig.json': json({
      compilerOptions: { ...compilerOptions, strict: true, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true },
      include: frontend
        ? ['src', 'test', ...(preset === 'next' ? ['next-env.d.ts', '.next/types/**/*.ts', '.next/dev/types/**/*.ts'] : [])]
        : ['src'],
    }),
    '.env.example': preset === 'fastify' ? 'PORT=3000\nHOST=127.0.0.1\n' : '# Document non-secret configuration here. Never commit credentials.\n',
  };
  if (frontend) {
    pkg.dependencies = { react: '^19.0.0', 'react-dom': '^19.0.0' };
    files['src/features/welcome/message.ts'] = "export function welcome(name: string): string {\n  return `Welcome to ${name}`;\n}\n";
    files['test/message.test.ts'] = "import { expect, test } from 'vitest';\nimport { welcome } from '../src/features/welcome/message';\n\ntest('greets the project', () => {\n  expect(welcome('HyperCode')).toBe('Welcome to HyperCode');\n});\n";
    if (preset === 'react') {
      Object.assign(pkg.devDependencies, { vite: '^7.0.0', '@vitejs/plugin-react': '^5.0.0' });
      files['index.html'] = `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${name}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`;
      files['vite.config.ts'] = "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({ plugins: [react()] });\n";
      files['src/main.tsx'] = "import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport { App } from './App';\n\ncreateRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n";
      files['src/App.tsx'] = `import { welcome } from './features/welcome/message';\n\nexport function App() {\n  return <main><h1>{welcome('${name}')}</h1><p>Build one feature at a time.</p></main>;\n}\n`;
    } else {
      pkg.dependencies.next = '^16.0.0';
      files['next-env.d.ts'] = '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n';
      files['src/app/layout.tsx'] = `import type { ReactNode } from 'react';\n\nexport const metadata = { title: '${name}', description: 'Built with HyperCodeLabs' };\n\nexport default function RootLayout({ children }: { children: ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`;
      files['src/app/page.tsx'] = `import { welcome } from '../features/welcome/message';\n\nexport default function Home() {\n  return <main><h1>{welcome('${name}')}</h1><p>Build one feature at a time.</p></main>;\n}\n`;
    }
  } else if (preset === 'fastify') {
    pkg.dependencies = { fastify: '^5.0.0' };
    files['src/app.ts'] = "import Fastify from 'fastify';\nimport { healthRoutes } from './modules/health/routes.js';\n\nexport function buildApp() {\n  const app = Fastify({ logger: true });\n  app.register(healthRoutes);\n  return app;\n}\n";
    files['src/modules/health/routes.ts'] = "import type { FastifyInstance } from 'fastify';\n\nexport async function healthRoutes(app: FastifyInstance) {\n  app.get('/health', async () => ({ status: 'ok' }));\n}\n";
    files['src/server.ts'] = "import { buildApp } from './app.js';\n\nconst app = buildApp();\nconst port = Number(process.env.PORT ?? 3000);\nif (!Number.isInteger(port) || port < 1 || port > 65535) {\n  throw new Error('PORT must be an integer between 1 and 65535');\n}\ntry {\n  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });\n} catch (error) {\n  app.log.error(error);\n  process.exitCode = 1;\n}\nfor (const signal of ['SIGINT', 'SIGTERM'] as const) {\n  process.once(signal, async () => { await app.close(); });\n}\n";
    files['test/health.test.ts'] = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { buildApp } from '../src/app.js';\n\ntest('health endpoint', async () => {\n  const app = buildApp();\n  try {\n    const response = await app.inject({ method: 'GET', url: '/health' });\n    assert.equal(response.statusCode, 200);\n    assert.deepEqual(response.json(), { status: 'ok' });\n  } finally {\n    await app.close();\n  }\n});\n";
  } else {
    Object.assign(pkg, {
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      files: ['dist'], scripts: { ...pkg.scripts, prepack: 'npm run build' },
    });
    files['src/index.ts'] = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";
    files['test/index.test.ts'] = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from '../src/index.js';\n\ntest('greets a caller', () => {\n  assert.equal(greet('HyperCode'), 'Hello, HyperCode!');\n});\n";
  }
  files['package.json'] = json(pkg);
  return files;
}

function pythonTemplate(name, preset) {
  const module = name.replaceAll('-', '_');
  const service = preset === 'fastapi';
  const files = {
    'pyproject.toml': `[build-system]\nrequires = ["setuptools>=77"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "${name}"\nversion = "0.1.0"\ndescription = "A ${service ? 'FastAPI service' : 'Python package'} scaffolded with HyperCodeLabs"\nreadme = "README.md"\nrequires-python = ">=3.11"\ndependencies = ${service ? '["fastapi>=0.115,<1", "uvicorn[standard]>=0.34,<1"]' : '[]'}\n\n[project.optional-dependencies]\ndev = ["pytest>=8,<10", "ruff>=0.9,<1"${service ? ', "httpx>=0.28,<1"' : ''}]\n\n[tool.setuptools.packages.find]\nwhere = ["src"]\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n\n[tool.ruff]\ntarget-version = "py311"\nline-length = 88\n\n[tool.ruff.lint]\nselect = ["E", "F", "I"]\n`,
    [`src/${module}/__init__.py`]: service ? '' : 'from .greeting import greet\n\n__all__ = ["greet"]\n',
    '.env.example': '# Document non-secret configuration here. Never commit credentials.\n',
  };
  if (service) {
    files[`src/${module}/main.py`] = 'from fastapi import FastAPI\n\nfrom .modules.health import router\n\napp = FastAPI()\napp.include_router(router)\n';
    files[`src/${module}/modules/__init__.py`] = '';
    files[`src/${module}/modules/health.py`] = 'from fastapi import APIRouter\n\nrouter = APIRouter()\n\n\n@router.get("/health")\ndef health() -> dict[str, str]:\n    return {"status": "ok"}\n';
    files['tests/test_health.py'] = `from fastapi.testclient import TestClient\n\nfrom ${module}.main import app\n\n\ndef test_health() -> None:\n    with TestClient(app) as client:\n        response = client.get("/health")\n    assert response.status_code == 200\n    assert response.json() == {"status": "ok"}\n`;
  } else {
    files[`src/${module}/greeting.py`] = 'def greet(name: str) -> str:\n    return f"Hello, {name}!"\n';
    files['tests/test_greeting.py'] = `from ${module} import greet\n\n\ndef test_greet() -> None:\n    assert greet("HyperCode") == "Hello, HyperCode!"\n`;
  }
  return files;
}

function projectReadme(name, preset) {
  if (['electron', 'tauri'].includes(preset)) return desktopReadme(name, preset);
  const node = presets[preset].ecosystem === 'node';
  const module = name.replaceAll('-', '_');
  return `# ${name}

${presets[preset].label}, bootstrapped with HyperCodeLabs.

## Development

${node ? 'Requires Node.js 22.12+ and npm. Run `npm install`, then `npm test` and `npm run build`. Run `npm run typecheck` for static checking. Commit the generated `package-lock.json`; use `npm ci` in CI.' : 'Requires Python 3.11+. Create a virtual environment with `python -m venv .venv`, activate it (Windows PowerShell: `.venv\\Scripts\\Activate.ps1`; POSIX: `source .venv/bin/activate`), then run `python -m pip install -e ".[dev]"`. Run `python -m pytest`, `python -m ruff check .`, and `python -m ruff format --check .`. Select and commit a dependency locking strategy before deploying.'}

${['react', 'next', 'fastify'].includes(preset) ? 'Start development with `npm run dev`.' : preset === 'fastapi' ? `Start development with \`python -m uvicorn ${module}.main:app --reload\`.` : node ? 'Build before importing the package; public exports live in `src/index.ts`. Use `npm pack` to inspect an artifact without publishing.' : 'Public exports live in the package `__init__.py`. Run `python -m pip wheel . --no-deps` to build a wheel without publishing.'}

## Structure

${preset === 'next' ? 'Keep App Router routes and layouts in `src/app`; feature behavior belongs in `src/features`.' : preset === 'react' ? 'Keep rendering entry points in `src`; colocate behavior and components by feature in `src/features`.' : preset === 'fastify' ? 'Keep HTTP route modules in `src/modules`; `app.ts` constructs the application independently of the listening server.' : preset === 'fastapi' ? 'Use the installable `src` layout; `main.py` assembles the application and domain-focused modules own their routes.' : 'Use a small explicit public API. Split internals by cohesive capability as the package grows, not by hypothetical architecture layers.'}

Add persistence, authentication, migrations and deployment only when requirements are known. These templates do not automatically load \`.env\` files. Pass environment variables through your shell or deployment tooling; document them in \`.env.example\`. Never store credentials in source control.
`;
}

export function templateFiles(options) {
  const ids = selectedPresets(options);
  if (ids.length > 1) return composedFiles(options);
  const { name, layout } = options;
  const [preset] = ids;
  const spec = presets[preset];
  const prefix = layout === 'monorepo' ? `${spec.folder}/` : '';
  const generated = spec.ecosystem === 'node' ? nodeTemplate(name, preset) : pythonTemplate(name, preset);
  generated['README.md'] = projectReadme(name, preset);
  const files = Object.fromEntries(Object.entries(generated).map(([path, content]) => [prefix + path, content]));
  if (layout === 'monorepo') {
    files['README.md'] = `# ${name}\n\n${spec.ecosystem === 'node' ? 'npm workspace' : 'Python multi-project'} monorepo created with HyperCodeLabs.\n\nThe initial ${spec.label} lives in \`${spec.folder}\`. This bootstrap intentionally creates one workspace; add independently meaningful applications under \`apps/\` and reusable packages under \`packages/\` when needed. Do not import another project through relative filesystem paths.\n\n## Development\n\n${spec.ecosystem === 'node' ? 'Requires Node.js 22.12+. From the root, run `npm install`, `npm test`, `npm run typecheck`, and `npm run build`. Commit the root `package-lock.json` and use `npm ci` in CI.' + (preset === 'ts-library' ? ' The initial workspace is a library and has no development server.' : ' For this application use `npm run dev --workspace=' + name + '`.') : 'Each Python project owns its `pyproject.toml` and virtual environment. Change into `' + spec.folder + '` and follow its README. Install shared packages explicitly as editable dependencies during development; version them separately only when needed. This is not an npm workspace or a shared Python dependency resolver.'}\n\nSee the workspace README for framework-specific commands. See \`docs/architecture.md\` for boundaries and \`CONTRIBUTING.md\` for contribution conventions.\n`;
    if (spec.ecosystem === 'node') {
      files['package.json'] = json({
        name: `${name}-workspace`, version: '0.1.0', private: true,
        workspaces: ['apps/*', 'packages/*'], engines: { node: preset === 'electron' ? '>=22.13.0' : '>=22.12.0' },
        scripts: { build: 'npm run build --workspaces', test: 'npm run test --workspaces', typecheck: 'npm run typecheck --workspaces' },
      });
    }
  } else {
    files['README.md'] += '\nSee `docs/README.md` for documentation and `CONTRIBUTING.md` for contribution conventions.\n';
  }
  files['.gitignore'] = 'node_modules/\ndist/\n.next/\nout/\ncoverage/\n.env\n.env.*\n!.env.example\n.venv/\n__pycache__/\n*.py[cod]\n*.egg-info/\nbuild/\n.pytest_cache/\n.ruff_cache/\n*.tsbuildinfo\n*.tgz\n.DS_Store\n';
  if (['electron', 'tauri'].includes(preset)) {
    if (layout === 'monorepo' && preset === 'electron') files['README.md'] = files['README.md'].replace('22.12+', '22.13+');
    files['.gitignore'] += '.vite/\n**/src-tauri/target/\n**/src-tauri/gen/\n';
    if (layout === 'monorepo' && preset === 'electron') files['.npmrc'] = 'install-strategy=nested\n';
  }
  files['.editorconfig'] = 'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\ntrim_trailing_whitespace = true\n\n[*.py]\nindent_size = 4\n\n[*.md]\ntrim_trailing_whitespace = false\n';
  files['CHANGELOG.md'] = '# Changelog\n\nRecord user-visible changes using Keep a Changelog categories and Semantic Versioning for released artifacts. Not every commit needs an entry. Release automation is intentionally not configured. For a monorepo, decide whether releases are coordinated or each package needs its own changelog.\n\n## [Unreleased]\n\n### Added\n\n- Initial project scaffold.\n';
  files['CONTRIBUTING.md'] = '# Contributing\n\nKeep changes small and focused. Include a test for changed behavior and update affected user documentation. Run the commands in the project README before requesting review.\n\nUse Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`) as a readable convention, not an enforced gate. Explain breaking changes and migrations in the changelog. Agree on release ownership before automating versions.\n\nDocument public APIs and operational requirements. Prefer concise docstrings or JSDoc for contracts that types cannot express; avoid comments that repeat code. Record consequential architecture decisions in `docs/adr`, not routine implementation choices.\n';
  files['docs/README.md'] = '# Documentation\n\n- [Architecture](architecture.md): boundaries, ownership, and dependency direction.\n- [Operations](operations.md): configuration and operational readiness.\n- [Architecture decisions](adr/README.md): accepted decisions and their context.\n\nKeep the root README as the entry point. Add task-oriented guides as capabilities grow; keep API references next to public interfaces. Update documentation in the same change as behavior.\n';
  files['docs/architecture.md'] = `# Architecture\n\n## Current shape\n\nThis project uses ${spec.label} in a ${layout === 'single' ? 'single-project repository' : 'monorepo with one initial workspace'}.\n\nA single-project repository is simpler to install, deploy, and own independently. A monorepo makes coordinated changes and shared tooling easier, but needs explicit workspace boundaries and can couple CI and release processes. Repository layout does not require microservices or a particular deployment model.\n\n## Boundaries\n\nPreserve framework routing and packaging conventions. Group code by feature/domain once there is enough behavior to justify it. Share code only after a real second consumer exists. Keep dependencies directed toward public package APIs; avoid cross-workspace source imports. Introduce service/repository layers only when they separate actual responsibilities, not as empty folders.\n\n## Ownership and evolution\n\nAgree on owners, testing scope, and independent versus coordinated releases before adding workspaces. Keep secrets and deployment-specific configuration outside source code. Capture changes to consequential boundaries in an ADR.\n`;
  files['docs/operations.md'] = '# Operations\n\nThis is a development scaffold, not a production deployment or security baseline.\n\nBefore deploying, document configuration variables, secret provisioning, startup/shutdown, health checks, logs/metrics, backup/restore if applicable, rollback, and incident ownership. For APIs, define authentication, authorization, input validation, rate limits and CORS based on requirements. For web applications, define accessibility and browser support. Dependency locking, vulnerability scanning and CI are project-owner responsibilities.\n';
  files['docs/adr/README.md'] = '# Architecture decision records\n\nUse numbered files (`0002-short-title.md`) for consequential, hard-to-reverse decisions. Copy `template.md`; include context, alternatives and consequences. Statuses: Proposed, Accepted, Superseded. Never erase historical rationale; link a superseding decision instead. Review ADRs with the affected code.\n\n- [0001: Initial project structure](0001-project-structure.md)\n';
  files['docs/adr/template.md'] = '# NNNN: Decision title\n\n## Status\n\nProposed\n\n## Context\n\nWhat problem and constraints motivate this decision?\n\n## Decision\n\nWhat are we choosing, and why?\n\n## Alternatives\n\nWhat other reasonable approaches were considered?\n\n## Consequences\n\nWhat benefits, costs, risks and follow-up work result?\n';
  files['docs/adr/0001-project-structure.md'] = `# 0001: Initial project structure\n\n## Status\n\nAccepted (initial bootstrap choice; review with the team)\n\n## Context\n\nWe need a small, working starting point that preserves ecosystem conventions.\n\n## Decision\n\nUse ${spec.label} and a ${layout === 'single' ? 'single-project repository' : 'monorepo with one initial workspace'}. Group implementation by cohesive capability and keep public boundaries explicit.\n\n## Alternatives\n\nA single repository minimizes tooling and coordination. A monorepo supports coordinated work but requires workspace ownership and release boundaries. Neither layout inherently determines deployment topology.\n\n## Consequences\n\nThe scaffold does not prescribe persistence, authentication, CI, deployment or release automation. Add these based on real requirements and capture consequential choices in new ADRs.\n`;
  if (['electron', 'tauri'].includes(preset)) {
    const boundary = preset === 'electron'
      ? 'Privileged main process, sandboxed renderer and a narrow typed preload bridge. Validate payloads and main-frame IPC senders; deny navigation, new windows and unrequested permissions. Packaged content uses a local custom protocol and strict CSP.'
      : 'Static Vite frontend plus Rust commands. Validate inputs in Rust and grant only named commands to the main window through explicit capabilities and the app command manifest.';
    files['docs/architecture.md'] += `\n## Desktop boundary\n\n${boundary}\n\nElectron bundles Chromium/Node and has a larger distribution; Tauri uses a system WebView and Rust, trading bundle size for native build prerequisites and platform differences. Neither is inherently a complete security baseline.\n`;
    files['docs/adr/0001-project-structure.md'] += `\n## Desktop decision\n\n${boundary}\n\nSigning, notarization, auto-update trust and platform distribution remain owner decisions. Add ADRs before expanding native authority or updater policy.\n`;
    files['docs/operations.md'] += '\n## Desktop release readiness\n\nChoose owned identifiers and icons, signing/notarization identities, platform entitlements, installer/store requirements and an update trust policy. Keep credentials outside the repository. Verify installers, upgrades, rollback and native permissions on each target OS. No signing, notarization, automatic updates or store distribution is configured by this scaffold.\n';
    files['CHANGELOG.md'] += '\nDocument desktop permission changes, signing/distribution changes, update channels and data migrations before release.\n';
  }
  return files;
}

function composedFiles(options) {
  const projects = projectSelections(options);
  const first = projects[0];
  const files = templateFiles({ name: options.name, preset: first.id, layout: 'monorepo' });
  for (const filename of Object.keys(files)) {
    if (filename.startsWith(`${first.folder}/`)) delete files[filename];
  }
  delete files['package.json'];
  for (const project of projects) {
    const generated = project.ecosystem === 'node'
      ? nodeTemplate(project.name, project.id)
      : pythonTemplate(project.name, project.id);
    generated['README.md'] = projectReadme(project.name, project.id)
      + '\nRepository conventions and ADRs live in the root `docs/` directory. Node dependencies are installed at the repository root; Python dependencies are installed within this project.\n';
    for (const [filename, content] of Object.entries(generated)) {
      const relative = `${project.folder}/${filename}`;
      if (Object.hasOwn(files, relative)) throw new Error(`Template collision: ${relative}`);
      files[relative] = content;
    }
  }
  const nodeProjects = projects.filter((project) => project.ecosystem === 'node');
  if (nodeProjects.length) {
    files['package.json'] = json({
      name: `${options.name}-workspace`, version: '0.1.0', private: true,
      workspaces: nodeProjects.map((project) => project.folder), engines: { node: '>=22.12.0' },
      scripts: { build: 'npm run build --workspaces', test: 'npm run test --workspaces', typecheck: 'npm run typecheck --workspaces' },
    });
  }
  const labels = projects.map((project) => project.label).join(' + ');
  for (const filename of ['docs/architecture.md', 'docs/adr/0001-project-structure.md']) {
    files[filename] = files[filename].replaceAll(first.label, labels)
      .replaceAll('monorepo with one initial workspace', 'monorepo with explicitly selected workspaces');
  }
  const inventory = projects.map((project) => `| ${project.label} | ${project.name} | [${project.folder}](${project.folder}/README.md) |`).join('\n');
  const commands = projects.map((project) => project.ecosystem === 'node'
    ? `### ${project.label}\n\nFrom the root, run \`npm test --workspace=${project.name}\`, \`npm run typecheck --workspace=${project.name}\`, and \`npm run build --workspace=${project.name}\`. ${project.id === 'ts-library' ? 'This library has no development server.' : `Start it with \`npm run dev --workspace=${project.name}\`.`}`
    : `### ${project.label}\n\nChange into \`${project.folder}\`, create and activate its own virtual environment, and run \`python -m pip install -e ".[dev]"\`, \`python -m pytest\`, \`python -m ruff check .\`, and \`python -m ruff format --check .\`. ${project.id === 'fastapi' ? `Run \`python -m uvicorn ${project.name.replaceAll('-', '_')}.main:app --reload\` (default port 8000).` : 'Build with `python -m pip wheel . --no-deps`.'} See its README for activation commands.`).join('\n\n');
  files['README.md'] = `# ${options.name}

${labels} monorepo bootstrapped with HyperCodeLabs.

| Project | Package name | Directory |
|---|---|---|
${inventory}

## Setup and root commands

${nodeProjects.length ? 'Requires Node.js 22.12+. Run `npm install` at the root and commit the root lockfile. `npm test`, `npm run typecheck`, and `npm run build` cover **only Node workspaces**. Use `npm ci` in CI. Python directories are explicitly excluded from npm workspaces.' : 'This Python-only repository has no root npm manifest or aggregate commands. Each project is independently installable and owns its virtual environment.'}

${projects.some((project) => project.ecosystem === 'python') ? 'Requires Python 3.11+ for Python projects. Their dependencies and locking remain separate from npm. Run their commands individually; npm does not test or build Python.' : ''}

## Per-project commands

${commands}

## Boundaries

Applications and packages are independent starting points, not pre-wired integrations. A web frontend and API communicate over HTTP; configure the API URL and explicit CORS policy when integrating them. No proxy, shared schema, authentication or combined process runner is generated. React uses Vite port 5173; Next.js and Fastify default to port 3000, so when running Next.js + Fastify set Fastify's PORT to 3001 through your shell. FastAPI defaults to port 8000. Environment files are not automatically loaded.

Use public package APIs, not cross-workspace source imports. Libraries are not automatically linked to a consumer; add a dependency only when a real consumer needs it. Choose coordinated or per-project releases deliberately. See \`docs/README.md\`, \`docs/architecture.md\`, and \`CONTRIBUTING.md\` for conventions.
`;
  return files;
}
import { desktopFiles, desktopReadme } from './desktop.js';
