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
  feeding four typed registries (tools, compaction, recall, runtimes) plus the
  persona/skill directory contributions. Embedders extend lace here. See
  [Writing Plugins](../writing-plugins.md) and the
  [Plugin System Reference](../reference/plugins.md). For external tools (exec
  binaries, MCP servers) see [External Tools](../external-tools.md).

- [Model-call correlation](model-call-correlation.md): optional runtime IDs,
  local proxy request headers and returned worker-turn associations.

- [Temporary request context](temporary-request-context.md): sticky Ent
  request-only text, session lifetime and provider cache boundaries.

- [Memory authority and permissions](memory-authority.md): internal database
  identity, ownership and permission checks for configured memory.
- [Automatic memory](automatic-memory.md): local model setup, related
  current-note vectors, bounded reconciliation and current-account transcript
  attachments, alongside retained-source discovery, background extraction,
  atomic derived notes and existing recall integration.

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
