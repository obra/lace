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

### 2026-01-04 — Core state + reducer (headless-testable)

- Added a minimal `AppState` + reducer for:
  - streaming assistant text via `text_delta`
  - ending streams via `turn_end` (or prompt response fallback)
  - capturing `tool_use` inputs by `toolCallId`
  - queuing and deciding `session/request_permission`
- Files:
  - `packages/tui/src/app/mod.rs`
  - `packages/tui/src/app/reducer.rs`
- Tests:
  - `cd packages/tui && cargo test`
- Notes:
  - This is intentionally UI-agnostic so we can build reliable e2e tests without pixel snapshots.

### 2026-01-04 — Minimal Ent decoding helpers

- Added Ent-specific decoders (`packages/tui/src/protocol/ent.rs`) for:
  - `session/update` → `AppEvent` (text_delta, turn_end, tool_use, job_update wrapper)
  - `session/request_permission` params → `PermissionRequest`
- Tests:
  - `cd packages/tui && cargo test`
- Notes:
  - Decoder ignores unknown update types for now (YAGNI); we’ll expand as the UI needs more event types.

### 2026-01-04 — Scenario e2e tests (spawn Node fake agents)

- Added Rust integration tests that spawn the existing Node fixtures under `packages/cli/src/__tests__/fixtures` and assert **state transitions** (no pixel snapshots).
- Tests:
  - `cd packages/tui && cargo test`
- Coverage:
  - Streaming: `text_delta` + `turn_end` finalize (`tests/e2e_fake_agent_streaming.rs`)
  - Permissions: `tool_use` captured → `session/request_permission` decided → streamed assistant output (`tests/e2e_fake_agent_permission.rs`)
- Notes:
  - Tests kill the spawned fake agent process explicitly to avoid hanging the test runner.
  - Shared test helpers live in `packages/tui/tests/common/mod.rs` to keep the e2e tests DRY.
