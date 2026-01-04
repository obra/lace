# Ent TUI (Ratatui) — 1.0 Scope + Acceptance Criteria

Jesse: this is the “ship a compelling 1.0” scope document. It is intentionally feature-forward, and **YAGNI applies to implementation shape**, not features.

## Goals (1.0)

- Make developers *want* to use this daily over a basic REPL.
- Keep it scriptable/debuggable: always possible to understand what the agent did and why.
- Work well with:
  - **Lace agents** (extra features like provider/model configuration), and
  - **non-Lace Ent agents** (graceful degradation, no assumptions).

## Non-Goals (1.0)

- Full IDE features (syntax highlighting, full diff viewer, multi-file editor) unless explicitly required for UX.
- Multi-agent orchestration.
- Remote transports (HTTP/WebSocket).

## Current Baseline (what exists today)

- Package: `packages/tui` (Rust + `ratatui`, `crossterm`).
- Capabilities today:
  - spawn agent via `--agent-cmd` (shell string)
  - `initialize` + `session/new|load`
  - stream `text_delta`, finalize on `turn_end` (or prompt response fallback)
  - permission modal (Up/Down/Enter)
  - panes: Chat/Activity/Debug toggleable; focus cycle; basic scroll
  - command palette (Ctrl+K), help (`?`/`F1`), new session action
- Tests:
  - unit tests for JSON-RPC codec, Ent decoders, reducers
  - scenario e2e tests spawning Node fixtures (including `session/update` as request)

Implementation log: `docs/plans/2026-01-04/ent-tui-ratatui-implementation-log.md`.

## 1.0 Must/Should/Could

### MUST (ship-blockers)

#### 1) Provider/model configuration (Lace-only, graceful fallback)

**User story:** As a user, I can configure the session’s `connectionId` + `modelId` from inside the TUI, and it’s obvious when an agent doesn’t support it.

**Acceptance criteria**
- Status bar shows active `connectionId` + `modelId` when known.
- “Configure…” action exists (palette + optional key).
- If agent supports configuration:
  - list connections (`ent/connections/list`)
  - pick one (only ready default auto-select allowed)
  - list models (`ent/models/list`) and pick one
  - apply config (`ent/session/configure`)
  - confirm in UI (and update status)
- If agent does **not** support configuration:
  - UI shows “configuration not supported by this agent” (no crash).

**Minimal implementation shape**
- Add a small “wizard modal” state machine:
  - step: loading, select connection, select model, applying, done/error
- Keep it DRY by reusing existing request plumbing (see “RPC bookkeeping” below).
- Keep config features behind “method exists” detection:
  - simplest: attempt request and handle JSON-RPC “method not found”.

**Files likely touched**
- `packages/tui/src/app/mod.rs` (new wizard state)
- `packages/tui/src/app/ui.rs` (actions for wizard)
- `packages/tui/src/ui/mod.rs` (render wizard modal + route key events)
- `packages/tui/src/protocol/ent.rs` (typed helpers for ent methods)
- `packages/tui/tests/` (new e2e fixture + scenario)

**Tests**
- Unit: wizard reducer transitions (happy path + method-not-found)
- E2E: spawn fixture that supports `ent/*` methods and verify state.

#### 2) Session management (list + load + rename/alias)

**User story:** As a user, I can see recent sessions, switch between them, and not lose my place.

**Acceptance criteria**
- Session picker view/modal:
  - list sessions via `session/list`
  - load session via `session/load`
  - new session via `session/new`
- Local aliasing:
  - allow renaming a session *locally* (no protocol requirement) for convenience.
- Status shows current sessionId and last activity timestamp.

**Minimal implementation shape**
- Maintain a local `HashMap<sessionId, alias>` persisted to a small file under a user data dir (or `$LACE_DIR` if present).
  - If persistence is too heavy for 1.0, at least keep it in-memory + document it.
- Session list is a modal with filter/search.

**Files likely touched**
- `packages/tui/src/app/mod.rs` (session list state + alias map)
- `packages/tui/src/ui/mod.rs` (session picker modal)
- `packages/tui/src/protocol/bootstrap.rs` (load/new helpers)

**Tests**
- Unit: list/load actions emit correct requests
- E2E: use existing Node fixtures for `session/list` (may need a new fixture)

#### 3) Activity as structured timeline (not strings)

**User story:** As a user, I can quickly see what tools/jobs happened, their status, and inspect inputs/outputs without noise.

**Acceptance criteria**
- Activity pane entries are structured:
  - tool_use: `toolCallId`, tool name, status, input (if present), outcome/error
  - job_started/job_finished/job_update where present
  - errors (JSON-RPC + tool errors)
- Entries can be expanded/collapsed (at least one level).
- Jump from activity entry to related chat turn (best-effort).

**Minimal implementation shape**
- Replace `VecDeque<String>` with `VecDeque<ActivityItem>`:
  - stable id (toolCallId/jobId/seq)
  - compact summary string + optional details JSON
- Rendering: one widget that renders summary lines; expanded items show indented lines.
- Keep “expand/collapse” state on the item (no global registry).

**Files likely touched**
- `packages/tui/src/app/mod.rs` (ActivityItem types)
- `packages/tui/src/protocol/ent.rs` (decode more update types)
- `packages/tui/src/ui/mod.rs` (activity renderer + selection)
- `packages/tui/src/app/ui.rs` (actions: select/expand)

**Tests**
- Unit: decoding tool_use/job_* into ActivityItem updates correctly
- E2E: permission fixture + streaming fixture should drive activity updates

#### 4) Permission UX: fully informative + safe

**User story:** When the agent asks permission, I can make the correct choice confidently, fast.

**Acceptance criteria**
- Modal shows:
  - tool, kind, resource, toolCallId, turnId, turnSeq, jobId (if present)
  - tool input (pretty JSON) or `<unavailable>`
  - options list (optionId + label)
- Keyboard UX:
  - Up/Down select, Enter decide
  - Esc cancels/denies if agent provides deny option; otherwise no-op
- Optional but strongly recommended:
  - “Allow for session” decisions are remembered in-memory and auto-applied for matching future requests in that session.

**Minimal implementation shape**
- Keep current modal but improve rendering and selection:
  - pretty-print JSON with stable formatting
- Add a tiny in-memory allowlist keyed by `(tool, resource)` or `(tool, kind, resource)` depending on what agent provides.
  - Only use options actually present in request.

**Tests**
- Unit: rendering helper for permission lines; decision validation
- E2E: permission scenario asserts that tool input is cached and decision is sent

#### 5) Search + jump navigation

**User story:** I can find past content and jump to important events (errors/tools) instantly.

**Acceptance criteria**
- Search in:
  - chat text
  - activity entries
  - debug logs
- Jump shortcuts:
  - last error
  - last tool_use
  - last turn_end
- Search results are selectable; Enter jumps focus/scroll to the match.

**Minimal implementation shape**
- Implement a “search modal” reusing palette mechanics:
  - query string, results list (label + target)
- Targets store “scroll offsets” or item indices (not view coordinates).

**Tests**
- Unit: search index over chat/activity

### SHOULD (strongly recommended for a delightful 1.0)

#### 6) Copy/export ergonomics

**Acceptance criteria**
- Copy (to clipboard or to stdout fallback) of:
  - selected activity item (summary + details)
  - last assistant message
  - tool input/result JSON
- Export transcript to a file (workdir or user-chosen path).

**Minimal implementation shape**
- Implement “Copy…” actions as “write to clipboard if available, else write to `Debug` pane with a clear prefix”.
- Export: write a simple Markdown transcript (chat + activity summaries).

#### 7) Better input editor (multiline + paste-friendly)

**Acceptance criteria**
- Multiline compose toggle:
  - Enter inserts newline
  - Ctrl+Enter sends
- Draft persists when focus/panes change.

**Minimal implementation shape**
- Store input as `Vec<String>` lines, render in a small input box with scrolling.
- Keep single-line as default; multiline only when toggled.

#### 8) RPC bookkeeping (small, correct)

**Acceptance criteria**
- Track pending client requests by id:
  - method, start time, timeout
  - surface timeouts as errors in Activity
- Don’t “infer sessionId from any response”; only from `session/new|load` results.

**Minimal implementation shape**
- Maintain `HashMap<id, PendingRequest>`.
- When response arrives:
  - remove pending
  - route to handler based on the request’s method

### COULD (if time remains, still consistent with 1.0)

- Persist UI preferences (pane visibility, keybind mode, last used connection/model).
- Lightweight theming (dark/light, high-contrast).
- Render markdown-ish chat (code blocks as boxed paragraphs).

## Release Criteria (1.0)

- `cd packages/tui && cargo test` passes locally and in CI.
- Manual smoke:
  - Run against Lace agent, configure connection/model, prompt, approve a tool, see result.
  - Run against a non-Lace fake agent fixture, no configuration features crash.
- Terminal always restores cleanly on exit and on panic.
- Documentation:
  - `packages/tui/README.md` is accurate (run/test/keybinds).
  - This doc is kept in sync with what we actually ship.

