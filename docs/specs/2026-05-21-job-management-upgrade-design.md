# Job Management Upgrade for Lace (PRI-1692)

## Why

On 2026-05-20, during the PRI-1673 Phase 7 retrofit, Ada (sen v2's main
persona, running on lace) delegated a task to a backgrounded shell subagent
and then sat in a `job_output(jobId, block=true, timeoutMs=...)` loop for
8+ minutes — roughly 22 Anthropic API turns, each one full-fat with system
prompt, conversation history, and every tool definition. The subagent had
hung; Ada had no way to know that without re-asking. Worse, while she was
trapped in the loop she was unresponsive to anything else: a Slack message
from her user would have queued behind 30k tokens of useless polling.

PRI-1691 fixes the lockup (mid-turn message injection so a user message
preempts a polling tool). PRI-1692 is the other half: give Ada — and every
agent that uses lace's job tools — a way to *not poll in the first place*.
The cost ratio between a wake-up notification (~500 tokens) and a polling
loop (~30k tokens for an idle observation) is ~50×, and the polling loop
brings the parent's conversation to a halt for as long as it runs.

The change is not just a new tool. It's a re-think of lace's job surface
so that the cheap, async, event-driven path is the obvious one, the
existing-but-undocumented notification queue is exposed, and the
operational discipline from production agent harnesses (Claude Code's
`Monitor`, serf's `wait`/`communicate`) carries over.

## Current state in lace

### The four job tools today

All four live in
`packages/agent/src/tools/implementations/`:

- **`delegate.ts`** (207 lines) — spawn a subagent. Sync by default (blocks
  the parent's tool execution until the subagent's `completion` promise
  resolves; output prefixed with `delegate jobId=<id>`).
  `background=true` returns `{ jobId, status: "started" }` immediately.
  `resume=<jobId>` continues a prior subagent session. Optional
  `persona`, `modelId`, `connectionId`, and `progressIntervalMs` (min
  5_000ms, max 600_000ms).
- **`job_output.ts`** (81 lines) — fetch status + stdout of a job.
  `block=true` (default) waits up to `timeoutMs` (default 30_000ms, max
  600_000ms) for the job to complete. `byteOffset` is declared in the
  schema but the implementation ignores it (`packages/agent/src/tools/implementations/job_output.ts:13`) — the
  full output is always returned. Returns `{ status, output, exitCode? }`.
- **`job_kill.ts`** (64 lines) — cancel a running job; subagent sessions
  are preserved for `delegate(resume=...)`.
- **`jobs_list.ts`** (74 lines) — list jobs in the session, filterable by
  status / type, default limit 50.

### Job lifecycle, persistence, and notifications

The runtime is more sophisticated than the tool surface suggests:

- **`packages/agent/src/jobs/job-manager.ts`** is the session-scoped service.
  Jobs are created with `createJob('shell' | 'delegate', opts)`
  (`job-manager.ts:343`), persisted as `job_started` / `job_session_assigned`
  / `job_finished` events in `events.jsonl`, and reconstructed by
  `listJobs()` from that log (`job-manager.ts:98`). In-memory state for
  *running* jobs lives in `this.jobs: Map<string, JobState>`. The cache
  invalidates on file size / mtime change. Concurrent-jobs cap:
  `MAX_CONCURRENT_JOBS` (`server-types.ts`).
- **`packages/agent/src/jobs/subagent-job.ts`** (828 lines) actually
  spawns the child `lace-agent` process and talks JSON-RPC over stdio via
  `@lace/ent-protocol`. The subagent's stdout/stderr stream into a job
  log file (`getJobOutputPath`). The child is reachable as a
  `JsonRpcPeer` (`childPeer`) and can be cancelled cleanly.
- **`packages/agent/src/jobs/job-notifications.ts`** is the *already-exists*
  notification pipeline. `createQueueJobNotification` (`job-notifications.ts:27`)
  pushes a `PendingJobNotification` onto a per-session queue. If the agent
  is idle (`!state.activeTurn`), it triggers an internal turn via
  `runPromptInternalRef.current([])` to consume the queue right away. If
  the agent is mid-turn, the notification just sits there until something
  triggers a turn end → next prompt.
- **`packages/agent/src/jobs/format-notification.ts`** wraps each
  notification in an XML-ish block:

      <background-job-notification job-id="..." type="completed">
      Status: completed
      Exit code: 0
      Duration: 12.3s
      Output: 1,432 bytes
      Last line: "..."

      Use job_output(jobId="...") to see full output.
      To continue the conversation: delegate(resume="...", prompt="...")
      </background-job-notification>

- **Injection point**: `packages/agent/src/rpc/handlers/prompt.ts:104-110`
  prepends any queued notifications to the next user prompt before the
  turn starts. So *some* wake-up signal already happens — but only on the
  next user prompt or next internal turn, and only when the agent is
  actually idle.
- **Progress timer**: `createSetupProgressTimer` (`job-notifications.ts:87`)
  fires at `job.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS` (5
  minutes; `server-types.ts:56`) for every job that has one configured.
  Each tick queues a `progress` notification with the last 3 lines (or 8
  for delegate jobs) and the delta byte count since the last tick.

### What survives a lace restart

- `events.jsonl` is durable, so the list of historical jobs and their
  final status survives.
- The in-memory `JobState` map does *not* survive — any running shell or
  subagent process is orphaned. A job that was `running` in the events but
  is no longer in the in-memory map is reclassified as `failed` by
  `applyRunningStatus` (`job-manager.ts:218`). The child OS processes are
  not actively reaped on restart.
- Subagent sessions (`subagentSessionId`) survive on disk and can be
  resumed with `delegate(resume=...)`.

### The actual gap

Lace already has 80% of the machinery PRI-1692 wants: a notification
queue, a wake-up trigger when idle, formatted preview blocks, durable
events. The bug is in *fit and finish*:

1. **The notification system is invisible to the agent.** Personas don't
   document it. There is no tool to subscribe / unsubscribe. The
   `delegation.md` persona section
   (`packages/agent/config/agent-personas/sections/delegation.md`) does
   not mention `background=true`, `job_output`, polling discipline, or
   notifications at all.
2. **Idle-only wake-up.** `queueJobNotification` only triggers
   `runPromptInternal` when `!state.activeTurn`. An agent that's *inside*
   `job_output(block=true)` is mid-turn, so notifications never preempt
   it; they pile up and only deliver after the polling tool returns.
   PRI-1691 (mid-turn message injection) fixes this at the transport
   layer.
3. **Progress notifications are firehosed by config, not by demand.**
   Every delegate job with a `progressIntervalMs` gets ticks every 5min
   regardless of whether anyone's listening. There's no opt-in / opt-out.
4. **No structured subagent → parent channel.** A subagent has no way to
   push a typed message ("I have a question for you", "I'm 60% done",
   "here's a partial result") that arrives upstream as anything other than
   "the last 8 lines of stdout." Serf's `communicate` tool (see below)
   solves this; lace has nothing analogous.
5. **No filter / batch / overflow handling.** A chatty subagent that
   emits 1000 lines/min will, when its progress tick fires, deliver an 8-line
   preview — but if the model decides to subscribe to *output*, there's
   no mechanism to throttle.
6. **`job_output(block=true)` is a footgun.** Its default 30s timeout is
   small enough that an agent who doesn't know better will loop. It
   blocks the parent's tool execution, so notifications can't preempt it.
   It's the obvious tool to reach for, and reaching for it is the wrong
   move.
7. **No `wait` minimum-timeout discipline.** Compare serf's `wait`
   (`agent/subagents.go:15`): `minWaitTimeoutMS = 120_000` — any
   `timeout_ms` below 2 minutes is silently clamped up. Lace's
   `job_output` allows 0ms, which encourages polling.

## What serf does

Serf (`inspo/serf/`) is Jesse's prior, more mature, coding-agent harness.
Its job/subagent model is in `inspo/serf/agent/subagents.go` (504 lines)
plus tool definitions in `inspo/serf/agent/profile.go:1126-1226`.

### Five agent-management tools

1. **`spawn_agent`** (`profile.go:1126`) — spawn a subagent with a `task`,
   optional `agent_type` (plugin / built-in), optional `model`, optional
   `max_turns`, optional `reasoning_effort`, optional `grant_tools` (extra
   tools to expose beyond the agent's default toolset), and optional
   `task_list` (pre-populate the subagent's task store). Also takes a
   `blocking: bool` — when true, spawns *and waits* in one call,
   returning the result JSON directly. Subagents cannot themselves call
   `spawn_agent` (depth limit; `subagents.go:130`).
2. **`resume_agent`** (`profile.go:1164`; note: the Go func name is
   `defSendInput`, the tool name is `resume_agent`) — push a message into
   a running subagent (injected as a steering / user-role message via
   `sess.Steer`) or, if the subagent has gone idle, start a new
   `ProcessInput` round. Also supports `blocking=true` for spawn-then-wait
   ergonomics. Appends optional `task_list` items.
3. **`wait`** (`profile.go:1197`) — block on a Go channel
   (`sub.done`) until the subagent completes or a timeout fires.
   `timeout_ms` is *clamped to a 2-minute minimum* (`subagents.go:15`,
   `session.go:4424`) to make rapid-retry polling impossible. After the
   first successful wait, the result is marked `resultConsumed`; a second
   `wait` without an intervening `resume_agent` errors.
4. **`close_agent`** (`profile.go:1213`) — cancel + tear down the
   subagent's session, returning its final result JSON.
5. **`communicate`** (`profile.go:1262`) — the *only* user-facing message
   channel. Takes a free-text `message`, an `await_reply: bool`, and a
   structured `output` envelope (`{message, data, artifacts}`). When a
   subagent calls `communicate`, its parent gets a typed payload — not a
   stdout scrape. If a default subagent ends a run without ever calling
   `communicate`, serf auto-nudges with a steering message
   (`subagents.go:441`) and gives it one more shot.

### Lifecycle and IPC

- The subagent runs in a goroutine started with `context.Background()`
  (`subagents.go:303`) — explicitly *not* tied to the parent's tool-call
  context. The parent can stop waiting, time out, or finish its input
  while the child keeps going. Only `closeAgent` or parent-session-close
  cancels the child.
- `sendInput` (`subagents.go:314`) does the right thing based on child
  state: running → `sess.Steer(input)` (mid-turn user message); idle →
  start a fresh `ProcessInput` round. Same tool, two semantics.
- `wait` returns a single `SubAgentResult` struct: `{ status, output,
  success, turns_used, transcript }` — explicitly designed so the parent
  *cannot* assume success without inspecting fields. The `wait` tool's
  description (`profile.go:1200`) tells the model: "inspect `success`
  yourself instead of assuming the subagent solved the task."

### The event stream

Serf has typed `SUBAGENT_START` and `SUBAGENT_END` events
(`agent/events.go:31-32`). UIs (the hub, the TUI) consume the stream
directly. There's also `EventCommunicate` (`events.go:26`), so every
subagent-to-parent message is visible to the host.

### Tool-output truncation and limits

Worth borrowing even though it's not strictly a job concern:
`spawn_agent` results are capped at 20_000 chars head/tail
(`tool_registry.go:441`); `communicate` is capped at 5_000 chars tail;
`shell` at 30_000 chars + 512 lines head/tail. Full output is always
delivered via the event stream — the LLM sees the truncated version.

### Other gestures worth noting

- `MaxSubagentDepth` (default 1) prevents recursive delegation explosions.
- `ShareTasksWithChildren` flag lets a parent pass its task store down.
- `grant_tools` lets the parent expand the child's toolset *but* refuses
  to grant top-level-only tools (`spawn_agent`, `resume_agent`, `wait`,
  `close_agent`) — the agent-management surface is never delegated
  downward.
- `Communicated()` predicate on the session — the parent can check
  whether the child actually reported back before treating the run as
  done.

## What Claude Code's `Monitor` does (for design reference)

Claude Code (the official CLI) exposes a `Monitor` tool that streams
events from a long-running script. Its tool description (provided
verbatim to this work) bakes in the *operational discipline* that lace
is missing. Borrowed wholesale:

- **stdout-line-as-event-stream.** Each line of the watched command's
  stdout is a single notification. Exit ends the stream.
- **200ms batching window.** Lines emitted within 200ms group into one
  notification — chatty multi-line events don't fragment.
- **Coverage discipline ("silence is not success").** A filter that
  matches only the happy path goes silent on crash, hang, or unexpected
  exit. The Monitor docs explicitly tell the model: "before arming, ask:
  if this process crashed right now, would my filter emit anything?"
- **Selective filter at the producer side.** The caller declares what
  matters (a grep pattern, a step boundary). Stdout that doesn't match
  isn't a notification.
- **Auto-stop on overflow.** Monitors producing too many events are
  killed; the model has to restart with a tighter filter. This is the
  backstop against runaway subscriptions.
- **`persistent` vs bounded.** Same tool, one flag — short-lived watches
  with a timeout, or session-length watches that run until explicitly
  stopped.
- **PushNotification as a separate escalation channel.** The event
  stream is for "the model should know about this on its next turn"; a
  push is for "the user should know about this *now*." Two distinct
  signals, not one with two thresholds.

## Gap analysis

| Capability                                       | Serf | Claude Code Monitor | Lace today | Severity |
|--------------------------------------------------|:----:|:-------------------:|:----------:|:--------:|
| Async spawn that returns a handle                |  ✓   |          —          |     ✓      |   ok     |
| Sync `blocking=true` spawn-and-wait              |  ✓   |          —          |     ✓ (sync mode)     |   ok     |
| Tool-level `wait(handle, timeout)`               |  ✓   |          —          | partial (`job_output block=true`) | **high** |
| Minimum-wait-timeout guard against polling       |  ✓   |          —          |     ✗      | **high** |
| Auto-injected completion notification            |  —   |    ✓ (on exit)      |     ✓ (queued; idle-only wake) | medium |
| Mid-turn wake on notification                    |  —   |          ✓          | ✗ (PRI-1691 fixes) | **high** |
| Opt-in subscription per-job (`job_notify`)       |  —   |          ✓          |     ✗      | **high** |
| Subscriber-side filter (per-line or per-event)   |  —   |          ✓          |     ✗      |  medium  |
| 200ms batching of bursty lines                   |  —   |          ✓          |     ✗      |  medium  |
| Overflow auto-stop                               |  —   |          ✓          |     ✗      |  medium  |
| Persistent vs bounded subscription               |  —   |          ✓          |  partial (progress timer is on-or-off) | medium |
| Structured subagent→parent message (`communicate`) | ✓ |          —          |     ✗      | **high** |
| Auto-nudge if subagent stops without reporting   |  ✓   |          —          |     ✗      |  medium  |
| `resume_agent` semantics (steer-if-running, restart-if-idle) | ✓ |   —     | partial (`delegate(resume=...)` only after job ends) | medium |
| Depth limit on delegation                        |  ✓   |          —          |   unknown — needs audit |  low |
| Tools may not be granted to children             |  ✓ (whitelist) |    —      |     ✗      |   low    |
| Result struct distinguishes `success` vs `output` |  ✓  |          —          |     ✗ (just `status` + raw text) | medium |
| PushNotification "wake the user" channel         |  —   |          ✓          |     ✗      |   low    |

The four **high-severity** gaps are the ones that produced the Ada
lockup. The mediums shape the long-term cost curve.

## Proposed design

The thesis: lace's existing notification queue is the right *substrate*.
The fix is to expose it as a first-class subscription tool, harden it
against polling, add a typed subagent→parent channel, and tighten the
operational defaults so the cheap path is the obvious path.

### New tool: `job_notify`

Subscribe to events from a job. Returns immediately. When the job
emits matching events, a `<background-job-notification>` block is
synthesized into the parent's inbox via the existing
`packages/agent/src/rpc/handlers/prompt.ts:104` injection path.

```typescript
// packages/agent/src/tools/implementations/job_notify.ts
import { z } from 'zod';
import { Tool } from '../tool';
import { NonEmptyString } from '../schemas/common';
import type { ToolAnnotations, ToolContext, ToolResult } from '../types';

const jobNotifySchema = z
  .object({
    jobId: NonEmptyString,
    on: z
      .array(z.enum(['exit', 'output', 'communicate']))
      .min(1)
      .default(['exit']),
    /** Per-line regex applied to subagent stdout. Only matching lines
        trigger an `output` event. Ignored when `on` excludes `output`. */
    filter: z.string().optional(),
    /** Cancel the subscription after this many notifications have been
        delivered (default: unlimited for `exit`-only; 50 for `output`). */
    maxNotifications: z.number().int().min(1).max(1000).optional(),
    /** Subscription self-cancels after this wall-clock duration. Default
        24h. Hard maximum 7 days. */
    expiresMs: z.number().int().min(60_000).max(7 * 24 * 3600_000).optional(),
  })
  .strict();
```

Return shape: `{ subscribed: true, jobId, subscriptionId, on, filter?, expiresAt }`.

**Default behavior** (matches PRI-1692 acceptance criteria):
`job_notify(jobId)` with no other args = `{ on: ['exit'] }`. One
notification when the job ends; subscription auto-clears.

**Operational discipline borrowed from `Monitor`:**

- The `filter` regex applies *at the producer side* — lines that don't
  match never become notifications. Cuts conversation noise.
- 200ms batching window: stdout lines emitted within 200ms group into a
  single notification block.
- Coverage discipline baked into the tool description: "If you subscribe
  only to `output`, you will not be notified when the job crashes
  silently. Always include `exit` unless you've also armed a separate
  subscription for terminal state." (Mirrors Monitor's "silence is not
  success.")
- Auto-stop on overflow: if a single subscription would emit more than
  N notifications in M seconds (proposed: 20 in 60s), the subscription
  is cancelled and a synthetic `<subscription-overflow>` notification is
  delivered explaining what happened.
- Idempotent: subscribing twice to the same jobId with the same `on`
  set returns the existing subscription's id.

### Removed: `job_output(block=true)` as the wait primitive

Once `job_notify` lands, `job_output` becomes purely a read tool. The
`block` and `timeoutMs` params are deprecated and the description tells
the agent: "to wait, use `job_notify` and return to the user. Do not
poll." The unused `byteOffset` param is either wired up (incremental
reads) or removed.

This isn't backward-compat hostile in the way it sounds — Ada doesn't
have a year of saved transcripts that use `block=true`; this is a
pre-v1 surface.

### Subagent → parent channel: `communicate`

Borrow serf's `communicate` tool verbatim, with lace conventions:

```typescript
// packages/agent/src/tools/implementations/communicate.ts (subagent-side)
const communicateSchema = z
  .object({
    /** The exact text the parent should see. */
    message: NonEmptyString,
    /** When true, the subagent pauses and the parent is expected to
        reply via delegate(resume=...). When false, fire-and-continue. */
    awaitReply: z.boolean(),
    /** Optional structured payload. */
    output: z
      .object({
        message: z.string().default(''),
        data: z.record(z.unknown()).default({}),
        artifacts: z.array(z.string()).default([]),
      })
      .optional(),
  })
  .strict();
```

Wire-up:

- `communicate` is registered *only on the subagent* — never on the
  top-level agent. (Mirrors serf's "root-only vs subagent-only" split:
  see `subagents.go:43 rootOnlyAgentManagementTools`.)
- The subagent's `communicate` call is intercepted in
  `runSubagentJobProcess` (it already speaks JSON-RPC over stdio via
  `@lace/ent-protocol`) and converted into a `job_communicate`
  notification on the parent's queue, with the structured payload
  preserved.
- A `delegate(...)` call with no `background` blocks until either
  exit *or* `communicate(awaitReply=true)` — whichever comes first.
- If `awaitReply=true`, the subagent's session is paused (not killed);
  the parent's `delegate(resume=...)` resumes it with the reply.
- **Auto-nudge** (serf's `subagents.go:441` pattern): if a subagent ends
  a run without ever calling `communicate`, lace injects one steering
  message reminding it and gives it another round. After that, the
  parent gets a notification "subagent ended without reporting; output
  scrape attached" with the last N lines from stdout as the fallback
  payload.
- Persona docs make `communicate(awaitReply=false)` the *only*
  blessed way for subagents to surface results.

### Lifecycle / reaping changes

Three smaller fixes that fall out of doing the above honestly:

1. **Survive lace restart.** Right now, restart orphans running subagent
   processes and silently reclassifies them as `failed`. We should
   instead, on `JobManager` boot, walk the events log for `running`
   jobs, attempt to reattach via the existing JSON-RPC peer (the child
   process records its socket path on spawn), and either resume the
   subscription or mark the job `failed` *and reap the OS process*.
   Out-of-scope for v1 of this ticket but tracked under "Implementation
   roadmap" Phase 4.
2. **Subscriptions are tied to subagent sessions, not job runs.** When
   `delegate(resume=...)` continues a previously-completed subagent, an
   existing subscription on the old jobId continues to receive events
   from the new run. Otherwise, the model has to re-subscribe on every
   resume — friction.
3. **Mid-turn delivery.** Once PRI-1691 lands, the `runPromptInternal`
   trigger in `createQueueJobNotification` (`job-notifications.ts:62`)
   should fire whether or not `state.activeTurn` is null — the
   transport, not the queue, owns "is now a good time to deliver."

### Tightened defaults

- **`progressIntervalMs` default goes to `null`** (no progress timer
  unless explicitly requested or subscribed). The current 5-minute
  default fires for every delegate job whether anyone wants it. With
  `job_notify` available, opt-in is cleaner.
- **`job_output` no longer blocks by default.** `block=true` is
  preserved as an escape hatch with a docstring warning, but the
  default is `block=false` — read what's there, return immediately.
- **`delegate` description rewritten** to lead with: "if you set
  `background=true`, immediately call `job_notify(jobId)` and return to
  the user; the subagent will wake you when it has news." The current
  description (`delegate.ts:38`) doesn't mention notifications at all.

### API surface (TypeScript)

Mirroring the existing `Tool` shape in
`packages/agent/src/tools/implementations/`:

```typescript
// New, subagent-side only:
export class CommunicateTool extends Tool {
  name = 'communicate';
  description = '...';                // see schema above
  schema = communicateSchema;
  annotations: ToolAnnotations = {
    title: 'Communicate with parent',
    safeInternal: true,
  };
  protected async executeValidated(
    args: z.infer<typeof communicateSchema>,
    context: ToolContext
  ): Promise<ToolResult> { /* talks to parent via stdio peer */ }
}

// New, parent-side:
export class JobNotifyTool extends Tool {
  name = 'job_notify';
  description = '...';                // see schema + Monitor discipline notes
  schema = jobNotifySchema;
  annotations: ToolAnnotations = {
    title: 'Subscribe to job events',
    safeInternal: true,
    readOnlySafe: true,
  };
  protected async executeValidated(
    args: z.infer<typeof jobNotifySchema>,
    context: ToolContext
  ): Promise<ToolResult> { /* registers subscription on JobManager */ }
}

// Modified:
//   - delegate.ts: rewrite description; keep schema; add `awaitCommunicate`
//     flag (default true) so sync mode returns on the first
//     communicate(awaitReply=false) instead of on exit.
//   - job_output.ts: deprecate `block`/`timeoutMs`; wire `byteOffset` for
//     incremental reads or remove it.
//   - jobs_list.ts: add `subscriptions: number` column per job.
//   - job_kill.ts: unchanged.
```

JobManager additions:

```typescript
// packages/agent/src/jobs/job-manager.ts
interface JobSubscription {
  subscriptionId: string;
  jobId: string;
  on: Array<'exit' | 'output' | 'communicate'>;
  filter?: RegExp;
  maxNotifications?: number;
  expiresAt: number;
  delivered: number;
  burstWindow: { count: number; windowStart: number };  // overflow guard
}

class JobManager {
  // existing fields...
  private subscriptions = new Map<string, JobSubscription>();
  private subscriptionsByJob = new Map<string, Set<string>>();

  subscribe(opts: SubscribeOptions): JobSubscription { /* ... */ }
  unsubscribe(subscriptionId: string): void { /* ... */ }

  /** Called by subagent-job.ts whenever a line of stdout is appended,
      whenever a `communicate` payload arrives, and at finalize. */
  fanout(jobId: string, kind: 'output' | 'communicate' | 'exit', payload: unknown): void { /* ... */ }
}
```

The `fanout` call lands two existing hot paths:

- `subagent-job.ts` already buffers stdout (`stderrBuffer` and the
  job-log writer); adding `fanout(job.jobId, 'output', line)` per
  buffered line is mechanical.
- `createFinalizeJob` (`job-notifications.ts:128`) already queues a
  completion notification; convert it to a `fanout(..., 'exit', ...)`
  and let the queueing happen inside `fanout` for every matching
  subscription (plus, for back-compat, one default-shape notification if
  no subscription exists — so parents that haven't subscribed still get
  the existing automatic completion ping).

### Test plan

- **`job_notify` happy path**: dispatch a delegate job, call
  `job_notify(jobId)`, wait synthetically for the child to exit, assert
  exactly one notification appears in the parent's prompt-content on
  the next turn.
- **`job_notify` with `on=['output']` + `filter`**: dispatch a job that
  prints 5 lines, only 2 of which match `^ERROR`. Assert exactly two
  notifications, batched if within 200ms.
- **Overflow auto-stop**: dispatch a job that prints 100 lines/sec for
  10sec; subscribe with `on=['output']`, no filter. Assert that the
  subscription is auto-cancelled after the threshold and a synthetic
  overflow notification arrives.
- **Mid-turn delivery (paired with PRI-1691)**: while parent is mid-turn
  in some other tool, subscribed jobId exits. Assert the notification
  preempts via mid-turn injection rather than waiting for turn end.
- **`wait`-style minimum-timeout guard**: assert that `job_output` with
  `block=true, timeoutMs=1000` is either rejected or clamped to a
  minimum (proposal: 120_000 — mirror serf's `minWaitTimeoutMS`).
- **`communicate` round-trip**: subagent calls
  `communicate({message: "Q?", awaitReply: true, output: {data: {x:1}}})`.
  Parent's `delegate` call returns with structured payload. Parent calls
  `delegate(resume=jobId, prompt="A")`. Subagent's session resumes with
  the parent's reply as a steering message.
- **Auto-nudge**: subagent ends without calling `communicate`. Assert
  one nudge round happens, then a fallback-shaped notification arrives
  upstream.
- **Restart recovery**: kill lace mid-job, restart, assert the orphaned
  subagent's OS process is reaped and the job is marked failed in
  `events.jsonl`.

### Migration / backwards-compat

This is pre-v1; the standing rule in `CLAUDE.md` is "we never leave
backward-compatibility or legacy code in place." Concretely:

- Personas that currently say things like "call `job_output` to check
  the result" need rewrites. There are very few such mentions today
  (`packages/agent/config/agent-personas/sections/delegation.md` doesn't
  cover async at all). Update at the same time as the tool ships.
- Sen v2's Ada persona will need to learn the new pattern: delegate →
  `job_notify(jobId)` → return to user → handle wake-up on next turn.
  Owned by the sen2 retrofit (PRI-1673 Phase 7+).
- Removing `block` / `timeoutMs` from `job_output` is a hard break for
  any persona that uses them. Audit + rewrite is small (it's a v1).

### Implementation roadmap

Phased so each lands with its own tests and is independently mergeable:

**Phase 1 — wake-the-parent core (closes PRI-1692 acceptance):**
   - Add `JobManager.subscribe / unsubscribe / fanout`.
   - Add `JobNotifyTool`; register on top-level agent.
   - Wire `fanout('exit', ...)` from `createFinalizeJob`.
   - Persona doc update for the new pattern.
   - Tests for the happy path + idle wake.

**Phase 2 — `output` subscriptions with discipline:**
   - Wire `fanout('output', line)` from `subagent-job.ts`.
   - Implement filter, 200ms batching, overflow auto-stop.
   - Update persona docs with the Monitor coverage discipline rules.

**Phase 3 — `communicate` channel:**
   - Add `CommunicateTool` (subagent-side only).
   - JSON-RPC method on the subagent peer.
   - `fanout('communicate', payload)`.
   - Auto-nudge logic in the subagent-job finalizer.
   - Pair `delegate` sync-mode with `communicate(awaitReply=false)` as
     the success path.

**Phase 4 — tighten the rest:**
   - Deprecate `job_output(block=true)`.
   - Default `progressIntervalMs` to `null`.
   - `job_output(byteOffset)` wired or removed.
   - Restart-recovery: reap orphaned subagent processes.
   - Optional: PushNotification-style "wake the human" escalation flag
     on `communicate`.

Depends on / pairs with:

- **PRI-1691** (mid-turn message injection) — Phase 1 of this work is
  *correct* without PRI-1691 (it still delivers; just at next turn
  boundary instead of mid-turn). But the full token-cost win requires
  PRI-1691.
- **PRI-1673 Phase 7+** — Ada's persona changes consume this surface.

## Acceptance criteria

The upgrade is done when:

1. `job_notify(jobId)` is registered on the top-level persona and the
   four high-severity gaps in the table above are closed.
2. A subagent that exits *or* emits a matching event causes a
   `<background-job-notification>` block to appear in the parent's next
   turn's prompt content, via the existing
   `packages/agent/src/rpc/handlers/prompt.ts:104` injection path.
3. `job_output(block=true)` is deprecated; default behavior is
   non-blocking read. Any blocking timeout below 120_000ms is rejected
   or clamped (mirroring serf's `minWaitTimeoutMS`).
4. A subagent can call `communicate(message, awaitReply, output)` and
   the parent receives a typed payload (not a stdout scrape) on the
   next turn.
5. Persona docs in `packages/agent/config/agent-personas/` describe the
   delegate → `job_notify` → return-to-user → wake-up pattern, and
   explicitly tell the agent never to poll `job_output`.
6. Test coverage as enumerated above; integration tests with a real
   subagent process (no mocks at the IPC boundary).
7. A repeat of the Ada smoke test (delegate a slow shell subagent,
   wait 8 minutes) consumes < 2k tokens of parent context across the
   wait, not 30k.

## Open questions

1. **Should `output` subscriptions ride the parent's prompt-content
   queue at all, or a separate "log" channel the UI shows but the LLM
   doesn't always see?** A long-running build that emits 500 matching
   lines could blow context. Monitor solves this with auto-stop and
   batching; serf's `communicate` is the inverse (only structured
   messages cross the boundary). Recommended default: subscribe to
   `exit` and `communicate` only; require explicit opt-in for `output`,
   plus the overflow guard. But this needs Jesse's call.
2. **`communicate.output` envelope shape.** Serf's three-field
   `{message, data, artifacts}` is reasonable. Should `data` be Zod-validated
   against a schema declared at subagent-spawn time, or just opaque JSON?
   Schema-validated is nicer for orchestration but means more API
   surface in `delegate`.
3. **`PushNotification`-style escalation.** Claude Code's Monitor pairs
   with a `PushNotification` tool to wake the human. Lace has a Slack
   relay and a TUI, but no unified "wake the user *now*" surface. Out
   of scope for PRI-1692; flagged as a future ticket.
4. **Should `wait` be its own tool too?** Serf has both `wait` and
   `job_notify`-like behavior (because `wait` is the blocking primitive
   and `communicate` is the message primitive). Lace could expose
   `job_wait(jobId, minTimeoutMs=120_000)` as a strict synchronous
   wait, distinct from the async `job_notify`. *Recommendation: no — one
   tool with clearer guidance beats two. `job_notify(jobId)` is the
   async path; `delegate(...)` with no background is the sync path. A
   tool-level wait adds a third path that's confusing.*
5. **Restart recovery — reattach or reap?** When lace restarts and finds
   a `running` subagent in events, the OS process may still be alive.
   Reattaching is harder (need to find the JSON-RPC socket); reaping is
   simpler (kill the process, mark failed). *Recommendation: reap for
   v1, with a TODO for reattach in a follow-up. The persistent-checkout
   coworker arch (PRI-1673) makes reattach more attractive long-term.*
6. **Cross-session subscriptions.** Should an agent be able to
   subscribe to a job from a *prior* session? E.g., Ada starts a long
   delegation, ends her session, restarts later — can she
   `job_notify(jobId)` the still-running child? Currently the
   `JobManager` is session-scoped. *Recommendation: defer; the v1
   scope is single-session.*

## Surprises worth flagging

- **Lace already has 80% of this.** The notification queue, the
  `runPromptInternal` wake-up trigger, the formatted
  `<background-job-notification>` blocks — they all exist. The Ada
  lockup happened because the surface didn't expose them and the
  persona didn't teach them. The fix is more API and docs work than
  plumbing work, which is good news.
- **`job_output.block=true` is the foot-gun, not the missing tool.**
  Half the work here is making the polling path harder to take. Adding
  `job_notify` without deprecating `block=true` would let Ada keep
  polling.
- **`byteOffset` is in the schema and unused.** Either it was deferred
  or the author forgot. Worth wiring up for the incremental-read case
  the original schema clearly intended.
- **Serf's `wait` has a 2-minute minimum timeout.** This is the single
  most operationally important guard against polling in serf, and lace
  has nothing equivalent. Cheap to add.

## References

### serf (read-only inspiration; do not modify)

- `inspo/serf/agent/subagents.go` — subagent lifecycle, `wait` with
  `minWaitTimeoutMS = 120_000`, root-only tool guard, auto-nudge.
- `inspo/serf/agent/profile.go:1126-1308` — `defSpawnAgent`,
  `defSendInput` (registers as `resume_agent`), `defWait`,
  `defCloseAgent`, `defCommunicate`.
- `inspo/serf/agent/session.go:4284-4720` — tool registration and the
  `communicate` handler.
- `inspo/serf/agent/events.go:31-32` — `SUBAGENT_START/END` events.
- `inspo/serf/coding-agent-loop-spec.md` §7 — language-agnostic
  subagent spec.

### lace (the thing being upgraded)

- `packages/agent/src/tools/implementations/delegate.ts` — current
  `delegate` tool.
- `packages/agent/src/tools/implementations/job_output.ts` — current
  `job_output` tool; `byteOffset` declared but unused.
- `packages/agent/src/tools/implementations/job_kill.ts`,
  `jobs_list.ts` — current job control tools.
- `packages/agent/src/jobs/job-manager.ts` — `JobManager` class;
  `queueNotification` / `flushNotifications` / `getNotificationQueue`
  already exist (lines 319-337).
- `packages/agent/src/jobs/job-notifications.ts` —
  `createQueueJobNotification` (idle wake-up trigger),
  `createSetupProgressTimer`, `createFinalizeJob`.
- `packages/agent/src/jobs/format-notification.ts` — the
  `<background-job-notification>` block format that already exists.
- `packages/agent/src/jobs/subagent-job.ts` — subagent process model
  via JSON-RPC over stdio; this is where `communicate` would be
  intercepted.
- `packages/agent/src/rpc/handlers/prompt.ts:104-110` — notification
  injection point (prepends to next prompt content).
- `packages/agent/src/server-types.ts:56` — `DEFAULT_PROGRESS_INTERVAL_MS = 300000`.
- `packages/agent/config/agent-personas/sections/delegation.md` —
  persona doc to rewrite; currently silent on async / polling /
  notifications.

### Linear / context

- PRI-1692 — this ticket (`job_notify` specifically).
- PRI-1691 — companion: mid-turn message injection (the transport-side
  receiving end of this design).
- PRI-1673 — umbrella: persistent-checkout coworker architecture; the
  Ada lockup was found during Phase 7 retrofit smoke testing on
  2026-05-20.

### Claude Code

- `Monitor` tool description (provided verbatim, 2026-05-21). The
  operational discipline notes — coverage / silence / filter at
  producer / 200ms batch / overflow auto-stop / persistent vs bounded —
  apply to `job_notify` directly.
