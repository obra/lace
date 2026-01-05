# Agent Processes Refactor (Supervisor + Ent Protocol) — Comprehensive Spec

## Purpose

This spec describes the **intended architecture, semantics, and boundaries** for refactoring Lace so that:
- **Each agent session runs as a standalone OS process**.
- A **supervisor** orchestrates agent processes and powers the web UI.
- Agents and supervisors communicate using the **Ent protocol** (ACP-aligned JSON-RPC 2.0 over NDJSON stdio).
- Agents own execution (tools/providers) and durable history (**JSONL**).
- The legacy SQLite/ThreadManager/Session/Tasks world is removed (**flag day**, no migration).

This document is intentionally design-focused. The step-by-step “what to change, where, and how to test” lives in:
- Implementation plan: `docs/plans/2026-01-03/agent-process-refactor.md`
- Protocol: `docs/protocol-spec.md` and `docs/about-the-protocol.md`

---

## Background (Why We Are Doing This)

Lace currently mixes concerns across a single in-process runtime:
- multi-agent coordination
- web backend concerns
- persistence (SQLite event sourcing)
- provider instance/credential management
- tool execution and approvals

This makes composition and reuse difficult. The new architecture isolates concerns behind a stable protocol boundary:
- The **agent process** becomes a reusable unit that can be embedded in different products.
- The **supervisor** becomes the orchestration/UI adapter (web today; other clients later).
- The **protocol** becomes a contract enabling local stdio agents now, and remote agents later, without changing the supervisor/web model.

Key strategic intent:
- Treat **agent + tools + provider config** as a portable unit.
- Enable **multiple agents** without shared-memory coupling.
- Make subagents behave like **async jobs** (like subprocesses), while preserving observability and approvals.

---

## Principles (Non-Negotiable)

1. **One process = one protocol session**
   - A process handles exactly one active `sessionId`.
   - Concurrency is achieved by spawning multiple processes.

2. **Agent-centric execution**
   - The agent executes filesystem, shell, search, network, MCP tools locally.
   - The supervisor never executes tools on behalf of the agent.

3. **Supervisor is UI-facing, not agent-facing**
   - The browser does not speak Ent.
   - The supervisor speaks Ent and presents a web-friendly API/WS stream to the browser.

4. **Durable history is agent-owned JSONL**
   - Durable state is in the agent’s on-disk session log.
   - Supervisor does not own or replicate durable agent history.
   - Browsing history requires **live connectivity** to an agent process (via supervisor).

5. **Approvals are first-class and pausable**
   - Agents can pause awaiting approval.
   - Pending approvals persist across agent restarts and are discoverable via protocol.

6. **Subagents are jobs (not peers) in v1**
   - Supervisors cannot `session/prompt` a subagent directly.
   - Supervisors can observe job streams and inject context into a job via `ent/job/inject`.

7. **DRY + YAGNI**
   - Do not invent new abstractions unless forced by tests.
   - Prefer extending existing primitives (notably `ToolContext`) over layering a new framework.

---

## Glossary

- **Protocol session**: `sessionId`, one conversation stream, one agent process.
- **WorkspaceSession**: supervisor-owned grouping of one or more protocol sessions (outside the protocol).
- **Durable events**: returned by `ent/session/events` (ordered by `eventSeq`).
- **Streaming updates**: emitted via `session/update` (ordered by `streamSeq`).
- **Job**: background activity with `jobId` (shell or subagent), visible via `job_*` updates and `ent/job/*`.

---

## Protocol Contract (What We Rely On)

This spec does not restate the full protocol; it defines which parts are **architecturally load-bearing**.
All wire shapes come from `docs/protocol-spec.md`.

### Load-bearing semantics

- `initialize` is called once per process.
- `session/new` or `session/load` establishes the active session within the process.
- `session/prompt` runs a turn and returns when the turn completes.
- `session/update` provides streaming updates during a turn and for background jobs.
- `session/request_permission` is a JSON-RPC request (not notification); the agent pauses until a response arrives.
- `ent/session/events` provides durable replay for supervisor reconnect/state rebuild.
- `ent/agent/status` provides current state including pending approvals (reconnection).
- `ent/job/*` provides background job visibility and authoritative results.

### Ordering and replay

- **Global ordering for live updates** uses `streamSeq`.
- **Durable replay ordering** uses `eventSeq`.
- A successful `session/prompt` implies the turn’s durable events exist (durable event guarantee).

### Identifier consistency

- `toolUseId` (ContentBlock) and `toolCallId` (updates + permission) are the same identifier.
- `toolCallId` must be globally unique across the session and all jobs/subagents.

### Nested jobs

- Jobs may spawn jobs. This is represented using flattened top-level job events plus `parentJobId`.

---

## Packages and Responsibilities (API Boundaries)

### `@lace/ent-protocol`

Responsibilities:
- NDJSON stdio framing/parsing.
- JSON-RPC 2.0 client/server utilities.
- Runtime validation (schemas) for protocol messages.
- Shared types used by agent and supervisor (single source of truth).

Non-responsibilities:
- Does not know about providers/tools.
- Does not implement persistence.

Public API (conceptual):
- `createStdioServerTransport()`, `createStdioClientTransport()`
- `createRpcServer({ methods })`, `createRpcClient({ transport })`
- `schemas` + `types` for every method and update.

### `@lace/agent` (binary: `lace-agent`)

Responsibilities:
- Implements Ent protocol server over stdin/stdout.
- Owns:
  - provider selection/config (`providerId`, `connectionId`, `modelId`)
  - credentials storage and rotation (connection-scoped)
  - tool execution and approvals
  - durable session history (JSONL)
  - job/subagent spawning and forwarding

Non-responsibilities:
- Does not serve HTTP for the browser.
- Does not persist supervisor-level workspace grouping.

### `@lace/supervisor`

Responsibilities:
- Spawns and supervises agent processes (1 per sessionId).
- Routes user prompts and streams `session/update` to web clients.
- Maintains workspaceSession grouping and minimal metadata storage.
- Owns approval UX state and routes approval decisions back to agents.

Non-responsibilities:
- Does not execute tools.
- Does not read/write agent JSONL logs directly.

### `packages/web`

Responsibilities:
- Browser UI + server routes that communicate only with the supervisor.
- Displays streaming updates and approval prompts.
- Provides UI for configuring provider connections/models via supervisor → agent protocol calls.

Non-responsibilities:
- Must not import core runtime classes for execution (no `Session.create()` or `ThreadManager()` runtime path).
- Must not speak Ent directly from the browser.

---

## Persistence Spec (Flag Day)

### Agent session storage

Each agent process persists its session under a stable session directory.

Recommended layout (exact file names can vary, but semantics must match):

```
<laceDir>/agent-sessions/<sessionId>/
  events.jsonl        # durable event stream (ent/session/events)
  state.json          # small persisted counters + config (NOT source-of-truth for permissions)
  jobs/
    <jobId>.log       # optional output spool (for ent/job/output offsets/tail)
    <jobId>.json      # optional job metadata (status, parentJobId, etc.)
  files/              # optional: file checkpointing snapshots (if implemented)
```

### Durable events (`events.jsonl`)

Properties:
- Append-only.
- Each record includes:
  - `eventSeq` (monotonic integer)
  - `timestamp`
  - `type`
  - `turnId` (when applicable)
  - `turnSeq` (when applicable)
  - type-specific `data`

Requirements:
- `ent/session/events` must page by `afterEventSeq` and return stable ordering.
- Events must not contain secrets (credential material, tokens, etc.).

### Permission durability

Requirements:
- Permission requests and permission decisions MUST be written to `events.jsonl` (e.g. `permission_requested`, `permission_decided`, `permission_cancelled`).
- `ent/agent/status.pendingPermissions` MUST be derived from durable events (not stored as source-of-truth in `state.json`).
- On agent restart, pending permission prompts MUST be reissued to the client (new JSON-RPC request ids) so the client can respond.

### Job output spooling

Requirements:
- `ent/job/output` must support:
  - full output (small jobs)
  - `tailBytes` (avoid returning huge output)
  - `afterOffset` + `outputMeta` (incremental fetch)
- Implementations may choose:
  - in-memory buffer for small output + spill to file beyond threshold, or
  - always spool to file.

---

## Runtime Semantics (Agent)

### Turn lifecycle

For each `session/prompt`:
- Generate a `turnId`.
- Emit durable `turn_start` event.
- Stream updates via `session/update` during the turn:
  - text deltas (`text_delta`)
  - tool lifecycle (`tool_use`)
  - usage (`usage`)
- Emit durable `message` events for finalized assistant messages (not deltas).
- Emit durable `turn_end`.
- Return final response when turn completes.

### Tools and approvals

Tool execution must:
- Emit `tool_use` with `status: "pending"` then `"running"` then terminal.
- If approval required:
  - Emit `tool_use` with `status: "awaiting_permission"`.
  - Send `session/request_permission` request.
  - Pause execution until response/cancel/timeout.
- Persist permission requests/decisions as durable events so that after restart `ent/agent/status.pendingPermissions` is correct.

Cancellation:
- `session/cancel` must:
  - stop the turn or tool execution
  - mark awaiting tool uses as `cancelled`
  - invalidate pending permissions for those tool calls

### Provider/connection/model selection

Selection is agent-scoped:
- Active `providerId/connectionId/modelId` belong to the agent session.
- Supervisor drives configuration via protocol methods; agent owns secrets and persistent config.

Connection invariants:
- `connectionId` is permanently paired to exactly one `providerId`.
- Credentials are mutable (rotate credentials for existing `connectionId`).

---

## Runtime Semantics (Jobs/Subagents)

### Job representation

Jobs are visible to the supervisor via:
- `job_started`, `job_update`, `job_finished` streaming updates.
- `ent/job/list` and `ent/job/output` for authoritative state/output.

### Subagent execution model

Subagents are jobs implemented by spawning child `lace-agent` processes.

Constraints:
- Subagents are **not protocol peers** from the supervisor’s perspective.
- All subagent updates are forwarded by the parent agent using `job_update`.
- Parents should only incorporate subagent **reports** into their own LLM context.
- Supervisor may inject context into a job via `ent/job/inject` (best-effort).

Nested subagents:
- If a subagent spawns subagents, the top-level agent must forward descendant jobs as flattened top-level job events, linked with `parentJobId`.

---

## Supervisor Spec

### Process model

Supervisor spawns agents as child processes with stdio pipes.

Requirements:
- One agent process per protocol session.
- Supervisor owns process lifecycle. In v1, do not attempt to “reattach” to orphaned agent processes after supervisor restart.
- Supervisor must be able to:
  - create new sessions (spawn agent → `initialize` → `session/new`)
  - load existing sessions (spawn agent → `initialize` → `session/load`)
  - stream updates to web clients
  - request durable history on reconnect (via `ent/session/events`)
  - restore pending approvals (via `ent/agent/status`)

### WorkspaceSession storage

The protocol explicitly does not define “workspace sessions”. Supervisor must define a minimal store:
- `workspaceSessionId` (opaque)
- `workDir` (string)
- list of `sessionId`s (agents)
- timestamps (created/lastUsed)

Important: multiple workspaceSessions may share the same `workDir`.

Storage format is intentionally simple (YAGNI):
- A small JSON file under `<laceDir>/supervisor/` is sufficient.
- Do not introduce a new database.

### Web-facing API

Supervisor must expose a web-friendly surface (HTTP + WS or SSE) that:
- creates/loads workspace sessions
- creates/loads agent sessions
- forwards prompts
- streams updates
- surfaces pending approvals and routes approval decisions
- surfaces provider connection management UI operations (list providers, list connections, start/submit credentials, list models, apply session config)

Exact endpoint shapes are an implementation detail, but web must not import and execute core runtime objects directly.

---

## Feature Removal: Tasks (Flag Day)

We remove the Tasks feature entirely for now:
- No TaskManager persistence.
- No task CRUD tools.
- No task UI/routes.

We keep:
- Subagents (as jobs).
- Planning UI (via `session/update` `plan` updates) if/when the agent emits them.

This is intentional YAGNI:
- Jobs + approvals + history are required for the agent-process architecture.
- Tasks are not required to validate the architecture.

---

## Testing Spec (What Must Be Proven)

This section defines what correctness means; see the implementation plan for file-level test instructions.

### Protocol conformance tests

Prove:
- `@lace/ent-protocol` validates and roundtrips canonical examples.
- Stdio framing handles chunking and backpressure safely.

### Agent durability tests

Prove:
- Durable event guarantee for `session/prompt`.
- `ent/session/events` replay reconstructs a complete conversation.
- Pending approvals survive restart and can be resolved post-restart.

### Approval pause tests

Prove:
- tool pauses on `session/request_permission`
- resume executes tool exactly once (idempotency)
- cancellation invalidates pending approvals

### Job/subagent tests

Prove:
- job lifecycle events are emitted
- `ent/job/output` supports tail/offset correctly
- nested jobs flatten with correct `parentJobId`

### Web/supervisor integration tests

Prove:
- web → supervisor → agent prompt roundtrip
- approvals show in web and resolve correctly
- web reconnect restores state via supervisor replay

---

## Security Requirements

- Agent stdout is protocol-only. Logs go to stderr.
- Secrets:
  - Credentials are never emitted in streaming updates or durable events.
  - Credentials are never written to docs, test fixtures, or logs.
- Supervisor never stores credential material.
- No offline history mirroring: history requires live connectivity to the agent.

---

## Rollout Notes (Flag Day)

Because we are doing a flag-day cutover:
- Old SQLite sessions/projects/tasks are not migrated.
- The UI should clearly reflect that existing sessions are not available after upgrade (or simply start fresh).
- Keep the PR sequence small and reviewable; don’t land a single mega-PR.

---

## Cross-References

- Implementation tasks: `docs/plans/2026-01-03/agent-process-refactor.md`
- Protocol contract: `docs/protocol-spec.md`
- Protocol rationale: `docs/about-the-protocol.md`
