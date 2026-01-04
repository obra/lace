# Ent TUI (Ratatui) — Implementation Log

Jesse: this is a running log of what was done, why, and how it was tested. Keep it updated as we build.

## 2026-01-04

### 2026-01-04 — Scaffold

- Added new Rust crate `packages/tui` (binary: `lace-tui`) with minimal `--help` and args parsing.
- Tests:
  - `cd packages/tui && cargo test`
- Notes:
  - No async runtime yet; no protocol code yet. This is intentionally skeleton-only.
  - Crate deps pinned to `ratatui 0.29` + `crossterm 0.28` for now; revisit only if needed.

### 2026-01-04 — JSON-RPC message parsing/encoding

- Added a small JSON-RPC message parser/encoder (`packages/tui/src/protocol/jsonrpc.rs`).
- Tests:
  - `cd packages/tui && cargo test`
- Notes:
  - We classify inbound messages as Request/Response/Notification based on presence of `method` and `id`.
  - `id` is preserved as `serde_json::Value` to stay compatible with non-Lace agents.

### 2026-01-04 — NDJSON transport (spawn + read/write)

- Added a minimal spawn+stdio transport (`packages/tui/src/protocol/transport.rs`) that:
  - spawns an agent via `sh -lc "<agent-cmd>"`
  - reads NDJSON lines from stdout
  - writes lines to stdin
  - forwards agent stderr to our stderr
- Tests:
  - `cd packages/tui && cargo test` (includes a `cat` round-trip test)
- Notes:
  - This is intentionally low-level; higher-level JSON-RPC request tracking comes later.
