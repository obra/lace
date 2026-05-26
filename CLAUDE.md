# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Finding Your Way

[CODE-MAP](docs/architecture/CODE-MAP.md) summarizes the current package layout
and key entry points.

## Project Overview

Lace is a TypeScript monorepo for an out-of-process AI coding agent runtime. The
active surfaces are the Ent protocol package, the agent process, and a CLI
client.

## Development Commands

```bash
npm run build         # Build protocol, agent, and CLI packages
npm run dev           # Start the CLI client
npm run typecheck     # Type-check all active packages
npm run lint          # Lint packages that define lint scripts
npm test              # Run package tests once
npm run test:coverage # Run agent coverage
```

## Debug Logging

```bash
LACE_LOG_LEVEL=debug LACE_LOG_STDERR=true npm run dev
```

Environment variables:

- `LACE_LOG_LEVEL`: `error`, `warn`, `info`, or `debug`
- `LACE_LOG_STDERR`: set to `true` to output logs to stderr
- `LACE_LOG_FILE`: optional file path for log output

## Development Notes

- Pre-commit hooks run linting, formatting, and related checks.
- TypeScript strict mode is expected to pass before changes are complete.
- Keep changes small, direct, and easy to verify.
- Do not add backward-compatibility paths for removed pre-v1 surfaces.

## Package Layout

- `packages/ent-protocol`: shared Ent protocol types, schemas, and transports.
- `packages/agent`: out-of-process agent runtime and provider/tool logic.
- `packages/cli`: command-line client for driving Ent-protocol agents.

## Import Style

- Same-folder imports use relative paths.
- Cross-package imports use package names such as `@lace/ent-protocol`.
- Declare imports at the top of the file; avoid inline dynamic type imports
  unless the runtime behavior requires dynamic loading.
