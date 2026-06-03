# CODE-MAP

## Packages

| Package                 | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `packages/ent-protocol` | Shared Ent protocol types, schemas, and transports |
| `packages/agent`        | Out-of-process Lace agent runtime                  |
| `packages/cli`          | CLI client for Ent-protocol agents                 |

## Key Entry Points

- `packages/ent-protocol/src/index.ts`: protocol exports.
- `packages/agent/src/main.ts`: agent process executable.
- `packages/agent/src/index.ts`: agent package exports.
- `packages/cli/src/main.ts`: CLI executable.
- `packages/agent/src/plugins/`: the plugin system — one `LACE_PLUGINS` loader
  feeding four registries (tools, compaction, runtimes, personas). Embedders
  extend lace here. See [Writing Plugins](../writing-plugins.md) and the
  [Plugin System Reference](../reference/plugins.md). For external tools (exec
  binaries, MCP servers) see [External Tools](../external-tools.md).

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
rg "stdio" packages/cli/src
```
