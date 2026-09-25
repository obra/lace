# Contributing to lace

Thanks for helping improve `lace`. This document describes the process the
repository actually uses today.

- Repository: `https://github.com/obra/lace` (`main` branch)
- License: Apache-2.0
- Toolchain: Node `>=20.18.3` and Bun `>=1.2.21` (see `package.json` `engines`)

## 1. Set up

```bash
git clone https://github.com/obra/lace
cd lace
npm ci
npm run build
```

The monorepo has three packages: `packages/ent-protocol`, `packages/agent`, and
`packages/cli`. There is also a Docker dev environment described in
`docs/development.md` (`docker-compose up -d`).

## 2. Before you open a PR: run these locally

```bash
npm run typecheck     # tsc --noEmit across all three packages
npm run lint          # ESLint across agent + ent-protocol
npm test              # vitest, all packages (npm run test:run is an alias)
npm run format:check  # Prettier over the whole tree, including markdown
npm run build         # CI builds too; a clean local build catches most issues early
```

To run a single test file:

```bash
npx vitest run <path>     # from inside the package that owns the file
```

The full `packages/agent` unit suite takes several minutes. Some integration
suites call live model APIs; skip those locally unless your change needs them.

## 3. PR titles

PR titles follow conventional-commit style: `feat(scope): …`, `fix(scope): …`,
`docs: …`, `chore: …`, `ci: …`, `test(scope): …`. The scope is the area you
changed, for example `fix(providers):`, `feat(catalog):`, `test(agent):`.

Examples:

- `fix(providers): stateless Responses API for gateways without response chaining`
- `feat(catalog): add claude-opus-5-5 to the static Anthropic catalog`
- `ci: run CI on fork PRs and test all three packages`

## 4. Tickets

If there is a tracking ticket, reference it (for example `PRI-1234`) in the PR
title or body. This is common practice, not a CI requirement.

## 5. Forks, branches and PRs

- The target branch is `main` on `obra/lace`.
- Contributors open PRs from their own fork (`<you>:fix/...` → `obra:main`).
  Maintainers may branch inside `obra/lace` directly.
- Branch names are short and descriptive, often `fix/...`, `feat/...`, or
  `pri-1234-...`.

## 6. What CI checks

CI (`.github/workflows/ci.yml`) runs on every PR to `main`:

1. `npm ci`
2. `npm run build`
3. `npm run lint`
4. `npm run format:check`
5. tests for `ent-protocol`, `agent` (with coverage), and `cli`
6. Codecov upload

`format:check` runs Prettier over
`**/*.{ts,tsx,js,jsx,json,md,css,scss,html,yml,yaml}`, so markdown docs are
checked too: a mis-formatted doc fails the build.

There is no separate typecheck step in CI; the `tsc` run inside `npm run build`
covers type errors. Run `npm run typecheck` locally anyway.

## 7. Stacked PRs

If your PR builds on another open PR, start the body with:

```
Depends on #N; review that first — this diff includes its commits until it merges.
```

Then describe your own change.

## 8. Review and merging

- Open the PR as a draft while it is in flight, and mark it ready for review
  when it is.
- A maintainer reviews and merges. Don't merge your own PR.
- A maintainer may push review fixes onto your branch before merging.

## 9. Tests for bug fixes

`docs/development.md` describes the TDD workflow:

1. Write a failing test
2. Run it to confirm it fails
3. Write the minimal code to make it pass
4. Refactor, keeping tests green

Every bug fix should include a regression test that fails before the fix and
passes after. Say so in the PR body. A test that also passes on the old code
doesn't prove anything, so check that it fails first.

## 10. Style

From `CLAUDE.md` and `docs/development.md`:

- Files start with an `// ABOUTME:` comment explaining their purpose.
- Strict TypeScript; never `any`.
- Use the repo's logger, never `console.log`.
- Pre-commit hooks run ESLint, Prettier and related tests. Don't skip them.
- Keep changes small, direct, and easy to verify.
- Lint is ESLint plus Prettier. (The `Biomefile` in the repo root is an unused
  stub.)

## 11. Keep commits and PRs self-contained

This repository is publicly readable. Write commit messages, PR bodies and
CHANGELOG entries so they stand on their own: don't include internal hostnames,
private filesystem paths, links to private chat, or credentials.
