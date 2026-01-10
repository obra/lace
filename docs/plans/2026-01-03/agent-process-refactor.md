# Agent Processes Refactor (Supervisor + Ent Protocol) — Flag-Day Implementation Plan

## Who This Is For

This plan is written for a skilled engineer who:

- Has **zero context** on Lace.
- Needs **very explicit** instructions about architecture, code locations, and
  testing.
- Will benefit from strong guardrails: **DRY**, **YAGNI**, **TDD**, and
  **frequent commits**.

This plan assumes you will implement the work in small PRs with clean review
points.

---

## One-Sentence Summary

Refactor Lace so **each agent session runs as its own standalone OS process**
speaking an **ACP-aligned JSON-RPC 2.0 protocol over stdio**, orchestrated by a
**supervisor** that powers the web UI; switch persistence to **agent-owned
JSONL** (flag day) and **remove the Tasks feature** for now.

Design spec: `docs/plans/2026-01-03/agent-process-refactor-spec.md`

---

## Goals (What “Done” Means)

1. **One process per agent conversation stream**
   - Protocol `sessionId` == one agent process.
   - No in-process agent mode.

2. **Supervisor as the only web backend**
   - `packages/web` talks to supervisor only.
   - Supervisor spawns agent processes, routes prompts, streams updates, and
     handles approvals UI.

3. **Agent owns execution + persistence**
   - Tools run inside agent processes (local/remote future-proofing).
   - History is agent-owned append-only **JSONL**; browsing history requires
     live connectivity.

4. **Subagents exist as background jobs**
   - Agent can spawn subagent processes.
   - Supervisor can observe full job streams without forcing parent-context
     ingestion.

5. **Flag-day removal**
   - No migration for old sessions.
   - Cut the Tasks feature (TaskManager + task tools + web routes/UI for tasks).
   - Remove SQLite-based thread/session/task persistence from runtime path.

---

## Non-Goals (Explicitly Out of Scope)

- Remote transport (HTTP/SSE) for agent protocol v1 (stdio only).
- Any migration tooling from SQLite to JSONL.
- Re-implementing Tasks. Jobs/subagents are sufficient for now.
- Multi-session per agent process.
- Interactive “subagent as full protocol peer” (v1 treats subagents as jobs).

---

## Implementation Order (Non-Negotiable)

This refactor has a lot of surface area. To avoid "random walk" implementation
and half-migrated systems, do the work in this order:

1. **Protocol + process foundation**
   - `@lace/ent-protocol` (NDJSON stdio + JSON-RPC peer)
   - `lace-agent` process that can `initialize`, `session/new`/`session/load`,
     `session/prompt`, stream `session/update`, and persist JSONL durable events
   - `@lace/supervisor` that spawns one agent process per `sessionId`

2. **Web cutover to supervisor**
   - `packages/web` talks only to supervisor (no direct `@lace/core` runtime
     objects in web runtime path)
   - Streaming updates + approvals UI are wired through supervisor

3. **ToolContext refactor (enable tools in agent process)**
   - Remove `context.agent` coupling in core tools by expanding `ToolContext`
     with explicit fields/callbacks
   - Make it possible to run the existing tool implementations inside
     `lace-agent`

4. **Real agent loop inside `lace-agent`**
   - Move from the deterministic “hello + run: …” stub to the real
     provider-driven loop (LLM → tools → approvals → continue)
   - Approvals must pause/resume correctly and survive agent restarts

5. **Provider/connection configuration APIs**
   - Implement the Ent `ent/providers/*`, `ent/connections/*`, `ent/models/*`
     surface so the supervisor/web can configure providers without owning
     credentials

6. **Jobs/subagents**
   - Implement `ent/job/*` and treat subagents as jobs (not protocol peers)

7. **Flag-day removals**
   - Remove Tasks and TaskManager integration
   - Remove SQLite/ThreadManager/Session runtime path once web/supervisor/agent
     are stable

If you’re tempted to skip ahead: don’t. This order exists to keep the system
runnable at each milestone.

---

## Key Docs (Read These First)

- Protocol spec: `docs/protocol-spec.md`
- Protocol rationale: `docs/about-the-protocol.md`
- Existing ThreadManager critique (historical context):
  `docs/plans/unexpose-thread-manager.md`
- Current architecture overview (historical context):
  `docs/plans/projects/projects-overview.md`

---

## Local Development Credentials (Read Before Running Anything Networked)

**Never put real API keys in docs, PRs, commit messages, screenshots, or test
fixtures.**

If you need to manually verify OpenAI integration during development, set an env
var locally:

```sh
export OPENAI_API_KEY="YOUR_KEY_HERE"
```

Guidance:

- Prefer keeping secrets in a local-only mechanism (`.envrc`, shell profile,
  password manager), not in tracked files.
- Automated tests MUST NOT require real credentials. Use fakes/mocks for unit
  tests and treat “real provider” runs as manual smoke tests.

If a secret ever lands in git history or documentation, treat it as compromised
and rotate it immediately.

---

## Glossary (Use These Terms Consistently)

- **Agent**: A single conversation stream with tools + provider + local
  execution (one OS process).
- **Protocol session**: The protocol’s `sessionId` (one agent conversation
  stream).
- **Supervisor**: Orchestrator process that spawns/monitors agent processes and
  serves the web UI.
- **Job**: Background execution unit emitted by an agent (`jobId`), including
  subagents and shells.
- **Durable events**: `ent/session/events` history (stable ordering via
  `eventSeq`).
- **Streaming updates**: `session/update` live updates (ordered via
  `streamSeq`).

---

## Repository Map (What Exists Today)

### Monorepo structure

- Core logic: `packages/core`
- Web app/server: `packages/web`

### “Old world” (to be removed)

- SQLite-based persistence:
  - `packages/core/src/persistence/database.ts`
  - `packages/core/src/threads/thread-manager.ts`
  - `packages/core/src/sessions/session.ts`
  - `packages/core/src/tasks/task-manager.ts` (also being cut)
- Web API routes coupled to core runtime:
  - Many `packages/web/app/routes/api.*.ts` import core Session/ThreadManager.

### “New world” packages to add

- Protocol library: `packages/ent-protocol`
- Agent process: `packages/agent` (binary: `lace-agent`)
- Supervisor process/library: `packages/supervisor` (binary optional:
  `lace-supervisor`)

---

## Target Architecture (End State)

```
packages/web (browser + server routes)
        |
        | (WebSocket/HTTP, supervisor-defined; NOT Ent)
        v
packages/supervisor
  - spawns N agent processes (1 per sessionId)
  - forwards prompts
  - renders/mediates approvals
  - streams updates to web
        |
        | (Ent protocol: JSON-RPC 2.0 / NDJSON over stdio)
        v
packages/agent  [one process per sessionId]
  - provider + tools + execution
  - JSONL durable history
  - spawns subagent processes (jobs)
        |
        | (also Ent over stdio)
        v
packages/agent (subagent) ... (jobs)
```

Important: **Supervisor never executes tools**. All tool execution (filesystem,
shell, network) happens in the agent process “world”.

---

## Testing Philosophy (Non-Negotiable)

### TDD rules for this project

1. **Write a failing test first** for every behavioral change (or update an
   existing failing test).
2. **Avoid mocks** of the behavior you are testing. Use small fakes only at
   process boundaries.
3. Prefer **narrow tests** (unit) before **wide tests** (integration).
4. **Commit after each passing test** (small commits, clear messages).

### How to run tests in this repo

- All tests:
  - `npm test`
- Core tests:
  - `npm run test --workspace=packages/core`
- Web tests:
  - `npm run test --workspace=packages/web`
- Typecheck:
  - `npm run typecheck`
- Lint:
  - `npm run lint`

---

## Definition of Done (Per Task)

For each task below, do not mark it done until:

- Tests added/updated and passing for the behavior changed.
- No unrelated refactors.
- Code is minimal (YAGNI) and reuse-first (DRY).
- A commit exists for the completed task.
- Any new user-visible behavior is documented (docs or inline API docs).

---

# Work Breakdown (Bite-Sized Tasks)

Each section is intended to become one PR or a small sequence of PRs. Keep PRs
small.

Important: follow the **Implementation Order (Non-Negotiable)** section above
when sequencing work. The PR numbering below is historical and is not a
substitute for that required ordering.

---

## PR1 — Create `@lace/ent-protocol` (shared protocol library)

### Task 1.1: Add package skeleton

- Touch:
  - `packages/ent-protocol/package.json` (build/test scripts consistent with
    repo)
  - `packages/ent-protocol/tsconfig.json`
  - `packages/ent-protocol/src/index.ts`
  - Root `package.json` (workspace already includes `packages/*`, so no change
    needed)
- Tests:
  - Add vitest config only if needed (prefer repo defaults; do not invent new
    tooling).
- Acceptance:
  - `npm run typecheck --workspace=packages/ent-protocol` works.

### Task 1.2: Implement NDJSON stdio transport (client + server)

- Implement:
  - A small stdio transport that:
    - Reads newline-delimited JSON from a stream.
    - Writes JSON-RPC objects as single-line JSON (no pretty-print).
    - Never writes logs to stdout.
- Touch:
  - `packages/ent-protocol/src/transport/stdio.ts`
  - `packages/ent-protocol/src/transport/types.ts`
  - `packages/ent-protocol/src/index.ts` exports
- Tests:
  - `packages/ent-protocol/src/transport/__tests__/stdio.test.ts`
    - Valid message parsing
    - Split chunks across reads
    - Reject non-JSON and missing `jsonrpc: "2.0"`
- Acceptance:
  - Can roundtrip a request/response in-process using fake streams.

### Task 1.3: Add protocol types + validators (zod)

- Implement:
  - TypeScript types and zod schemas for:
    - JSON-RPC Request/Response/Notification
    - Core methods: `initialize`, `session/new`, `session/load`, `session/list`,
      `session/prompt`, `session/cancel`, `session/set_mode`
    - Ent extensions: `ent/agent/ping`, `ent/agent/status`,
      `ent/session/events`, `ent/session/configure`, `ent/session/inject`,
      `ent/job/*`, `ent/providers/*`, `ent/connections/*`, `ent/models/*`
  - Keep schemas DRY: shared “id fields”, shared “ContentBlock”, shared
    “ToolResult”.
- Touch:
  - `packages/ent-protocol/src/types/*.ts`
  - `packages/ent-protocol/src/schemas/*.ts`
- Tests:
  - `packages/ent-protocol/src/schemas/__tests__/protocol-shapes.test.ts`
    - Validate representative examples from `docs/protocol-spec.md`.
- Acceptance:
  - Protocol examples from docs validate successfully.

---

## PR2 — Create `@lace/agent` process (protocol server, stub session)

### Task 2.1: Add agent package skeleton + entrypoint

- Touch:
  - `packages/agent/package.json` (expose a binary `lace-agent`)
  - `packages/agent/src/main.ts` (stdio JSON-RPC server bootstrap)
  - `packages/agent/src/server.ts` (method registry)
- Tests:
  - `packages/agent/src/__tests__/smoke.test.ts` that spawns the server
    in-process using streams.
- Acceptance:
  - `initialize` works and returns capabilities (can be minimal for now).

### Task 2.2: Implement on-disk session directories (no history yet)

- Decide a path:
  - Use `getLaceDir()` from `packages/core/src/config/lace-dir.ts` (reuse, don’t
    rewrite).
  - Store sessions under something like:
    `<laceDir>/agent-sessions/<sessionId>/`.
- Touch:
  - `packages/agent/src/storage/session-paths.ts`
  - `packages/agent/src/methods/session-new.ts`
  - `packages/agent/src/methods/session-list.ts`
  - `packages/agent/src/methods/session-load.ts`
- Tests:
  - `packages/agent/src/storage/__tests__/session-paths.test.ts`
  - `packages/agent/src/methods/__tests__/session-new-list-load.test.ts`
- Acceptance:
  - `session/new` creates a session folder and returns `sessionId`.
  - `session/list` enumerates sessions on disk.
  - `session/load` selects an existing session.

---

## PR3 — JSONL durable event store (flag-day replacement for SQLite history)

### Task 3.1: Implement durable event log writer/reader

- Implement:
  - Append-only `events.jsonl` with monotonically increasing `eventSeq`.
  - Reader supports:
    - `afterEventSeq` pagination
    - `types` filtering
    - stable ordering
- Touch:
  - `packages/agent/src/storage/event-log.ts`
  - `packages/agent/src/storage/event-types.ts`
  - `packages/agent/src/methods/ent-session-events.ts`
- Tests:
  - `packages/agent/src/storage/__tests__/event-log.test.ts`
    - append/replay
    - pagination
    - crash-safety (partial last line handling)
- Acceptance:
  - `ent/session/events` returns durable history matching the spec.

### Task 3.2: Persist minimal session state (pending permissions + counters)

- Implement:
  - A small `state.json` that stores:
    - last `eventSeq`
    - last `streamSeq` checkpoint (so stream ordering survives resume if we
      choose to persist it)
    - `pendingPermissions` durable reconstruction data
- Touch:
  - `packages/agent/src/storage/session-state.ts`
  - `packages/agent/src/methods/ent-agent-status.ts`
- Tests:
  - `packages/agent/src/storage/__tests__/session-state.test.ts`
- Acceptance:
  - Restarting the agent process allows `ent/agent/status` to expose pending
    approvals.

---

## PR4 — Implement core turn loop skeleton (`session/prompt` → streaming + durable)

### Task 4.1: `session/prompt` emits a minimal turn lifecycle

Before integrating the full LLM/tools stack, build a minimal, deterministic
loop:

- On `session/prompt`:
  - Write durable `turn_start`
  - Emit `session/update` `text_delta` (a short fixed message)
  - Write durable `message`
  - Write durable `turn_end`
  - Return `turnId`, `stopReason`, `usage` (fake numbers ok for now)

- Touch:
  - `packages/agent/src/methods/session-prompt.ts`
  - `packages/agent/src/streaming/update-emitter.ts`
- Tests:
  - `packages/agent/src/methods/__tests__/session-prompt-durable.test.ts`
    - ensures durable event guarantee
    - ensures streamSeq ordering
- Acceptance:
  - A protocol client can render a complete “turn” without providers/tools.

---

## PR4.5 — Refactor `ToolContext` (enable tools in agent process)

This is the critical mechanical refactor that makes “tools run in the agent
process” possible without smuggling dependencies via `context.agent`. Keep this
PR focused and heavily tested.

### Task 4.5.1: Expand `ToolContext` and remove `context.agent` dependencies

- Goal:
  - Tools and `ToolExecutor` must be runnable without a live `Agent` object.
  - All tool dependencies should be explicit fields/callbacks on `ToolContext`.
- Touch:
  - `packages/core/src/tools/types.ts` (expand `ToolContext`)
  - `packages/core/src/tools/executor.ts` (stop calling
    `context.agent.getFullSession()`)
  - `packages/core/src/tools/tool.ts` (stop calling
    `context.agent.hasFileBeenRead(...)`)
- Required `ToolContext` shape (minimum viable; keep it small):
  - `signal: AbortSignal`
  - `workingDirectory?: string`
  - `toolTempDir?: string`
  - `processEnv?: NodeJS.ProcessEnv`
  - `workspaceInfo?: ...` (existing)
  - `workspaceManager?: ...` (existing)
  - `hasFileBeenRead?: (path: string) => boolean` (agent-implemented, derived
    from its history)
- Tests:
  - Add a focused test proving that at least one existing tool (e.g.
    `file_read`) runs with a `ToolContext` that does **not** include `agent`.
  - Update/replace tests that currently pass `agent` through ToolContext.
- Acceptance:
  - `ToolExecutor.execute()` works without `context.agent` when given a complete
    explicit `ToolContext`.

### Task 4.5.2: Fix delegate/task-based tool dependencies (prep for Tasks removal)

- Touch:
  - `packages/core/src/tools/implementations/delegate.ts` (or whichever delegate
    implementation is live after Tasks removal)
  - Any task-manager tools that rely on `context.agent.threadId` (these will be
    removed later, but make the refactor safe and incremental)
- Tests:
  - Update only what’s required to keep the suite green. Avoid feature changes
    in this PR.

---

## PR5 — Provider configuration APIs in the agent (providerId/connectionId/modelId)

This is required so the supervisor/web can configure providers without owning
credentials.

### Task 5.1: Implement `ent/providers/list` (discover providers)

- Reuse:
  - `packages/core/src/providers/registry.ts`
- Touch:
  - `packages/agent/src/providers/provider-surface.ts`
  - `packages/agent/src/methods/ent-providers-list.ts`
- Tests:
  - `packages/agent/src/methods/__tests__/ent-providers-list.test.ts`
- Acceptance:
  - Returns stable `providerId` strings matching provider registry ids.

### Task 5.2: Implement `ent/connections/*` using existing ProviderInstanceManager

Map concepts:

- Protocol `connectionId` == current `providerInstanceId`
- Protocol `providerId` == current `catalogProviderId`

Re-use:

- `packages/core/src/providers/instance/manager.ts`

Touch:

- `packages/agent/src/methods/ent-connections-list.ts`
- `packages/agent/src/methods/ent-connections-upsert.ts`
- `packages/agent/src/methods/ent-connections-delete.ts`
- `packages/agent/src/methods/ent-connections-test.ts` (YAGNI: implement minimal
  “can we instantiate provider + ping model list”; do not overbuild)

Tests:

- `packages/agent/src/methods/__tests__/ent-connections-crud.test.ts`

Acceptance:

- Supports multiple connections for the same provider with different base URLs
  and/or credentials.

### Task 5.3: Implement `ent/connections/credentials/*` (api-key first)

YAGNI: implement only what we need for Lace’s UI now:

- `status` returns ready/missing/invalid
- `start` with `method: "api_key"` returns `needs_input` with one secret field
- `submit` persists credential material
- `clear` removes stored credential

Touch:

- `packages/agent/src/methods/ent-credentials-status.ts`
- `packages/agent/src/methods/ent-credentials-start.ts`
- `packages/agent/src/methods/ent-credentials-submit.ts`
- `packages/agent/src/methods/ent-credentials-clear.ts`

Tests:

- `packages/agent/src/methods/__tests__/ent-credentials-rotation.test.ts`
  - Rotating credentials for an existing `connectionId` replaces previous
    credentials.

Acceptance:

- “Assign new credentials to an existing endpoint” works (no forced new
  connectionId).

### Task 5.4: Implement `ent/models/list` (connection-scoped)

Touch:

- `packages/agent/src/methods/ent-models-list.ts`

Tests:

- `packages/agent/src/methods/__tests__/ent-models-list.test.ts`

Acceptance:

- Lists models for a given connectionId; returns `providerId`, `connectionId`,
  `models[]`.

---

## PR6 — Remove Tasks feature (core + web) (flag day)

This is a deletion PR. Keep it small and safe. Delete only what’s required.

### Task 6.1: Stop registering task tools in ToolExecutor

Touch:

- `packages/core/src/tools/executor.ts` (remove `Task*Tool` registrations)
- `packages/core/src/tools/implementations/task-manager/*` (delete if unused)

Tests:

- Update tool catalog tests:
  - `packages/core/src/tools/tool-catalog.test.ts`
  - Any tests that assume task tools exist must be updated or removed.

Acceptance:

- `ToolExecutor.getAllTools()` no longer includes task tools.

### Task 6.2: Delete TaskManager usage paths (delegate tool must no longer depend on tasks)

Current delegate depends on TaskManager:

- `packages/core/src/tools/implementations/delegate.ts`

Replace it with a **job/subagent** implementation later (PR8). For now:

- Make `delegate` return a clear “not implemented” ToolResult, or remove the
  tool entirely (choose one; do not invent a new abstraction).

Touch:

- `packages/core/src/tools/implementations/delegate.ts`

Tests:

- Update existing delegate tests accordingly.

Acceptance:

- Core builds/tests pass without TaskManager.

### Task 6.3: Remove web routes/UI for tasks

Touch (likely files; confirm by searching routes):

- `packages/web/app/routes/api.projects.$projectId.sessions.$sessionId.tasks*.ts`
- `packages/web/app/routes/api.sessions.$sessionId.*tasks*.ts` (if present)
- Any UI components that render tasks lists/panels.

Tests:

- Delete or rewrite tests under:
  - `packages/web/app/routes/__tests__/...tasks...`

Acceptance:

- Web builds/tests pass with tasks removed.

---

## PR7 — Integrate real agent loop (providers + tools) into `lace-agent`

This is the core refactor: make `lace-agent` run the actual tool-using agent.

### Task 7.1: Refactor `@lace/core` Agent to remove ThreadManager/Session coupling (flag day)

**Note (2026-01-04)**: Deferred. The current `@lace/agent` runtime owns the
provider/tool loop and durable JSONL history without using `@lace/core`'s
`Agent`. After we fully migrate to the new agent package, revisit this task and
decide whether the `@lace/core` Agent/ThreadManager/Session stack should be
refactored or deleted.

Today `Agent` is tightly coupled:

- `packages/core/src/agents/agent.ts` imports/uses:
  - `ThreadManager` (`packages/core/src/threads/thread-manager.ts`)
  - `Session` (`packages/core/src/sessions/session.ts`)
  - Thread event persistence + approval state via ThreadManager

We want `lace-agent` to own history via JSONL, so:

- Replace ThreadManager dependency with a minimal “event sink/source” owned by
  `@lace/agent`.
- Do not create a large new framework. Keep it to the smallest interface needed
  by `Agent`.

Touch:

- `packages/core/src/agents/agent.ts`
- Add a tiny interface type:
  - `packages/core/src/agents/event-store.ts` (or similar)
- Remove references to:
  - `packages/core/src/sessions/session.ts` (Agent should not know about
    multi-agent sessions)

Tests:

- Add new focused tests for the new interface boundary:
  - `packages/core/src/agents/__tests__/agent-event-store.test.ts`
- Update existing agent tests that construct ThreadManager/Session.

Acceptance:

- `Agent` can run with an in-memory event store (for tests) and with JSONL store
  (in `@lace/agent`).

### Task 7.2: Hook ToolExecutor approvals to protocol permission requests

Implement in `@lace/agent`:

- When tool execution requires permission, emit:
  - `session/update` `tool_use` with `status: "awaiting_permission"`
  - JSON-RPC request `session/request_permission`
- Pause execution until response arrives.

Touch:

- `packages/agent/src/approvals/permission-manager.ts`
- `packages/agent/src/methods/session-request-permission.ts` (server-side
  plumbing)
- `packages/agent/src/methods/session-prompt.ts` (to pause/resume)

Tests:

- `packages/agent/src/approvals/__tests__/pause-resume.test.ts`
  - verify pause semantics
  - verify persistence to pendingPermissions and invalidation on cancel

Acceptance:

- Approval requests survive agent restart (via JSONL/state).

### Task 7.3: Execute real tools in agent process

Use existing tool implementations:

- `packages/core/src/tools/implementations/*` (file read/edit/write, bash,
  search, url_fetch)

Touch:

- `packages/agent/src/runtime/tooling.ts` (construct ToolExecutor + register
  tools)
- `packages/agent/src/runtime/agent-runtime.ts` (construct core Agent with
  providers/tools)

Tests:

- `packages/agent/src/runtime/__tests__/tool-smoke.test.ts`
  - run a read-only tool without approval
  - run a write tool with approval required (pause/resume)

Acceptance:

- Real tool execution works end-to-end in `lace-agent`.

### Task 7.4: Implement `ent/session/compact` using the existing compaction system (port)

We already have a compaction infrastructure in `@lace/core`:

- `packages/core/src/threads/compaction/types.ts`
- `packages/core/src/threads/compaction/registry.ts`
- `packages/core/src/threads/compaction/trim-tool-results-strategy.ts`
- `packages/core/src/threads/compaction/summarize-strategy.ts`

Re-use/port this into `@lace/agent` so `ent/session/compact` is not a one-off
bespoke implementation.

Touch:

- `packages/agent/src/compaction/*` (new, small)
- `packages/agent/src/server.ts` (`ent/session/compact` should delegate to
  strategies)

Tests:

- Prefer E2E: drive `session/prompt` → `ent/session/compact` → `session/prompt`
  and assert provider context shrinks without losing essential state.

Acceptance:

- Supports at least `trim-tool-results` and `summarize`-style compaction,
  aligned with core behavior.

### Task 7.5: Audit `@lace/agent` for duplicated “from scratch” implementations

Before writing new infrastructure in `@lace/agent`, check for existing
implementations in `@lace/core` and port/reuse where appropriate.

Initial audit targets:

- Compaction (above)
- Shell execution (`packages/core/src/tools/implementations/bash.ts` vs
  `packages/agent/src/tools/shell-exec.ts`)
- Turn loop / token management behavior (`packages/core/src/agents/agent.ts`)

Known duplicates (as of 2026-01-04):

- `ent/session/compact` in `packages/agent/src/server.ts` is currently an ad-hoc
  implementation (local summarization + message dropping) and should be replaced
  by ported strategies.
- `summarizeProviderMessages()` in `packages/agent/src/server.ts` duplicates
  core summarization behavior and does not use the provider.
- Shell tool execution should use core `bash` (do not add a second bespoke shell
  tool in `@lace/agent`).
- Connection config validation in `packages/agent/src/server.ts`
  (`getEndpointFromConfig`, credential-key checks) overlaps with core provider
  instance schemas; keep these consistent rather than drifting.

---

## PR8 — Subagents as jobs (no Tasks)

### Task 8.1: Implement `ent/job/*` in `lace-agent`

Implement:

- `ent/job/list`
- `ent/job/output` (with `tailBytes`/`afterOffset`)
- `ent/job/kill`
- `ent/job/inject`

Touch:

- `packages/agent/src/jobs/job-manager.ts`
- `packages/agent/src/methods/ent-job-*.ts`
- `packages/agent/src/streaming/update-emitter.ts` (to emit job\_\* +
  job_update)

Tests:

- `packages/agent/src/jobs/__tests__/job-lifecycle.test.ts`
  - create job, stream updates, finish, output retrieval

Acceptance:

- Job API matches spec and is sufficient for supervisor recovery.

### Task 8.2: Replace `delegate` tool to spawn subagent processes (jobs)

Implement `delegate` as:

- Spawn child `lace-agent` processes.
- Forward child updates as flattened `job_update` with `parentJobId`.
- Parent incorporates only `report` into its LLM context (not full stream).

Touch:

- `packages/agent/src/jobs/subagent-spawner.ts`
- `packages/core/src/tools/implementations/delegate.ts` (or move delegate into
  agent package if that’s cleaner; pick one and keep it simple)

Tests:

- `packages/agent/src/jobs/__tests__/nested-subagents.test.ts`
  - ensure nested jobs flatten with correct `parentJobId`

Acceptance:

- Supervisor can observe full subagent stream; parent doesn’t bloat its own
  context.

---

## PR9 — Create `@lace/supervisor` and cut over web backend

### Task 9.1: Implement supervisor process manager + Ent client

Supervisor responsibilities:

- Spawn one `lace-agent` per `sessionId`.
- Maintain a mapping: workspaceSession → sessionIds (grouping is
  supervisor-owned).
- Persist only supervisor-level metadata (not agent history).

Touch:

- `packages/supervisor/src/process/agent-process.ts`
- `packages/supervisor/src/ent/ent-client.ts` (uses `@lace/ent-protocol`)
- `packages/supervisor/src/sessions/workspace-sessions.ts`

Tests:

- `packages/supervisor/src/__tests__/spawn-and-prompt.test.ts`
  - spawn agent, initialize, session/new, prompt, receive updates

Acceptance:

- Supervisor can manage multiple agents concurrently.

### Task 9.2: Provide supervisor <-> web transport (WebSocket recommended)

YAGNI: implement only what the current UI needs:

- list/create workspaceSessions
- list/create agent sessions
- send prompt
- receive updates
- approve/deny tool permission requests

Touch:

- `packages/supervisor/src/http/server.ts` (or ws server)
- `packages/web/server/*` integration layer (replace direct @lace/core usage)

Tests:

- `packages/web/lib/server/*` tests updated to talk to supervisor.

Acceptance:

- Web uses supervisor only; no direct agent protocol in the browser.

---

## PR10 — Delete SQLite + ThreadManager + Session runtime (flag day)

This is a removal PR after web/supervisor are stable.

### Task 10.1: Remove runtime dependencies on SQLite persistence

Touch/remove:

- `packages/core/src/persistence/*` (if unused)
- `packages/core/src/threads/*`
- `packages/core/src/sessions/session.ts`
- Remove `better-sqlite3` where it’s no longer needed.

Tests:

- Delete/update tests that assume SQLite storage.
- Ensure agent JSONL tests cover replay correctness.

Acceptance:

- Running the web + supervisor + agent does not require SQLite.

---

## Final Validation Checklist (Before Merging the Whole Refactor)

- Start supervisor + web, create a new agent session, send a prompt, see
  streaming text.
- Run a tool requiring approval; ensure UI shows prompt; approve; tool executes.
- Restart supervisor while agent runs:
  - supervisor reconnects and can fetch history and pending approvals.
- Spawn a subagent job and verify:
  - supervisor sees job stream
  - parent agent only consumes report
- Verify tasks UI/routes are removed and nothing references TaskManager.
