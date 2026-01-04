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
  - Command palette (`Ctrl+K`) with a small set of actions (toggle panes, focus input, new session, quit)
  - Help overlay (`?` or `F1`)
- Tests:
  - `cd packages/tui && cargo test` (see `app::ui::tests::palette_filters_and_submits`)

### 2026-01-04 — Request timeouts + pending map

- Added basic request bookkeeping:
  - `--timeout-ms` flag (default 60000)
  - pending request map keyed by request id
  - periodic expiry emits an Activity line like `timeout: c_7 (ent/models/list)`
  - sessionId updates only happen when the response corresponds to `session/new` or `session/load`
- Tests:
  - `cd packages/tui && cargo test`

### 2026-01-04 — Structured activity items (tool_use + errors)

- Replaced Activity “strings” with structured `ActivityItem`:
  - Added `packages/tui/src/app/activity.rs` with bounded activity queue, upsert-by-`toolCallId`, and detail merging.
  - Activity pane now renders summaries and supports expand/collapse of pretty-printed JSON details.
- Improved captured Ent update fields:
  - `tool_use` now includes `name`, `status`, and optional `result` (still tolerant of missing fields).
  - `job_started` / `job_finished` decode added (rendered as simple log lines for now).
- UX:
  - Activity pane selection + expand toggle: Up/Down selects, Enter toggles expansion.
  - RPC response errors and timeouts are now structured activity entries (errors expand by default).
- Tests:
  - `cd packages/tui && cargo test` (unit + scenario e2e)

### 2026-01-04 — Activity jump-to-turn (best-effort)

- Added turn metadata capture:
  - `text_delta` and `turn_end` updates now carry `turnId`/`turnSeq` into `ChatMessage` (assistant messages only).
- Added Activity → Chat navigation:
  - When an Activity item has `turnId`/`turnSeq`, `g` jumps focus to Chat and scrolls to the matching assistant message.
- Added structured entries for `job_started` / `job_finished` updates (Activity kinds).
- Tests:
  - `cd packages/tui && cargo test` (includes `app::ui::tests::activity_jump_to_turn_sets_chat_focus_and_scroll`)

### 2026-01-04 — Configure wizard (ent/*) + graceful fallback

- Added a first in-TUI provider/model configuration flow:
  - Palette action: “Configure...”
  - Wizard steps: list connections → (optionally) create connection → credentials → list models → apply config.
  - Graceful “method not found” handling shows “configuration not supported” (no crash).
- Session status bar now shows `conn` + `model` when known.
- Tests:
  - Unit tests in `packages/tui/src/app/config_wizard.rs`
  - Scenario e2e: `packages/tui/tests/e2e_configure_wizard.rs` (drives `fake-agent-configure.mjs`)

### 2026-01-04 — Status bar config from ent/agent/status (best-effort)

- On startup, the TUI now sends `ent/agent/status` (if supported) and updates the status bar `conn=` / `model=` fields from `currentSession`.
- For non-Lace agents that don’t implement this method, the “method not found” error is suppressed for this specific request.
- Tests:
  - `cd packages/tui && cargo test` (see `protocol::ent::tests::extracts_agent_status_config`)

### 2026-01-04 — Session picker + aliases (local)

- Added session management UX:
  - Palette action: “Sessions...”
  - Session picker modal supports filtering, loading, and local renaming (alias) via `r`.
  - `session/list` is used to populate the list (scoped to current `workdir`).
- Added local alias persistence:
  - Stored at `$LACE_DIR/tui/session-aliases.json` when `$LACE_DIR` is set.
  - Otherwise falls back to `$XDG_STATE_HOME/lace/tui/session-aliases.json` or `$HOME/.local/state/lace/tui/session-aliases.json`.
- Added best-effort “don’t lose place” behavior:
  - When switching sessions, the TUI snapshots the current session’s chat/activity/debug + scroll positions and restores them if you return to that session during the same run.
- Tests:
  - Unit tests in `packages/tui/src/app/sessions.rs`
  - Scenario e2e: `packages/tui/tests/e2e_sessions_list_load.rs`

### 2026-01-04 — Search + jump navigation

- Added search modal:
  - Palette action: “Search...” and keybind `Ctrl+F`.
  - Searches chat text, activity summaries/details, and debug lines.
  - Results are selectable; Enter jumps focus/scroll/selection to the target.
- Added quick jumps:
  - `e` → last error/timeout in Activity
  - `t` → last tool_use in Activity
  - `n` → last turn_end in Activity
- Tests:
  - Unit tests in `packages/tui/src/app/search.rs`
  - UI test: `app::ui::tests::palette_search_opens_modal`

### 2026-01-04 — Permission UX improvements

- Permission modal now shows full request details:
  - tool/kind/resource, `turnId`, `turnSeq`, `jobId`, `toolCallId`
  - tool input pretty-printed JSON when available
- Keyboard behavior:
  - `Esc` denies if a deny option is present.
- In-memory “allow for session”:
  - If the chosen `optionId` looks like “allow for session”, it’s remembered in-memory (keyed by tool/kind/resource) and auto-applied for future matching permission requests in the same session.
  - Allowlist is snapshotted/restored when switching sessions in the same run.
- Tests:
  - `cd packages/tui && cargo test` (see `permission_allowlist_auto_decides_when_matching` and `permission_cancel_picks_deny_if_present`)

### 2026-01-04 — Copy/export + multiline input

- Copy actions:
  - Copy selected Activity (`y` when Activity focused; also via palette)
  - Copy last assistant message (palette)
  - Copy tool input / tool result JSON (palette; based on selected Activity item details)
  - Clipboard support uses a best-effort command (`pbcopy` / `wl-copy` / `xclip` / `xsel`), with env override `LACE_TUI_CLIPBOARD_CMD`; otherwise falls back to Debug output.
- Export:
  - Export transcript (Markdown) to the current `workdir` (palette).
- Input editor:
  - Multiline toggle: `Ctrl+E` or palette “Toggle Multiline Input”
  - In multiline mode: `Enter` inserts newline, `Ctrl+Enter` sends
  - `PgUp/PgDn` scrolls the focused pane, including multiline input.
- Tests:
  - `cd packages/tui && cargo test` (see `app::transcript::*`, `app::clipboard::*`, `multiline_enter_inserts_newline_and_ctrl_enter_sends`)

### 2026-01-04 — Preferences persistence (COULD)

- Added persisted preferences:
  - pane visibility, multiline toggle
  - last used `connectionId` / `modelId` (used as default selections in Configure wizard)
- Storage location:
  - `$LACE_DIR/tui/preferences.json`, else
  - `$XDG_STATE_HOME/lace/tui/preferences.json`, else
  - `$HOME/.local/state/lace/tui/preferences.json`
- Tests:
  - `cd packages/tui && cargo test` (includes `app::prefs::*` and Configure-wizard preference selection tests)

### 2026-01-04 — Theming + vim-ish keybind mode (COULD)

- Added lightweight themes (palette):
  - Theme: Dark / Light / High Contrast
- Added keybind mode (palette):
  - Keybinds: Default / Vim
  - Vim mode remaps `j/k` → `Down/Up` when not focused on input.
- Tests:
  - `cd packages/tui && cargo test` (includes `ui::tests::vim_*` and `app::ui::*_updates_preferences`)

### 2026-01-04 — Markdown-ish chat rendering (COULD)

- Render fenced code blocks (``` fences) as boxed paragraphs in Chat when `render_markdown` is enabled:
  - example: `┌─ <lang> ─`, `│ <line>`, `└─`
- Added palette action: “Toggle Markdown Rendering”.
- Tests:
  - `cd packages/tui && cargo test` (includes `ui::markdown::*`)

### 2026-01-04 — Manual smoke (real Lace agent)

Commands run (from this worktree):

```bash
npm run build --workspace=packages/agent

# Note: `.env` lives at `../../../.env` in this worktree (NOT `../../.env`).
set -a && source ../../../.env >/dev/null 2>&1 && set +a
cargo run --manifest-path packages/tui/Cargo.toml -- --workdir "$(pwd)" --agent-cmd "node packages/agent/dist/main.js"
```

Manual steps in the UI:
- Open palette (`Ctrl+K`), select “Configure...”
- Pick `OpenAI [ready]`, then pick model `gpt-4.1`
- Prompt: `hi!`

Observed:
- Configure wizard completed and status bar updated to `conn=openai-openai model=gpt-4.1`.
- Prompt streamed into a single coalesced assistant message and finalized on `turn_end`.
- `Ctrl+C` exited and restored the terminal (alternate screen was left cleanly).

### 2026-01-04 — Bugfix: provider config errors + modal rendering

- Problem observed:
  - Prompting before configuring provider/model caused a JSON-RPC error (`Missing provider configuration: connectionId and modelId are required`) and the agent’s stack trace could corrupt the TUI.
  - Modal overlays could show bleed-through from the underlying screen.
- Fixes:
  - Agent stderr is captured and routed into the Debug pane (`agent stderr: ...`) instead of writing directly to the terminal.
  - When `session/prompt` fails with “missing provider configuration” and no `conn/model` are set, the TUI auto-opens “Configure…” (best-effort; still degrades gracefully for non-Lace agents).
  - Modal overlays render a `Clear` over their rectangle before drawing to avoid background bleed-through.
- Tests:
  - `cd packages/tui && cargo test` (includes `captures_child_stderr_lines`, `overlays_clear_their_rect_to_avoid_bleedthrough`, `auto_opens_config_wizard_when_prompt_requires_provider_config`)

### 2026-01-04 — Bugfix: chat autoscroll

- Problem observed:
  - Chat “history” didn’t naturally follow the latest messages; you could end up typing while the viewport stayed on older content.
- Fix:
  - Chat now auto-scrolls to the bottom by default.
  - Scrolling up disables follow-mode; scrolling back down to the bottom re-enables it.
  - Sending a prompt re-enables follow-mode (so you see the response).
- Tests:
  - `cd packages/tui && cargo test` (includes `chat_autoscroll_follows_bottom_until_user_scrolls_up`)
