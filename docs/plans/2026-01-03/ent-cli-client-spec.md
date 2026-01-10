# Ent Protocol CLI Client (REPL) — Implementation Spec

## One-Sentence Summary

Build a small, scriptable CLI client that can drive **any**
Ent-protocol-speaking agent over **NDJSON JSON-RPC over stdio**, with a
line-based **REPL** and interactive **permission prompting** (no curses/TUI).

## Goals

- Provide a **simple but functional** way to drive a single agent process from a
  terminal.
- Work with **Lace agent** (`lace-agent`) and **non-Lace agents** that implement
  the Ent protocol.
- Be **easy to automate** with tools like `expect`:
  - Stable prompts
  - Predictable, line-oriented output
  - No screen re-rendering / cursor control / curses
- Support interactive tool permission requests via `session/request_permission`:
  - show request details
  - prompt user to select an option
  - optionally provide `updatedInput`

## Non-Goals

- No TUI / curses / “full screen” UI.
- No web backend integration.
- No protocol server implementation.
- No remote transport (HTTP/WebSocket) in v1; stdio only.
- No sophisticated JSON editing UX (no embedded editor, no fancy forms).

## Package & Binary

Create a new package:

- Package: `packages/cli`
- NPM name: `@lace/cli`
- Binary: `lace` (or `lace-cli` if `lace` conflicts in your environment)

Key dependency:

- `@lace/ent-protocol` (use the shared `JsonRpcPeer` +
  `createNdjsonStdioTransport`)

## Transport Model (v1)

The CLI MUST support two ways to talk to an agent:

1. **Spawn mode (default)**:
   - Spawns a child process (default: `node <repo>/packages/agent/dist/main.js`
     or `lace-agent` if on PATH)
   - Uses child `stdin/stdout` as the JSON-RPC transport
2. **Attach mode**:
   - Still stdio-based, but uses a user-provided command (e.g.,
     `ssh host lace-agent --stdio`)
   - The CLI treats it the same as spawn mode: a subprocess with stdio pipes

Notes:

- The CLI MUST NOT write logs to the agent’s stdin/stdout stream.
- Any debug logs MUST go to stderr.

## SessionId Handling (Critical)

Because we will support non-Lace agents:

- Treat `sessionId` as **opaque**.
- Do not assume any prefix (`lace_`, `sess_`, UUID, etc.).
- The only validation performed MUST use the shared validator:
  - `@lace/ent-protocol` `SessionIdSchema` / `isSessionId` / `asSessionId`

The CLI MUST NOT import `ThreadId` validation from `@lace/core`.

## Core Protocol Flow

On startup, the CLI:

1. Spawns/attaches to agent process.
2. Sends `initialize` (configurable; see “Config”).
3. Either:
   - `session/new { workDir }` (if `--new`), OR
   - `session/load { sessionId }` (if `--load <id>`), OR
   - enters REPL with “no active session” and requires `:new`/`:load`.

During the session, the CLI must:

- Handle agent → client notifications/requests:
  - `session/update` (request/notification depending on implementation; Lace
    currently uses request handler in supervisor)
  - `session/request_permission` (request; must reply)

## REPL UX Requirements

### Prompts

Prompts MUST be stable and easily matchable:

- Primary prompt: `lace> `
- Permission prompt: `permission> `

No ANSI cursor movement. Color output is optional and MUST be disable-able with
`--no-color`.

### Input Grammar

- Lines starting with `:` are commands.
- Any other non-empty line is treated as a prompt to the agent (a single
  `ContentBlock { type: "text" }`).
- Empty line does nothing.

### Minimal Commands

Required commands (v1):

- `:help` — print commands.
- `:exit` — exit with code 0.
- `:status` — show current connection + active sessionId (if any).
- `:new [workDir]` — create a new session (default workDir: current directory).
- `:load <sessionId>` — load an existing session.
- `:list` — calls `session/list` (optionally filtered by workDir).
- `:prompt <text>` — send a prompt explicitly (same as typing a line, but allows
  empty text).
- `:cancel` — send `session/cancel`.
- `:raw <json>` — send a raw JSON-RPC request/notification for debugging.

Optional but recommended (still line-based):

- `:events [afterEventSeq] [limit]` — calls `ent/session/events`.
- `:jobs` — calls `ent/job/list`.
- `:job-output <jobId> [tailBytes]` — calls `ent/job/output`.

## Output Format (Scriptable by Default)

The CLI MUST provide a deterministic, line-based output format.

Two modes:

1. **Human mode (default)**:
   - Print session updates as compact, readable single lines.
   - Print results/errors as single-line summaries plus optional `--verbose`
     JSON.

2. **JSON lines mode (`--json`)**:
   - Every inbound/outbound message is written as exactly one JSON object per
     line.
   - No extra decoration.

Suggested JSONL shapes:

```json
{"direction":"out","kind":"request","method":"session/prompt","id":"c_1","params":{...}}
{"direction":"in","kind":"response","id":"c_1","result":{...}}
{"direction":"in","kind":"request","method":"session/update","params":{...}}
{"direction":"in","kind":"request","method":"session/request_permission","id":"a_1","params":{...}}
{"direction":"out","kind":"response","id":"a_1","result":{"decision":"allow"}}
```

In JSON mode:

- Logs must go to stderr (or be disabled).
- Stdout must be only JSON lines.

## Permission Handling

When the agent sends `session/request_permission`:

1. Print a summary:
   - `tool`, `kind`, `resource`, `toolCallId`, `turnId`, `turnSeq`, optional
     `jobId`
   - list options with `optionId` + `label`
2. Prompt for a decision:
   - User enters an `optionId` (e.g., `allow`, `deny`, `allow_session`,
     `allow_always`)
3. Optional updated input:
   - If user enters `edit`, then CLI prompts:
     - `updatedInput (JSON, blank for none)> `
   - Parse JSON object; on failure, reprompt.
4. Respond with:

```json
{ "decision": "<optionId>", "updatedInput": { ... } }
```

Constraints:

- Do not invent decisions; the CLI should prefer to choose from the
  agent-provided `options[]`.
- Provide `deny` as a fallback only if present in `options[]`; otherwise require
  explicit selection.

## Config / Flags

Required flags:

- `--agent-cmd "<command>"` (default: `lace-agent` if available, else Node path
  to built `packages/agent/dist/main.js`)
- `--workdir <path>` (default: `process.cwd()`)
- `--new` (start with `session/new`)
- `--load <sessionId>` (start with `session/load`)
- `--json` (JSONL output mode)
- `--no-color`

Recommended flags:

- `--approval-mode <ask|approveReads|approveEdits|approve|deny|dangerouslySkipPermissions>`
  - Used only for `initialize { config: { approvalMode } }` when talking to Lace
    agent.
  - Non-Lace agents may ignore; that’s OK.
- `--timeout-ms <n>` for request timeouts (client-side).

## Implementation Notes (TypeScript / Node)

- Use Node 20+.
- Use `readline` for the REPL.
- Use `@lace/ent-protocol`:
  - `createNdjsonStdioTransport({ readable, writable })`
  - `new JsonRpcPeer(transport, { idPrefix: "c_" })`
- Handle `session/update` via `peer.onRequest('session/update', ...)` and return
  `undefined`.
- Handle `session/request_permission` via
  `peer.onRequest('session/request_permission', ...)` and return
  `{ decision, updatedInput? }`.
- Ensure concurrent output from async updates does not corrupt prompts:
  - Always print updates on their own line.
  - Re-print the active prompt after handling an async update if in TTY mode.

## Acceptance Tests (Manual)

Manual acceptance checklist (no TUI):

1. Run `lace` and `:new`.
2. Type `job: echo hi` and see job updates.
3. Trigger a permissioned tool use (write) and verify interactive approval
   works.
4. Run with `--json` and verify stdout is valid JSONL (one JSON object per
   line).
5. Drive a full flow via `expect` (send prompt, approve, see completion).

## Repo Integration Notes

- The CLI package should be able to run against a built agent:
  - `npm run build --workspace=packages/agent`
  - `npm run dev --workspace=packages/cli` (or similar)
