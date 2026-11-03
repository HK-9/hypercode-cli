# Changesets

Every pull request that changes the published CLI's behavior or package contents must include one Changeset file. Create one with `npm run changeset`, select `hypercode-init`, choose `patch`, `minor`, or `major`, and write a concise user-facing note. Commit the generated `.changeset/<name>.md` in the same source PR. CI checks the changeset against `main`; if the change intentionally has no user-facing release impact, use `npx changeset --empty` and explain why in the PR.

Changeset intent:

- `patch`: compatible bug fixes and small corrections.
- `minor`: backwards-compatible user-facing functionality.
- `major`: breaking behavior or public CLI/template changes that need migration.

This package is pre-1.0. Changesets follows SemVer's numeric rules: for version `0.1.0`, `patch` yields `0.1.1`, `minor` yields `0.2.0`, and `major` yields `1.0.0`. Choose based on compatibility, not the fact that the package is below 1.0.

The Changesets bot collects merged source PRs that contributed changeset files into one `Version Packages` release PR. Its generated package version and `CHANGELOG.md` provide the reviewable release plan; the bot PR links back to the source PRs. Review and approve that release PR separately before merging it to `main`.

The release PR merge does not itself bypass the npm approval gate. Only a verified version-bump PR merge on `main` can start `.github/workflows/npm-release.yml`; the `npm-release` GitHub Environment then requires HK-9's separate approval before OIDC publishing runs. Retries use the original release commit SHA, not the current tip of `main`.
