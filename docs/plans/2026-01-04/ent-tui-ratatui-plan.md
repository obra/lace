# Ent Protocol TUI Client (Ratatui, Rust) — UX + Implementation Plan

Jesse: this doc is written for a skilled engineer with **almost zero context**
on Lace/Ent, uneven taste, and limited test-design instincts. It is
intentionally explicit and procedural.

## One-Sentence Summary

Build a **premium-feeling terminal UI** (Rust + `ratatui`) that drives **any
Ent-protocol-speaking agent** over **NDJSON JSON-RPC over stdio**, with great
streaming, a first-class permission UI, and toggleable panes.

This lives in a new package **next to** `packages/cli` (the current line-based
REPL), and does **not** replace it.

## Hard Constraints (Do Not Violate)

- **DRY / YAGNI:** build the minimum that feels excellent; no speculative
  frameworks.
- **TDD:** write tests first for any non-trivial logic (reducers/state
  machines/parsers).
- **Frequent commits:** commit after each bite-sized task once tests pass.
- **Compatibility:** must work with **non-Lace** agents implementing Ent
  protocol (no Lace-only assumptions).
- **Permissions:** always show tool input (or `<unavailable>` if missing); no
  “edit tool input” UX for v1.
- **Panes are toggleable:** user can show/hide Chat, Activity, Logs/Debug (and
  later Files/Diff).

## Read This First (Context You Need)

### Protocol & baseline CLI

- `docs/plans/2026-01-03/ent-cli-client-spec.md` (baseline expectations, method
  names, prompts, config behavior).
- `packages/cli/src/main.ts` (working reference implementation for:
  - spawn model
  - `session/new` vs `session/load`
  - handling `session/update` + `session/request_permission`
  - streaming `text_delta` and “end turn” via `turn_end`)

### Relevant design references (skim, don’t cargo-cult)

- `docs/plans/tool-approval-design.md` (permission/approval UX ideas).
- `docs/plans/tool-renderers.md` + `docs/plans/toolbox-style.md` (how to present
  tool calls cleanly).
- `docs/plans/complete-streaming-timeline.md` (timeline mental model).

## UX: What We’re Building (V1)

### Core mental model

The TUI is a “terminal cockpit” for an agent session:

- Left: **conversation stream** (human + assistant).
- Right: **activity timeline** (tool calls, jobs, key events, errors) as compact
  cards.
- Bottom: **input box** (single-line by default; multiline later only if asked).
- Modal overlays: **permission prompt** and **command palette**.

### Layout (toggleable panes)

Default layout: Chat + Activity, with a persistent input bar.

```
┌ lace-tui ─ sess_… ─ conn:model ─ workdir … ───────────────────────────────────┐
│ Chat (toggle)                                      Activity (toggle)         │
│ ────────────────────────────────────────────      ─────────────────────────  │
│ user: …                                            tool_use shell.exec …     │
│ assistant: … (streaming inline)                    awaiting_permission        │
│                                                    job: … (running)          │
│                                                    errors: 0                 │
├ Input ───────────────────────────────────────────────────────────────────────┤
│ >                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Pane toggles must:

- preserve state (scroll position, selection)
- never lose focus unexpectedly
- degrade gracefully to single-pane on small terminals

### Interactions (minimal, excellent)

#### Essential keys (non-vim, discoverable)

- `Ctrl+C`: quit (with confirmation if a permission is pending).
- `Enter`: send input line.
- `Up/Down`: input history.
- `Tab`: cycle focus between panes (Chat ↔ Activity ↔ Input).
- `Ctrl+P`: open permission queue (if any); otherwise no-op.
- `Ctrl+K`: command palette (search actions).
- `F1` or `?`: help overlay with current keybinds.
- `Ctrl+1`: toggle Chat pane
- `Ctrl+2`: toggle Activity pane
- `Ctrl+3`: toggle Debug/Logs pane (hidden by default)

Vim keys: optional later. Do not implement until the above feels right.

#### Command palette (v1 scope)

Palette is a searchable list of actions, e.g.:

- “New session”
- “Load session…”
- “Configure… (Lace only)”
- “Toggle Activity”
- “Toggle Debug”
- “Copy last tool input”
- “Jump to last error”

This replaces a cluttered keybinding matrix and is the main discoverability
feature.

### Streaming rules (critical polish)

- `text_delta` streams inline in Chat without prefixes or prompt spam.
- A turn is considered ended when we receive either:
  - `session/update` with `type: "turn_end"` (preferred), or
  - the JSON-RPC response to `session/prompt` with `stopReason` (fallback).
- When the turn ends:
  - Chat finalizes the message (cursor stops blinking)
  - Activity marks any pending items (tool_use/job) as finished/failed
  - focus returns to Input unless a modal is open

### Permission UI (v1 scope)

Permission requests arrive via `session/request_permission` (request; must
respond).

Modal must show:

- tool name, kind, resource
- `toolCallId`, `turnId`, `turnSeq`, `jobId` if present
- **tool input**:
  - if we’ve seen a matching `tool_use` update with the same `toolCallId`, show
    its JSON
  - otherwise show `<unavailable>`
- options list (optionId + label)

Choices:

- pick an optionId and submit

Do **not** implement “edit updatedInput” yet.

## Tech Stack (Rust)

### Crates (keep it lean)

- UI: `ratatui`
- Terminal backend: `crossterm`
- JSON: `serde`, `serde_json`
- Async: start with **threads + channels** (std) unless we hit pain. Tokio is
  optional; don’t default to it.
- Process spawn: `std::process::Command`
- Testing: built-in `cargo test` + snapshot testing only if it truly reduces
  boilerplate (avoid golden snapshots for volatile UI).

### Package layout

Create a new Rust crate:

- `packages/tui/` (new)
  - `packages/tui/Cargo.toml`
  - `packages/tui/src/main.rs`
  - `packages/tui/src/app.rs` (state + reducer)
  - `packages/tui/src/ui.rs` (rendering)
  - `packages/tui/src/protocol/` (NDJSON JSON-RPC client + Ent helpers)
  - `packages/tui/src/widgets/` (small reusable widgets, only as needed)
  - `packages/tui/tests/` (scenario/e2e tests)

Do not create a top-level Cargo workspace at repo root unless Jesse explicitly
requests it.

## Architecture (Simple, Testable)

### Data flow

1. Spawn agent process (child stdin/stdout).
2. Reader thread:
   - reads NDJSON lines from agent stdout
   - parses JSON-RPC messages
   - sends typed events into a channel
3. Main loop:
   - polls terminal input events
   - polls agent events channel
   - applies events to `AppState` via a pure reducer
   - renders UI from state
4. Writer:
   - sends JSON-RPC requests/responses to agent stdin

### State management: “reducer” pattern (no overengineering)

Keep most logic in pure functions:

- parse → `AgentEvent`
- `reduce(state, event) -> state`
- `reduce(state, ui_action) -> (state, outbound_requests)`

This is where TDD shines: most bugs become unit-testable without a terminal.

## Testing Strategy (TDD, practical)

### What to unit test (before implementing)

1. **JSON-RPC framing**
   - NDJSON decode errors handled (invalid JSON line → non-fatal, logged)
   - request/response id correlation works
2. **Ent event interpretation**
   - `session/update`:
     - `text_delta` appends to the active assistant message
     - `turn_end` finalizes the stream
     - tool_use with `toolCallId` is captured for permission display
3. **Permission queue**
   - request enqueues
   - selecting option sends correct JSON-RPC response
   - tool input fallback behavior is correct (`<unavailable>`)
4. **Layout toggles**
   - toggling panes doesn’t lose state
   - small terminal collapses gracefully

### What to e2e test (scenario-based)

Use a fake agent that speaks JSON-RPC over stdio (NDJSON). Reuse the existing
Node fixtures to avoid rewriting protocol fakes unless necessary:

- Existing fixtures (Node) to spawn from Rust tests:
  - `packages/cli/src/__tests__/fixtures/fake-agent.mjs`
  - `packages/cli/src/__tests__/fixtures/fake-agent-configure.mjs`
  - `packages/cli/src/__tests__/fixtures/fake-agent-streaming.mjs`

E2E tests should verify:

- the app boots, initializes, creates a session, sends a prompt
- permission modal appears and responds correctly
- streaming completes on `turn_end`

Do **not** attempt pixel-perfect UI asserts. Instead assert on:

- state transitions (export a “headless” mode for tests), or
- a render-to-string function for key widgets only (stable, minimal).

## How To Run / Test (for the engineer)

From repo root:

- Build & run:
  - `cd packages/tui && cargo run -- --workdir "$(pwd)" --agent-cmd "lace-agent"`
  - or:
    `cargo run -- --workdir "$(pwd)" --agent-cmd "node ../../packages/agent/dist/main.js"`
- Unit tests:
  - `cd packages/tui && cargo test`
- E2E tests (spawns Node fake agent):
  - `cd packages/tui && cargo test --test e2e_*`

If Node isn’t on PATH, install it (repo already requires Node for other
packages).

## Bite-Sized Task Plan (Commit after each)

Each task below is:

- small enough to complete in ~30–120 minutes
- test-first
- DRY
- YAGNI

### Task 0 — Create the package skeleton

**Goal:** add `packages/tui` crate that compiles and runs a dummy UI loop.

- Files to create:
  - `packages/tui/Cargo.toml`
  - `packages/tui/src/main.rs`
  - `packages/tui/README.md` (how to run/test)
- Tests (first):
  - none (skeleton only)
- Implementation:
  - initialize terminal
  - render a static screen (“lace-tui (WIP)”)
  - cleanly restore terminal on exit
- Commit: `feat(tui): scaffold ratatui crate`

### Task 1 — Add argument parsing (match CLI semantics)

**Goal:** parse `--agent-cmd`, `--workdir`, `--load`, `--new`, `--timeout-ms`
(optional).

- Files:
  - `packages/tui/src/args.rs`
  - update `packages/tui/src/main.rs`
- Tests (first):
  - `packages/tui/src/args.rs` unit tests: mutual exclusion (`--load` +
    `--new`), defaults, workdir handling
- Commit: `feat(tui): parse spawn/session flags`

### Task 2 — Implement NDJSON JSON-RPC transport (minimal)

**Goal:** spawn a child, read/write NDJSON, parse JSON-RPC messages.

- Files:
  - `packages/tui/src/protocol/mod.rs`
  - `packages/tui/src/protocol/transport.rs`
  - `packages/tui/src/protocol/jsonrpc.rs`
- Tests (first):
  - decode valid message line → struct
  - decode invalid line → error (non-fatal)
  - encode request/response lines
- Notes:
  - keep JSON-RPC types minimal: `id`, `method`, `params`, `result`, `error`
- Commit: `feat(tui): add ndjson json-rpc client`

### Task 3 — Implement “initialize + session/new/load”

**Goal:** on startup, send `initialize`, then `session/new` (default) or
`session/load`.

- Files:
  - `packages/tui/src/protocol/ent.rs` (helpers for Ent methods)
  - `packages/tui/src/app.rs` (state: session id, connection state)
- Tests (first):
  - reducer: “startup sequence scheduled”
  - jsonrpc: request ids increment; responses resolve pending futures
- UX:
  - status bar shows `sessionId` once known
- Commit: `feat(tui): initialize and open session`

### Task 4 — Chat pane with streaming text_delta + turn_end finalize

**Goal:** show user + assistant messages; stream `text_delta` inline; finalize
on `turn_end`.

- Files:
  - `packages/tui/src/app.rs` (message model + reducer)
  - `packages/tui/src/ui.rs` (chat rendering)
- Tests (first):
  - given `text_delta` events, assistant message accumulates text
  - given `turn_end`, message finalizes and streaming flag clears
  - fallback: prompt response with `stopReason` finalizes if `turn_end` never
    arrives
- Commit: `feat(tui): chat streaming with turn_end`

### Task 5 — Input box + send prompt

**Goal:** input line editor, Enter sends `session/prompt`, history up/down.

- Files:
  - `packages/tui/src/app.rs` (input state)
  - `packages/tui/src/protocol/ent.rs` (prompt request)
  - `packages/tui/src/ui.rs`
- Tests (first):
  - reducer: typing updates input buffer
  - reducer: Enter clears buffer and enqueues outbound `session/prompt`
  - history behavior
- Commit: `feat(tui): input + prompt sending`

### Task 6 — Activity pane (minimal, useful)

**Goal:** show compact cards for:

- tool_use updates (status/name/toolCallId)
- job_started/job_finished/job_update (if present)
- errors (JSON-RPC errors, parse errors)

- Files:
  - `packages/tui/src/app.rs` (activity list)
  - `packages/tui/src/ui.rs` (activity rendering)
- Tests (first):
  - tool_use with toolCallId is recorded and updated by status
  - newest-first ordering and bounded length (avoid unbounded memory)
- Commit: `feat(tui): activity timeline`

### Task 7 — Permission modal (queue + respond)

**Goal:** implement `session/request_permission` handling with a modal.

- Files:
  - `packages/tui/src/app.rs` (permission queue state)
  - `packages/tui/src/protocol/ent.rs` (permission response)
  - `packages/tui/src/ui.rs` (modal rendering)
- Tests (first):
  - request enqueues; modal opens
  - selecting option sends response with correct decision
  - tool input display: matches `tool_use` by toolCallId or `<unavailable>`
- Commit: `feat(tui): permission modal`

### Task 8 — Toggleable panes + focus management

**Goal:** make Chat/Activity/Debug panes toggleable; Tab cycles focus; input
focus is stable.

- Files:
  - `packages/tui/src/app.rs` (layout + focus state)
  - `packages/tui/src/ui.rs`
- Tests (first):
  - toggles flip flags and preserve scroll/selection
  - focus cycle deterministic
- Commit: `feat(tui): pane toggles and focus`

### Task 9 — Command palette (minimal actions)

**Goal:** `Ctrl+K` palette with a few actions; fuzzy search is optional (start
with substring).

- Files:
  - `packages/tui/src/app.rs` (palette state)
  - `packages/tui/src/ui.rs` (palette overlay)
- Tests (first):
  - opening palette, filtering list, selecting action dispatches correct command
- Commit: `feat(tui): command palette`

### Task 10 — E2E tests with fake agent(s)

**Goal:** scenario coverage that proves the whole loop works.

- Files:
  - `packages/tui/tests/e2e_streaming.rs`
  - `packages/tui/tests/e2e_permissions.rs`
- Implementation approach:
  - spawn `node` + one of the existing fixtures
  - run the app in “headless test mode” (no actual terminal):
    - feed synthetic key events
    - collect state transitions
    - assert final state (messages, permission decisions, etc.)
- Commit: `test(tui): add scenario e2e coverage`

### Task 11 — Docs & polish pass

**Goal:** ensure a new engineer can succeed quickly.

- Files:
  - `packages/tui/README.md` (run/test/keybinds)
  - update `docs/plans/2026-01-04/ent-tui-ratatui-plan.md` with “what changed”
    notes if needed
- Checklist:
  - “How to run” is correct
  - troubleshooting section (terminal stuck? run `reset`)
  - keybind help overlay matches actual keys
- Commit: `docs(tui): add onboarding and keybind help`

## What Not To Do (Common Failure Modes)

- Don’t introduce Tokio unless threads/channels become genuinely painful.
- Don’t build a huge “widget framework” inside the crate.
- Don’t snapshot entire screen renders as tests; it’s brittle.
- Don’t assume Lace-only RPC methods exist (e.g. `ent/*`); gate them behind
  “method exists” checks if we add them later.
- Don’t add vim keys until the defaults are excellent and discoverable.

## Future (Explicitly Out of Scope for V1)

- File tree + diff viewer (amazing, but do it after v1 proves stable).
- Multiline editor, syntax highlighting, embedded pager.
- Multi-agent orchestration.
- JSON-lines debug mode (TUI can have a debug pane instead).
