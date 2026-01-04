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
- Additional coverage:
  - `session/update` can arrive as a **JSON-RPC request** (not just notification) (`tests/e2e_session_update_as_request.rs` + `tests/fixtures/fake-agent-session-update-request.mjs`)
- Notes:
  - Tests kill the spawned fake agent process explicitly to avoid hanging the test runner.
  - Shared test helpers live in `packages/tui/tests/common/mod.rs` to keep the e2e tests DRY.

### 2026-01-04 — Bootstrap (initialize + session/new)

- Added a bootstrap helper (`packages/tui/src/protocol/bootstrap.rs`) that:
  - sends `initialize` and then `session/new` (or `session/load`)
  - returns the active `sessionId`
- Tests:
  - `cd packages/tui && cargo test` (see `packages/tui/tests/bootstrap.rs`)
- Notes:
  - Bootstrap responds `deny` if a permission request happens unexpectedly during startup (should be rare).

### 2026-01-04 — Input + pane toggles (headless)

- Added headless UI actions (`packages/tui/src/app/ui.rs`) for:
  - editing the input line
  - Enter → append a user message and emit a `session/prompt` request
  - input history up/down
  - pane visibility toggles (chat/activity/debug)
- Tests:
  - `cd packages/tui && cargo test`

### 2026-01-04 — First interactive TUI loop (ratatui)

- Implemented a first interactive UI loop with:
  - spawn agent, bootstrap session, then enter a ratatui render loop
  - chat pane, activity pane, debug pane (toggleable)
  - input line editor + history + Enter sends `session/prompt`
- Files:
  - `packages/tui/src/ui/mod.rs`
- Tests:
  - `cd packages/tui && cargo test` (unit + scenario e2e)
- Notes:
  - Permissions are now handled interactively via a modal (Up/Down/Enter) instead of auto-deciding.

### 2026-01-04 — Focus + scroll

- Added focus cycling and basic scrolling:
  - `Tab` cycles focus across visible panes
  - Up/Down scroll Chat/Activity/Debug when those panes are focused
  - Up/Down navigate input history when Input is focused
- Tests:
  - `cd packages/tui && cargo test` (see `app::ui::tests::focus_cycle_skips_hidden_panes`)

### 2026-01-04 — Command palette + help

- Added:
  - Command palette (`Ctrl+K`) with a small set of actions (toggle panes, focus input, quit)
  - Help overlay (`?` or `F1`)
- Tests:
  - `cd packages/tui && cargo test` (see `app::ui::tests::palette_filters_and_submits`)
