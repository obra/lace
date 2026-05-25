# CODE-MAP

## Packages

| Package                 | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `packages/ent-protocol` | Shared Ent protocol types, schemas, and transports |
| `packages/agent`        | Out-of-process Lace agent runtime                  |
| `packages/supervisor`   | Process coordinator for agent runtimes             |
| `packages/cli`          | CLI client for Ent-protocol agents                 |

## Key Entry Points

- `packages/ent-protocol/src/index.ts`: protocol exports.
- `packages/agent/src/main.ts`: agent process executable.
- `packages/agent/src/index.ts`: agent package exports.
- `packages/supervisor/src/index.ts`: supervisor package exports.
- `packages/cli/src/main.ts`: CLI executable.

## Common Commands

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

## Navigation

```bash
rg "Session" packages/agent/src
rg "Ent" packages/ent-protocol/src
rg "Supervisor" packages/supervisor/src
rg "stdio" packages/cli/src
```
