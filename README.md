# hypercode-init

An interactive, opinionated project bootstrapper by **HyperCodeLabs**. Start a TypeScript/Node.js or Python project with working framework conventions, modular source code, tests, and useful documentation rather than empty architecture layers.

## Usage

Requires Node.js **22.12+** to run the CLI. Generated Python projects require Python **3.11+**.

```sh
# From npm:
npx hypercode-init
npx hypercode-init my-project

# Explicit, repeatable selection (also suitable for non-interactive shells):
npx hypercode-init my-api --preset fastapi --layout single --yes
npx hypercode-init my-platform --preset next --layout monorepo --yes
npx hypercode-init fullstack --presets react,fastapi --layout monorepo --yes
npx hypercode-init my-desktop --preset electron --layout single --yes
npx hypercode-init native-desktop --preset tauri --layout monorepo --yes

# Preview the file manifest without writing:
npx hypercode-init my-lib --preset ts-library --layout single --yes --dry-run
```

For local development, use `node bin/hypercode-init.js`, or run `npm pack` and install the resulting local tarball with `npm install -g <tarball>`. When `hypercode-init` is available from the public npm registry, the commands above work through `npx` or the installed package. The package installs the `hypercode-init` command and has no runtime dependencies; check the registry for current availability.

### Guided terminal setup

From this repository, run **`node bin/hypercode-init.js` in a terminal** to launch the wizard. When available on npm, use `npx hypercode-init` or the installed `hypercode-init` command. Both stdin and stdout must be terminals; piping the command intentionally uses non-interactive behavior.

The wizard guides naming, a new destination directory, single-project versus monorepo trade-offs, and stack selection. Type a numbered choice or its id and press Enter; standard readline editing works without color, mouse input or arrow-key menus. For monorepos, select a listed pair number or comma-separated ids/numbers (`react,fastapi` or `1,5`). Invalid prompted entries are explained and re-prompted.

Before writing, a review shows the resolved absolute destination, package names, framework choices, project paths, file count and included conventions. **Only `yes`/`y` confirms creation**; Enter defaults to no. Type `:cancel` at any prompt, answer no at confirmation, or press Ctrl+C to cancel without writing. A guided `--dry-run` shows the review and manifest without confirmation or writes.

Supplied flags prefill/skip their wizard steps; invalid supplied values are errors rather than silently changed. A supplied destination defaults the name to its basename; `--name` overrides it. The layout prompt defaults to single unless a pair was supplied with `--presets`. Fully specified commands retain non-interactive behavior even in a terminal, and `--yes` never opens the wizard. After generation, the CLI prints installation, checks, development commands and the README entry point, but runs none of them.

Names are lowercase slugs (letters, numbers and single hyphens), begin with a letter, and are at most 64 characters. Python names are converted to underscore-separated import modules; keywords and reserved device names are rejected.

The destination must **not exist**, even if empty, and its parent must exist. Spaces in parent paths are supported; quote paths in your shell. The CLI refuses existing destinations and symlink ancestors, uses exclusive file creation, and never installs dependencies, initializes Git, publishes, or runs generated code. A write failure is reported with its destination; inspect any partial scaffold before manually removing it. This is not a filesystem sandbox against malicious concurrent modifications.

Run `hypercode-init --help` for options. Missing selections in a non-interactive shell produce an error instead of hanging. For bootstrap, `--yes` requires explicit `--preset` or `--presets` and `--layout`; it does not silently choose a stack. For skills-only, `--yes` requires an existing directory, explicit presets and an agent, but no layout. The two selection flags cannot be used together.

## Review an existing codebase

Review project conventions locally, without an AI account, network access, repository-command execution or writes:

```powershell
node bin\hypercode-init.js codebase review
node bin\hypercode-init.js codebase review "C:\work\my-project"
node bin\hypercode-init.js codebase review "C:\work\my-project" --json
```

Use `hypercode-init codebase review [directory] [--json]` with the installed package. The directory defaults to the current directory; an existing directory is required. This two-word command avoids reserving existing bootstrap destination names: `hypercode-init review` still starts its destination wizard, and `hypercode-init review --preset react --layout single --yes` still bootstraps a project named `review`. Codebase review never opens the setup wizard and does not install dependencies, generate skills, initialize Git, commit or publish. Bootstrap and skills flags are intentionally not accepted by `codebase review`.

Terminal output gives **observed** project roots/stacks, single/multi-project layout signals, prioritized suggestions, relative-path evidence, skipped paths and limitations. JSON provides `schemaVersion`, `method`, `scope`, `layout`, `projects`, `diagnostics`, `recommendations` and `limitations`; each recommendation includes priority, project, summary, evidence and action. Output is deterministic for an unchanged accessible tree (no timestamps, random scores or source excerpts). A completed report exits zero even when diagnostics or incomplete coverage are present: automation must inspect `scope.complete`, `diagnostics` and recommendations. Invalid inputs, missing/non-directory roots and symlink ancestors fail nonzero.

These are **deterministic heuristics, not an exhaustive semantic/security audit or enforced industry standards**. Supported signals include package dependencies for React/Next/Fastify/Electron/Tauri, TypeScript exports, Python project/FastAPI dependency metadata and Tauri Cargo/configuration. Nested npm/pnpm/uv workspace declarations are matched against observed manifests; Node and Python memberships stay distinct. Native `src-tauri` belongs to its frontend project rather than being invented as a second application. A single observed project with declared workspace metadata is reported honestly, not automatically relabeled as a necessary monorepo. Unknown technologies receive only applicable general guidance.

Suggestions cover README setup/validation guidance, existing testing signals, contribution guidance, consequential decision records, user-visible changes, filename-based module organization and **bounded source-level line metrics**. First-party source text is reduced to byte, physical-line and non-empty-line counts; a module with at least 400 non-empty lines prompts a conditional cohesion review, not an arbitrary split. Comments/generated declarations count as lines too, so size is not complexity or semantic understanding. Suggestions preserve existing routes, package boundaries, team documentation and release decisions. No recommendation installs a framework, mandates a monorepo, introduces speculative architecture layers or configures releases. Electron/Tauri observations prompt a **manual** native-boundary review; source security, capabilities, IPC validation, signing, update trust and runtime bridges are not assessed or certified.

**Scan bounds and exclusions:** traversal uses depth 8 (root is depth 0), a 5,000-entry budget (one look-ahead entry may establish overflow), 128 KiB per selected text file and a 1 MiB total text budget. Metadata/entry documents are read first, then at most 40 first-party source files in deterministic relative-path order. Source sampling covers JS/TS, Python, Rust, Go, Java, Ruby, C#, C/C++ extensions; conventional test filenames are counted as test evidence but not read for module-size suggestions. Oversized directories are skipped as a whole rather than choosing filesystem-order-dependent members. Symlinks are never followed, including in root ancestors; dependencies, VCS, build artifacts, virtual environments and common caches are excluded (`scope.excludedDirectories` lists names). Environment/credential/private-key files, `.npmrc` and `.pypirc` are excluded. `scope.sourceSampling` reports observed candidates, actual samples and completeness; unsampled/unreadable/oversized source paths are listed explicitly. No raw source, document content, dependency values, secret values or script command bodies are printed.

JSON syntax and selected manifest shapes are checked. TOML table/quote/bracket balance and dependency tokens, and YAML workspace lists, are inspected **lexically**, not fully parsed or validated. Relative workspace `*`, `**` and `?` patterns are supported; exclusions, braces, parent traversal and absolute patterns are reported as unevaluated. Indirect/configured dependencies, alternative metadata/paths, full TOML/YAML semantics, linked documentation content, test quality and code cohesion can remain unknown. Important unreadable/malformed/oversized metadata is surfaced with sanitized diagnostic codes; incomplete scans qualify missing observations instead of asserting absence. Excluded content is not evaluated, and filesystem reads are not a sandbox against hostile concurrent modification.

## AI agent skills

Skills are **opt-in, project-local** guidance for GitHub Copilot and Claude Code. The wizard adds a numbered agent step (default **none**) and includes skill paths in the no-write review; cancellation, default-no confirmation and dry-run still write nothing. Complete bootstrap flags remain non-interactive and generate no skills unless explicitly requested.

```powershell
# New scaffold: use one agent, or all / both / copilot,claude for both agents
node bin\hypercode-init.js sample --preset react --layout single --agent-skills all --yes

# Existing project: install only skill files; select stacks explicitly
node bin\hypercode-init.js skills add . --agent copilot --presets electron,tauri --dry-run
node bin\hypercode-init.js skills add . --agent copilot --presets electron,tauri --yes
```

The installed command is `hypercode-init`; `--agent` and `--agent-skills` are aliases. Choices are `none`, `copilot`, `claude`, `all` (`both`, `copilot,claude` and `claude,copilot` also select both). `--skills-only <directory>` is equivalent to `skills add <directory>`. Existing projects require an explicit existing directory and `--preset` or `--presets`; **no stack is guessed**. Skills-only accepts and validates optional `--layout single|monorepo`, but it does not affect generated skill content; skills always guide the agent to inspect the actual layout. Skills-only accepts any unique selection of known presets, including three stacks or Electron + Tauri; these are technology references, not scaffold composition or generated app integrations. Bootstrap's bounded pairs remain unchanged.

Copilot alone writes `.github/skills/<name>/SKILL.md`. Claude alone and **both agents** write a single canonical `.claude/skills/<name>/SKILL.md` copy. GitHub officially documents `.claude/skills` as a project discovery location too; generating a second `.github` copy would risk duplicate skills. Switching canonical locations when HyperCode skills already exist in `.github`, `.claude` or `.agents` fails explicitly: reconcile those copies manually. Agent surface/version, trust and organization settings affect discovery; files do not enforce policy or guarantee automatic activation. Start agents at the project root; Claude also documents parent-directory discovery within a repository. No authentication or agent execution is needed to generate/install skills.

Each skill uses standard YAML `name`/`description` frontmatter and skill-local `references/conventions.md`. Two general skills (`hypercode-modular-development`, `hypercode-project-documentation`) cover real repository inspection, module/workspace boundaries, validation, docs, ADRs, changelogs and Conventional Commits; each selected preset adds a focused `hypercode-<preset>` workflow. Electron guidance preserves privileged process and validated IPC boundaries; Tauri guidance considers Rust validation, `AppManifest::commands` and capabilities together. Guidance defers to actual manifests, README, instructions and existing architecture; it never assumes npm covers Python/Rust or invents commands, releases or signing setup.

Skills-only never regenerates application scaffolds, documentation, manifests, lockfiles or instruction files. It refuses home/filesystem roots and symlink ancestors/resource paths; only new skill files are created exclusively. All ordinary collisions are resolved before writing: byte-identical files are reported unchanged, user edits or extra skill resources fail without overwriting. Dry-run reports intended, new and unchanged paths. Late failures roll back this invocation's new files and empty directories, preserving pre-existing/external content; a rollback conflict/failure is surfaced explicitly. As with scaffolding, this is not a sandbox against hostile concurrent filesystem changes. Nothing changes global/home settings, installs hooks/tools, launches agents, commits or publishes.

Official format/discovery references: [GitHub adding agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), [GitHub Agent Skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills), [Claude Code skills](https://code.claude.com/docs/en/skills), and the [open Agent Skills specification](https://agentskills.io/specification). Names match their parent folders, contain no consecutive hyphens, and are namespaced to avoid bundled command collisions.

Generated content stays stable when adding further stacks, whether layout is omitted or differs: installing React, then Tauri adds only the new Tauri skill; already installed stack skills are preserved. Layout is always discovered from the real project, not frozen into skill files. Customized unrelated skills do not block additions; edits to candidate generated files require manual reconciliation rather than an overwrite flag.

**Skills verification scope:** all preset/layout/agent manifests, compositions, incremental installs, frontmatter/resource paths, user conflicts, symlinks, Windows home-case exclusion, late-write rollback, and wizard cancellation/confirmation have regression coverage. The real packed command generates and installs skills, and Windows pseudoterminal checks exercise the agent step. Credential-free `copilot skill list --json` discovered the generated `.github` and shared `.claude` copies in isolated projects. Claude Code's installed help was inspected, but no credential-free standalone skill inventory was available; actual Claude discovery/invocation and relevance-based loading, Copilot IDE/cloud/app discovery, and policy enforcement were **not verified**. No model session or credentials were used.

## Presets

| ID | Foundation | Conventions | Monorepo location |
|---|---|---|---|
| `react` | React 19, Vite 7, TypeScript | `src/features`, React entry point, Vitest | `apps/web` |
| `next` | Next.js 16 App Router, React 19 | `src/app` routes/layouts, `src/features`, Vitest | `apps/web` |
| `fastify` | Fastify 5, TypeScript | Domain-focused route modules; app construction separate from server; Node tests | `apps/api` |
| `ts-library` | TypeScript ESM library | Explicit package exports, declarations, Node tests | `packages/core` |
| `fastapi` | FastAPI, Uvicorn | Installable Python `src` layout, route modules, pytest, Ruff | `apps/api` |
| `python-package` | setuptools Python package | `pyproject.toml`, public package API, pytest, Ruff | `packages/core` |
| `electron` | Electron 45, Forge 8, Vite, React, TypeScript | `src/main`, `src/preload`, `src/renderer`; typed bridge; Forge package/ZIP | `apps/desktop` |
| `tauri` | Tauri 2, Vite, React, TypeScript, Rust | `src/native` typed wrappers, `src-tauri` commands/Cargo/capabilities | `apps/desktop` |

**Single repository** is the simplest choice for one application or independently owned package. **Monorepo** supports coordinated changes and shared tooling, but adds CI, ownership, and release coordination. Neither layout implies microservices.

For bootstrap, `--preset` preserves the original **one-workspace** monorepo interface, paths and package names. Bootstrap `--presets` supports these bounded **two-project pairs**, in either order; skills-only is not restricted to these pairs:

| Selection | Generated directories |
|---|---|
| `react,fastify` or `next,fastify` | `apps/web`, `apps/api` |
| `react,fastapi` or `next,fastapi` | `apps/web`, `apps/api` |
| `fastify,ts-library` | `apps/api`, `packages/core` |
| `fastapi,python-package` | `apps/api`, `packages/core` |

Composed package names use `<repo-name>-<preset>` (for example `fullstack-react` and `fullstack-fastapi`); Python import modules use underscores. Generated package names must still fit 64 characters, so a composed repository name must leave room for its longest preset suffix. Duplicate presets, two competing frontends/APIs, unsupported pairs, three or more presets, and multiple selections in a single-project layout fail before writing. Node manifests list **only the selected Node paths** as npm workspaces. Python-only repositories have no root npm manifest.

For React + FastAPI, run `npm install` at the root and `npm run dev --workspace=fullstack-react`. Separately change into `apps/api`, create/activate a virtual environment, run `python -m pip install -e ".[dev]"`, then `python -m uvicorn fullstack_fastapi.main:app --reload`. Root npm build/test/typecheck commands cover **Node only**; run Python pytest/Ruff/build commands inside each Python project. Every generated README has the exact package names and commands.

Node presets use npm workspaces; Python projects remain independently installable with their own environments and locking strategy, not an invented npm/Python hybrid resolver. Composed apps are **not pre-wired**: configure HTTP API URLs, CORS and any shared schemas based on requirements. There is no combined process runner or automatic library dependency. Next.js and Fastify both default to port 3000; select a different Fastify `PORT` (for example 3001) when running them together. FastAPI defaults to 8000; Vite to 5173.

Add real applications under `apps/` and reused libraries under `packages/` only when needed. Arbitrary composition, custom path/name mappings, Turborepo, Nx, pnpm and uv workspace automation remain outside v0.1.

## Desktop conventions

Electron and Tauri support both single-project and one-workspace monorepos, in the wizard or `--preset`. Desktop pairs are intentionally **not enabled**: sharing a TypeScript library requires an actual dependency/bundling policy, and neither scaffold creates one. Existing web/API pairs are unchanged. No Next.js server is embedded in either desktop preset.

Electron requires **Node.js 22.13+** (Forge 8's minimum), rather than the other Node presets' 22.12+. Electron bundles Chromium/Node: keep its runtime current and audit dependencies. The privileged main process owns native access, the sandboxed renderer owns React UI, and a narrow typed preload bridge exposes only a greeting. The sample validates payloads and main-frame senders, explicitly enables `contextIsolation`/`sandbox`, disables `nodeIntegration`, denies new windows/navigation/webviews/permissions, and serves packaged assets via a constrained custom `app:` protocol. No raw IPC, shell or external-URL opener is exposed.

Forge is the official packaging orchestration choice, but its **Vite plugin is experimental**; Forge 8.0.1 is pinned and uses `.cjs` main/preload artifacts. `npm run build` generates a host-platform executable; `npm run make` creates an **unsigned ZIP**, not a signed installer. Bundled JS dependencies are development dependencies; any future native runtime dependency must be externalized and present on disk. Electron monorepos generate `.npmrc` with `install-strategy=nested`, verified with npm on Windows. pnpm, Yarn Plug-and-Play and alternate hoisting/native dependency policies are not verified.

Tauri uses a static Vite frontend with Rust code in the conventional `src-tauri` Cargo project. Typed invoke wrappers are explicit frontend contracts, **not automatic runtime validation**. Rust commands validate their inputs and return errors. `AppManifest::commands` registers the custom command in the permission system, and the main-window capability grants only `allow-greet`; this avoids assuming capabilities alone restrict otherwise globally registered app commands. No filesystem, shell or remote-origin permissions are granted. Capabilities do not secure unsafe Rust implementations.

Tauri native builds require Rust/Cargo, and platform dependencies from the official prerequisites guide: Windows MSVC C++ Build Tools and WebView2, macOS Xcode tools, or Linux WebKitGTK/system libraries. Rustfmt and Clippy must also be available for the generated `fmt:rust`/`lint:rust` commands. Check `rustc --version`, `cargo --version`, `rustup component list --installed`, and `npm exec tauri info`. **No system prerequisite is auto-installed.** `npm run build:web` checks/builds the frontend; `check:rust`, `test:rust`, `fmt:rust`, and `lint:rust` check native code. `npm run build` runs Tauri's native build without bundling an installer. Commit the app's Cargo lockfile after resolution.

Both presets import real CSS. Production CSP keeps script/style sources restricted to self; development alone allows inline scripts/styles for React refresh and Vite CSS injection and narrowly scoped localhost WebSockets. The native bridge, CSP, permission boundary and any future update trust policy should evolve together and be recorded in ADRs.

Generated desktop READMEs, architecture/operations notes, ADR and changelog guidance cover owned identifiers/icons, signing, macOS notarization, installer/store requirements, auto-update trust, rollback and release channels. These are **owner setup**, not implemented automation. No signing secrets, notarization, updater, store upload or publishing configuration is generated. The Tauri icon is a generated placeholder, not product artwork. Verify each target OS independently; Windows packaging is not proof of macOS/Linux support.

## Generated conventions

Every scaffold includes a project README with actual installation, test and build commands, `.editorconfig`, `.gitignore`, `.env.example`, `CONTRIBUTING.md`, `CHANGELOG.md`, and a `docs/` entry point with architecture and operations guides. Monorepos also include a workspace README.

Modularization follows cohesive features/domains while preserving each framework's routing and packaging. There are no speculative controller/service/repository folders. Shared packages should expose public APIs; avoid cross-workspace source imports.

ADRs live in `docs/adr/`, with an initial structure decision and a copyable template covering status, context, decision, alternatives and consequences. Use sequential filenames; supersede historical records rather than rewriting rationale. Changelogs use Keep a Changelog categories and recommend Semantic Versioning for releases. Conventional Commits are documented, not enforced. Monorepo owners must choose coordinated or per-package releases before enabling automation.

These are **development foundations**, not production-ready security/deployment stacks. They do not include authentication, databases, CI, release automation, licenses for your generated project, or secret management. Generated dependency ranges are not locks: commit npm's resulting lockfile and use `npm ci`; Python teams must select a locking strategy. `.env` files are not loaded automatically. The operations guide identifies readiness work without claiming it is implemented.

## Development and verification

No dependency installation is required for the CLI itself:

```sh
npm test
npm run check
npm pack --dry-run
npm run test:package
```

Unit tests cover all sixteen preset/layout manifests, all six composed pairs, desktop security configuration/command boundaries, safe destinations, names, invalid selections, CLI errors, non-interactive execution and interactive selection logic. The package check creates a real tarball, installs it locally in a temporary directory, exercises original and mixed-stack flags, and cleans up. To install, test, typecheck/lint, and build/package the presets and representative Node-only (`fastify,ts-library`), Python-only (`fastapi,python-package`), and mixed (`react,fastapi`) compositions, run:

```sh
npm run test:templates
# Desktop-only checks (requires native prerequisites, Rustfmt and Clippy):
npm run test:templates -- --desktop
```

This slower check requires Python 3.11+, internet access to npm/PyPI, and Node.js 22.12+. It creates temporary projects under the current repository, builds Node projects, checks Python formatting and builds/installs wheels, then removes its own temporary directory. It does not publish anything. All six pairs have manifest tests; three representative pairs have combined installation/build checks. These checks do not verify frontend-to-API communication because integrations are not generated.

The wizard has unit coverage for re-prompting, review-before-write, confirmation, cancellation, destination races, dry runs and flag compatibility. On Windows, an optional real pseudoterminal check exercises the source or installed binary (requires the isolated `pywinpty` tooling in `scripts/requirements-terminal.txt`):

```powershell
python -m venv .terminal-check
.\.terminal-check\Scripts\python.exe -m pip install -r scripts\requirements-terminal.txt
.\.terminal-check\Scripts\python.exe scripts\verify-terminal.py
$env:HYPERCODE_TERMINAL_PYTHON = (Resolve-Path .terminal-check\Scripts\python.exe).Path
npm run test:package
```

The terminal check verifies mixed-project creation, invalid input, default-no confirmation, Ctrl+C and dry-run behavior through a real Windows terminal. Its temporary generated projects are removed after the check. Delete only the local `.terminal-check` tooling directory when finished; it is not required to use the CLI.

`scripts/verify-desktop-window.js <port> <electron|tauri>` checks an already-running desktop app through a **local test-only** Chromium debugging port: rendering, actual imported CSS, native greeting, invalid-payload rejection and absence of CSP/runtime errors. For Electron, launch with `--remote-debugging-port=<port>`; for Windows WebView2 use `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>`. Do not enable debugging ports in distributed apps. Stop the test app after the check.

**Desktop verification scope:** Windows npm installation, TypeScript tests/checks, Electron Forge executable/unsigned ZIP packaging (single and monorepo), and Tauri Cargo check/unit tests/release executable builds (single and monorepo) were exercised. Development and packaged windows for both frameworks rendered the CSS import, invoked the native greeting, rejected invalid payloads and had no runtime/CSP errors. Rustfmt and Clippy were **not verified** because those components were absent on the host; no system components were installed. The full verification command intentionally fails if they are missing. An explicitly limited run can use `npm run test:templates -- --desktop --skip-rust-tools`, which reports those skipped checks rather than claiming they passed.

The Tauri development runtime check used a test-only alternate port because another project occupied 1420. If changing the port, update the Vite port, Tauri `build.devUrl` and development CSP HTTP/WebSocket origins together. macOS/Linux artifacts, signing, notarization, installers, stores and auto-update workflows have not been verified.

The published tarball contains only the binary, source/templates, README, package metadata and license. Framework majors are deliberately bounded; Vitest is pinned to 4.0.18 to avoid an npm 10 optional-peer resolution failure with newer 4.x releases. Review and verify template dependency updates before changing advertised support.

## Releases and approvals

The repository release process is separate from project scaffolds generated by the CLI. A source pull request that changes published behavior or package contents must include a Changeset, or an explicit empty Changeset with a reason when no npm release is intended:

```sh
npm run changeset
npx changeset --empty
```

Choose **patch**, **minor**, or **major** based on compatibility. For this pre-1.0 package, Changesets maps `0.1.0` to `0.1.1`, `0.2.0`, or `1.0.0`, respectively. The PR template records that intent. Main requires one HK-9 code-owner approval before merge; GitHub does not allow an author to approve their own PR, so another authorized reviewer must approve an HK-9-authored PR. `.github/CODEOWNERS` names `@HK-9` and takes effect only after that file is merged to `main`.

After source PRs merge, the Changesets bot opens or updates **Version Packages**, combining versions and changelog entries and linking the contributing source PRs. Review and approve that release PR separately. Its merge triggers the release workflow on that exact commit; the workflow tests and packs that commit, checks the public npm version and integrity, then waits for approval in the protected **npm-release** environment. Only after that second approval does it publish via npm Trusted Publishing/OIDC and record a GitHub tag/release with the source links. `0.1.0` is an immutable already-published baseline and is never republished.

For initial setup, enable GitHub Actions to create pull requests and require the stable `hypercode-ci` check plus HK-9 code-owner approval on `main`. Configure the `npm-release` environment with HK-9 as a required reviewer and deployments restricted to `main`. After `npm-release.yml` is present on `main`, configure npm Trusted Publishing for `HK-9/hypercode-cli`, workflow `npm-release.yml`, and environment `npm-release`; do not use a long-lived npm token. Trusted Publisher setup is intentionally a manual, just-in-time step because npm's initial trust registration can expire if no successful publish follows promptly. Also disable administrator bypass for the environment's protection rules if strict approval is required; that control must be verified in GitHub settings.

If a run needs retrying, use **Actions → npm release → Run workflow** and provide the original 40-character `release_sha` from the version-bump PR merge run. The workflow never substitutes the current `main` tip. It serializes release runs, rejects an older version that could move npm's `latest` tag backwards, and accepts an already-published version only when its registry integrity matches the checked artifact.

## Convention references

- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces)
- [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Vite guide](https://vite.dev/guide/)
- [Python src layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)
- [Python pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/)
- [FastAPI larger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
- [Architecture decision records](https://adr.github.io/)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Semantic Versioning](https://semver.org/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Forge Vite + TypeScript](https://www.electronforge.io/templates/vite-+-typescript)
- [Forge Vite plugin and its experimental status](https://www.electronforge.io/config/plugins/vite)
- [Forge physical dependency and pnpm/Yarn constraints](https://www.electronforge.io/readme)
- [Tauri project structure](https://v2.tauri.app/start/project-structure/)
- [Tauri capabilities and app command permissions](https://v2.tauri.app/security/capabilities/)
- [Tauri typed commands and Rust errors](https://v2.tauri.app/develop/calling-rust/)
- [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Vite CSS import/HMR behavior](https://vite.dev/guide/features.html#css)
