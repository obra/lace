# Notification System Architecture

Companion to [`docs/features/notifications.md`](../features/notifications.md),
which is the user/operator reference. This doc explains _why_ the system is
built this way and _how_ the pieces fit together. Design context lives in
[`docs/superpowers/specs/2026-05-21-pri-1744-alarms-in-lace.md`](../superpowers/specs/2026-05-21-pri-1744-alarms-in-lace.md).

## 1. Overview

Lace delivers every agent-facing notification — reminder fires, background-job
lifecycle events, and graceful-subagent-exit warnings — by writing a single
durable event:

```
type: 'context_injected'
data.priority: 'immediate'
data.content: [{ type: 'text', text: '<notification kind="..." ...>...</notification>' }]
```

The conversation runner picks these events up at each turn-iteration boundary
and folds them into the next provider call as `role: 'user'` messages. Every
agent-facing notification shares one wrapper —

```
<notification kind="..." [identifier-attrs]>
body prose
</notification>
```

— and is composed by a small set of pure functions in
`packages/agent/src/notifications/composers.ts`.

## 2. Why this design

Before PRI-1744 there were two parallel mechanisms:

- **Alarms** wrote rows to a SQLite database and fired via cross-process
  polling. Each lace process polled the same DB. A new "active" lace had to
  discover alarms its predecessors had written.
- **Background-job notifications** used a `<background-job-notification>` XML
  wrapper, queued bytes into a per-process buffer, and prepended that buffer to
  the next prompt. Different shape, different delivery path, different failure
  modes.

Both routes wrote to shared mutable state, and both had recurring race bugs. The
PRI-1744 redesign collapsed everything onto event sourcing:

- **One delivery path**: write a `context_injected priority='immediate'` durable
  event to the active session's `events.jsonl`.
- **One shape**: `<notification kind="...">body</notification>`.
- **One serialization point per process**: `runExclusive` (Promise-based mutex
  on `state.sessionMutex`).
- **One architectural invariant**: a lace process writes only to its own active
  session's files. Cross-process effects flow via `session/update` notifications
  to the owning process.

The invariant is the load-bearing one. Two processes computing
`deriveNextEventSeqFromEventLog` on the same `events.jsonl` at the same moment
will compute the same next seq — there is no safe sequence allocator across
processes without a lock, and we'd rather not introduce one.

## 3. Data flow

```
+---------------------+       +-----------------------+       +-----------------+
| producer subsystem  | --1-> | composer (pure)       | --2-> | injectNotif.    |
| (reminder scheduler /|       | composeReminderBody   |       | buildNotification|
|  job manager /      |       | composeJob*           |       | appendDurable   |
|  subagent-exit relay)|      | composeSubagentExited |       | (events.jsonl)  |
+---------------------+       +-----------------------+       +-----------------+
                                                                       |
                                                                       3
                                                                       v
                                                              +-----------------+
                                                              | ConversationRun |
                                                              | readImmediate-  |
                                                              | InjectsSince at |
                                                              | top of each     |
                                                              | iteration       |
                                                              +-----------------+
                                                                       |
                                                                  idle? 4
                                                                       v
                                                              +-----------------+
                                                              | idleWake.       |
                                                              | triggerInternal |
                                                              | Turn — runs one |
                                                              | synthetic turn  |
                                                              +-----------------+
```

1. A subsystem decides to notify (reminder fires; job transitions; subagent
   exits with pending reminders).
2. It composes a body via a pure composer (no side effects, no I/O).
3. It calls `injectNotification(...)`, which calls `buildNotification` to wrap
   the body and `appendDurableEvent` to write the event under `runExclusive`.
4. If the target is the active session and no turn is in flight, the optional
   `idleWake` hooks schedule a synthetic internal turn via `setImmediate`, which
   calls `runPromptInternal([])`. If a turn is already running, the runner picks
   the event up at its next iteration boundary (see §5).

## 4. Components

### `notification-wrapper.ts` — the XML wrapper

`packages/agent/src/notifications/notification-wrapper.ts:27` —
`buildNotification(opts)` is the single source of truth for the wrapper. It
owns:

- the `NotificationKind` union (lines 5–11) — six kinds today: `reminder`,
  `job-completed`, `job-failed`, `job-cancelled`, `job-progress`,
  `subagent-exited`.
- XML attribute escaping for `&`, `<`, `>`, `"` (lines 19–25).
- The empty-string identifier drop rule (line 31: `if (v === '') continue`).

Pure function. No I/O. No state.

### `composers.ts` — per-kind body builders

`packages/agent/src/notifications/composers.ts` — one composer per `kind`, each
a pure function from typed input to prose body. Examples:

- `composeReminderBody` (line 94) — emits the prompt the agent wrote at schedule
  time.
- `composeJobCompletedBody` / `composeJobFailedBody` (lines 30, 41) — share the
  same input shape; differ only in verb tense.
- `composeJobCancelledBody` (line 59) — optional `reason` string.
- `composeJobProgressBody` (line 73) — emits a "recent output:" tail when
  `lastLines` is non-empty.
- `composeSubagentExitedBody` (line 123) — singular vs. multiple pending
  reminder formatting.

Helpers (`formatDuration`, `formatBytes`, `truncate`, `trailingLineHint`,
`formatPendingReminder`) are all local pure functions. Time formatting always
goes through `formatAbsoluteTime`.

### `inject-notification.ts` — the single writer

`packages/agent/src/notifications/inject-notification.ts:44` —
`injectNotification(opts)`:

1. Wraps the body via `buildNotification`.
2. Reads `state.json` best-effort via `readSessionStateBestEffort` (line 30) —
   returns `{ nextEventSeq: 1, nextStreamSeq: 1 }` on any parse/file error.
3. Calls `appendDurableEvent` (line 51) which itself re-derives the `eventSeq`
   from the durable log (so a stale `state.json` cannot collide).
4. Optionally calls `idleWake.triggerInternalTurn()` when the target is the
   active session and no turn is running (lines 64–66).

The comment at lines 58–62 is load-bearing: we intentionally do not rewrite
`state.json` from this path. The runner's authoritative cursor is recomputed
from `events.jsonl` on every run. Cross-process writes (subagent → parent) would
not own the parent's `state.json` anyway.

### `format-time.ts` — single time formatter

`packages/agent/src/notifications/format-time.ts:16` — `formatAbsoluteTime`
returns full ISO-8601 with explicit offset plus IANA zone in parens:

```
2026-12-25T09:00:00-08:00 (America/Los_Angeles)
```

Used by every body that mentions a timestamp. Centralized so we don't drift
between "Dec 25 9am PST" and "2026-12-25T17:00:00Z" in different kinds. Throws
on invalid IANA zones (the validation at line 18 catches typos at the producer,
not the consumer).

## 5. The runner's pickup contract

`packages/agent/src/core/conversation/runner.ts`.

### Watermark initialization

Line 203: `let lastSeenEventSeq = findLastTurnEndEventSeq(sessionDir) ?? 0;`

This is the crucial fix. The naive choice — "start from the latest event seq" —
would silently swallow any `context_injected` event written **between** turns
(after the previous `turn_end`, before `run()` was called). By starting from the
last `turn_end`, the first iteration's `readImmediateInjectsSince` picks up
everything queued in the meantime.

### In-turn pickup loop

Lines 219–233: at the top of every iteration the runner calls
`readImmediateInjectsSince(sessionDir, lastSeenEventSeq)` (definition at line
72). It returns all `context_injected priority='immediate'` events newer than
the watermark and the new high-water mark. Found events become `role: 'user'`
messages on the _current_ turn's `providerMessages` — the agent sees them in the
same provider call.

This re-read also catches `ent/session/inject` RPCs that landed mid-turn
(PRI-1691 — see the comment at lines 67–71).

### Post-turn rescan (Bug 3 fix)

`packages/agent/src/rpc/handlers/prompt.ts:328-347` — after the runner's `run()`
returns and `state.activeTurn` is cleared, the prompt handler re-scans:

```ts
const lastTurnEnd = findLastTurnEndEventSeq(state.activeSession.dir) ?? 0;
if (
  hasPendingImmediateInjects(state.activeSession.dir, lastTurnEnd) &&
  runPromptInternalRef.current
) {
  setImmediate(() => {
    if (
      !state.activeTurn &&
      state.activeSession &&
      runPromptInternalRef.current
    ) {
      void runPromptInternalRef.current([]);
    }
  });
}
```

This closes the race described in §6: a notification can land in the
microseconds between the runner's last `readImmediateInjectsSince` and the final
`turn_end` write. The idle-wake `setImmediate` that fired during that window
observed `activeTurn=true` and no-opped. Without this rescan, the event would
sit unprocessed until the next user prompt.

`hasPendingImmediateInjects` is in `packages/agent/src/storage/event-log.ts:42`.
`findLastTurnEndEventSeq` is in the same file at line 73.

### Why the watermark is per-turn local

The watermark is internal cursor state. The authoritative position is always
`findLastTurnEndEventSeq` plus a scan. We never persist the watermark to disk;
if the runner restarts mid-conversation, the next `run()` recomputes from
`events.jsonl`.

## 6. Idle-wake semantics

`IdleWakeHooks` interface at
`packages/agent/src/notifications/inject-notification.ts:12-19`:

```ts
isActive: (sessionDir: string) => boolean;
hasActiveTurn: () => boolean;
triggerInternalTurn: () => void;
```

All three callers (reminder scheduler at `server.ts:195-217`, job notification
at `job-notifications.ts:124-136`, subagent-exit relay does not need a wake
because it writes from inside `runExclusive` and relies on the post-turn rescan)
implement these the same way:

- `isActive` compares `sessionDir` to `state.activeSession?.dir`.
- `hasActiveTurn` returns `!!state.activeTurn`.
- `triggerInternalTurn` schedules a `setImmediate` callback that **re-checks**
  `state.activeTurn` and `state.activeSession` before invoking
  `runPromptInternal([])`.

The re-check matters. A turn may have started between the time the notification
was written and the time `setImmediate` fires. Without the re-check we would run
two concurrent turns on the same session — which is exactly what the post-turn
rescan in §5 is designed to clean up after, but much better to avoid in the
first place.

The race the post-turn rescan closes:

1. Runner finishes its last iteration. `lastSeenEventSeq` reflects all events
   seen so far.
2. Producer writes a notification. `idleWake.triggerInternalTurn` schedules a
   `setImmediate`.
3. The `setImmediate` callback runs. It reads `state.activeTurn === true`
   (because the runner is still cleaning up). No-op.
4. Runner writes `turn_end`. `state.activeTurn` is cleared.
5. Without the rescan: nothing else runs. The notification sits until the user
   prompts again.
6. With the rescan (§5): the prompt handler observes the pending event and fires
   a synthetic internal turn.

## 7. Intra-process serialization

All durable-event writers in a single lace process serialize through
`runExclusive`, defined at `packages/agent/src/server.ts:400-414`:

```ts
const runExclusive = async <T>(work: () => Promise<T> | T): Promise<T> => {
  const previous = state.sessionMutex;
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.sessionMutex = previous.then(() => next);
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
};
```

A Promise-chain mutex. Writers in this process:

- The runner's main loop (`runner.ts:181`, via `writeAndAdvance`).
- The `ent/session/inject` handler, via `injectIntoActiveSession`
  (`session-operations.ts:198-245`).
- The reminder scheduler's `notifier` callback (`server.ts:195-217`) — wraps its
  `injectNotification` call in `runExclusive` because the scheduler fires
  outside the runner's lock.
- The subagent-job's `session/update` relay branches: `job_started`,
  `job_finished`, `pending_reminders_on_exit` (`subagent-job.ts:635-676`).
- `createFinalizeJob` (`job-notifications.ts:218-232`) when writing the
  `job_finished` event.

Why the mutex is needed even on a single-threaded event loop: every `await`
yields. Two Promise chains that each "read state, derive next seq, append, write
state" can interleave at their `await` points and both compute the same
`nextEventSeq` from a stale read. The mutex makes the read/append/write tuple
atomic from the perspective of other writers.

`appendDurableEvent` (`event-log.ts:145-187`) also re-derives the seq from the
durable log (line 153) as a belt-and-suspenders defense against stale
`state.json` — but the mutex is what prevents two writers from racing on the
same fresh-read.

## 8. Cross-process design

The architectural invariant: a lace process writes only to its own active
session's `events.jsonl`.

### The motivating problem

The initial PRI-1744 design had the subagent process write `subagent-exited`
directly into the parent's `events.jsonl`. Result: two processes (parent's
runner and subagent's shutdown hook) both running
`deriveNextEventSeqFromEventLog` on the same file at the same instant. They
computed the same next seq, both wrote, and the loser's event was either lost or
appeared at a colliding seq with no atomic ordering guarantee.

### The chosen design

Subagent exit flows through the existing parent ↔ child JSON-RPC peer:

1. The subagent's graceful-shutdown handler calls `emitSubagentExitedIfNeeded`
   (`server.ts:258-290`). If there are pending reminders, it sends a one-way
   `session/update` notify with discriminant `'pending_reminders_on_exit'`
   carrying structured reminder rows (no XML, no prose).
2. The parent's per-subagent peer registration in `subagent-job.ts` already has
   a `session/update` handler. The `'pending_reminders_on_exit'` branch (lines
   635–676) validates the payload, builds the
   `<notification kind="subagent-exited">` wrapper in the _parent's_ process
   using the parent's composers, and appends it under the parent's
   `runExclusive`.
3. The parent's runner picks the event up via the same
   `readImmediateInjectsSince` path as everything else.

The subagent never writes the parent's files. The parent's `runExclusive` mutex
serializes the subagent-originated write with the parent's own runner and any
other concurrent writers.

### Why we ruled out alternatives

- **Cross-process file lock** (e.g. `flock` on `events.jsonl`): adds per-write
  syscall latency, OS-portability concerns (Windows), and introduces a new
  failure mode (locked-by-dead-process recovery).
- **Pending-events file** (subagent writes a sidecar JSON; parent drains on next
  read): a new file convention to maintain, and dead if the parent never reads —
  the subagent's notification effectively gets lost when the parent is asleep
  and gets restarted with a fresh active session.
- **Accept the race** (let both processes write, dedupe downstream): the
  "events.jsonl has globally unique increasing seqs" invariant is relied on by
  message rebuilding, the watermark logic, and every event-log consumer.
  Breaking it would cascade.
- **A dedicated cross-process RPC** (`ent/session/inject_notification`,
  `ent/agent/prepare_shutdown`): we prototyped this. It worked, but the subagent
  already had a `session/update` channel to its parent — adding a second channel
  was strictly more surface area. The existing channel was cleaner.

## 9. Failure modes and best-effort delivery

| Failure                                                | Outcome                                                                                                            | Notes                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subagent SIGKILL / OOM / hard crash                    | `subagent-exited` notification is lost. Job-level `job-failed` notification still fires via the lifecycle path.    | The shutdown hook never runs, so no `pending_reminders_on_exit` notify is sent. Documented loss; not worth the complexity to recover.                                                          |
| Notifier callback throws                               | Reminder scheduler catches and still completes the state transition.                                               | Bug 2 fix. Avoids stranding rows in `'firing'` indefinitely.                                                                                                                                   |
| Composer throws                                        | Propagates.                                                                                                        | Composers are pure functions over typed inputs; failure means a producer constructed bad input. Caller paths run inside `runExclusive`; the mutex still releases via the `finally` in step §7. |
| Runner aborts mid-turn                                 | Immediate-inject event survives in `events.jsonl`.                                                                 | Next `run()`'s `findLastTurnEndEventSeq` watermark picks it up. Abort does not change the last `turn_end` position.                                                                            |
| Parent's peer closed before subagent emits exit notify | Notify is fire-and-forget; payload is lost.                                                                        | Subagent-job teardown (`subagent-job.ts:890-913`) waits up to 3s post-SIGTERM for the subagent to exit before closing the peer — the graceful-shutdown window.                                 |
| `state.json` stale or corrupt                          | `injectNotification` falls back to seq 1 in the read; `appendDurableEvent` re-derives the seq from `events.jsonl`. | `readSessionStateBestEffort` and `deriveNextEventSeqFromEventLog` are the layered defenses.                                                                                                    |

## 10. Wire shape: kinds, attributes, bodies

See `docs/features/notifications.md` for the full reference. Architecturally
relevant decisions:

- **XML-ish wrappers, not JSON or plain text**: LLMs reliably parse XML-shaped
  structure (we use it elsewhere — `<system-reminder>`, `<bad>` / `<good>`). The
  `kind` attribute is a machine-parseable discriminator; identifier attributes
  are machine-parseable identifiers; the body is prose the model reads.
- **Attribute escaping**: `&`, `<`, `>`, `"` only. We do not escape `'` because
  we use double quotes for attribute values (`notification-wrapper.ts:19-25`).
- **Empty-string identifier drop**: `subagent-exited` notifications from a
  persona-less subagent omit the `persona=""` attribute rather than emitting it
  empty. Implementation: `notification-wrapper.ts:31`.
- **Body is prose, not labeled fields**: composers emit sentences a human could
  read. Lists get a short prose preamble plus indented bullets. Terminal calls
  end with the next-step tool-call hint (`Call job_output(jobId="...")`,
  `call delegate(resume="...")`).

## 11. Adding a new kind

1. Add the kind to the `NotificationKind` union in
   `packages/agent/src/notifications/notification-wrapper.ts:4-11`.
2. Add a composer to `packages/agent/src/notifications/composers.ts`. Pure
   function. Returns the prose body. Use `formatAbsoluteTime` for any time
   display, never raw `toISOString()` or locale strings.
3. Add a snapshot test to
   `packages/agent/src/notifications/__tests__/composers.test.ts` covering each
   input variant.
4. From the producing module, call:
   ```ts
   injectNotification({
     sessionDir,
     kind: 'your-new-kind',
     identifiers: { /* keep keys kebab-case */ },
     body: composeYourBody({...}),
     idleWake,  // pass when writing to the active session of this process
   });
   ```
5. Update `docs/features/notifications.md` (user-facing reference).
6. Update this doc if you introduce a new failure mode worth calling out.

## 12. Open questions and known limitations

- **Per-active-session scheduler**: `ensureReminderSchedulerForActiveSession`
  (`server.ts:168-225`) is idempotent and awaits `stop()` on the old scheduler
  before starting a new one (Bug 4 fix). Switching sessions drains the old
  scheduler's in-flight `setTimeout` before the new one starts. The
  intra-process mutex naturally resets because each scheduler is bound to one
  session dir.
- **Subagent graceful exit is best-effort**: documented in §9 and in the spec.
  Hard crashes lose the `subagent-exited` notification. Recovery would require a
  sidecar file convention or a parent-side reconciliation pass on subagent-job
  completion; we chose simplicity.
- **No cross-process write path exists by design**: if a future feature needs to
  land an event into another process's session, it must route through that
  process's RPC peer (today: `session/update` discriminants). Adding a
  `flock`-style writer is on the "do not without strong reason" list.
