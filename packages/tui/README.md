# `lace-tui` (WIP)

Premium terminal UI for driving Ent-protocol-speaking agents over stdio (NDJSON JSON-RPC).

## Run

From repo root:

```bash
cd packages/tui
cargo run -- --help
```

Run against the built Lace agent:

```bash
npm run build --workspace=packages/agent
cd packages/tui
cargo run -- --workdir "$(pwd)"
```

Or specify an agent command explicitly:

```bash
cd packages/tui
cargo run -- --workdir "$(pwd)" --agent-cmd "node ../../packages/agent/dist/main.js"
```

## Test

```bash
cd packages/tui
cargo test
```

### E2E tests (scenario-based)

`cargo test` includes integration tests in `packages/tui/tests` that spawn the Node fake agents under
`packages/cli/src/__tests__/fixtures`. You need `node` on your PATH.

## Keybinds

- `Ctrl+C`: quit
- `Ctrl+K`: command palette
- `Ctrl+1`: toggle Chat pane
- `Ctrl+2`: toggle Activity pane
- `Ctrl+3`: toggle Debug pane
- `Tab`: cycle focus
- `Up/Down`: scroll (when a pane is focused) or history (when input is focused)
- `?` / `F1`: help

Permission modal:
- `Up/Down` select, `Enter` decide
