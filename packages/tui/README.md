# `lace-tui` (WIP)

Premium terminal UI for driving Ent-protocol-speaking agents over stdio (NDJSON JSON-RPC).

## Run (WIP)

From repo root:

```bash
cd packages/tui
cargo run -- --help
```

## Test

```bash
cd packages/tui
cargo test
```

### E2E tests (scenario-based)

`cargo test` includes integration tests in `packages/tui/tests` that spawn the Node fake agents under
`packages/cli/src/__tests__/fixtures`. You need `node` on your PATH.
