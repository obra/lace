# PRI-1744: Alarms in lace, per-session, with a unified notification shape

**Status:** Design spec (revised 2026-05-21 — supersedes the earlier `if_session_ended`/agent-names framing)
**Linear:** https://linear.app/prime-radiant/issue/PRI-1744
**Author:** Bot (with Jesse)

## Problem

Sen-core owns the alarm subsystem today:

- `sen-core-v2/src/alarms/{store,scheduler-service,tools,types,cron}.ts` implement the SQLite store, scheduler loop, MCP tool surface, and cron math.
- `sen-core-v2/mcp-servers/scheduler.ts` runs as a stdio MCP subprocess that lace spawns inside the persona container, opening its own `AlarmsStore` handle on `/var/sen/instance/alarms/alarms.db`.
- `sen-core-v2/src/main.ts:574-590` holds a second handle on the same SQLite file and runs the in-process `SchedulerService.run()` loop.

Cross-process WAL across a bind-mounted SQLite file is the root cause of the sporadic disk-I/O errors (sen-core-v2#46) and silent one-shot loss (sen-core-v2#45). It also forces a 5-second backstop poll — the MCP subprocess can't `notify()` the in-process scheduler in another container.

Forcing function: sen-box and future personas will need their own alarms. Today they'd share Ada's `alarms.db` via the wide LACE_DIR mount. Per-agent isolation is required before a second persona that schedules alarms ships.

## Goal

Move alarm storage, scheduling, and tool surface into lace, scoped per-session. Each lace process owns its session's alarms; storage is a single per-session `alarms.json` snapshot, atomically rewritten. Alarm fires (and all other agent-facing lace notifications) flow through a single `injectNotification` utility that writes a `context_injected` durable event with `priority='immediate'`. The conversation runner's existing pickup folds that event into the next turn as a `role: 'user'` message. No new ent-protocol surface, no new `DurableEvent` types.

## Verified constraints (from the code, 2026-05-21)

1. **Session IDs are stable for life.** `sen-core-v2/src/rotation/runner.ts:166` rotation = `ent/session/compact`, same session, new `context_compacted` event. No session-id change happens.
2. **Sen-core persists + resumes the same session-id across restarts** (`main.ts:309-325`). Session-id binding alarms need is already enforced.
3. **Process isolation per session.** Each lace session runs in its own lace process. Sen-core spawns a lace child for Ada. Subagents spawn their own lace processes via `packages/agent/src/jobs/subagent-spawn.ts` (native child or in-container `docker exec` / `container exec`). The host's LACE_DIR is shared across these processes via bind-mount.
4. **Conversation runner already reads `context_injected priority='immediate'` between iterations.** `packages/agent/src/core/conversation/runner.ts:71-90` (`readImmediateInjectsSince`) and the call site at `runner.ts:217-227`. It folds the injected text into the next `role: 'user'` message inside the agentic loop. This is the existing primitive we ride.
5. **`atomicWriteJson` exists** at `packages/agent/src/storage/atomic-write.ts:14` — write-tmp-then-rename, used for `meta.json` and `state.json`. We reuse it for `alarms.json`.
6. **`appendDurableEvent(sessionDir, ...)` is path-keyed**, not active-session-keyed (`packages/agent/src/storage/event-log.ts:84`). It works for any session directory in theory; we deliberately do **not** use it across process boundaries (see the architectural invariant in "Subagent exit handling"). All cross-process writes to a session's `events.jsonl` go through an RPC to that session's owning process.

## Architecture

### Tool surface

Three lace native tools in `packages/agent/src/tools/implementations/`, alongside `delegate`/`job_notify`/etc. Ported behavior from `sen-core-v2/src/alarms/tools.ts` minus the (now-dropped) `ifSessionEnded` parameter.

#### `schedule_alarm`

Input shape depends on `kind`:

**`kind: 'once'`** — one-shot alarm. Exactly one of:
- `schedule`: ISO-8601 absolute timestamp
- `minutes`: positive integer (relative delay from now)

Optional: `timezone` (IANA; defaults to `'UTC'` when omitted).

**`kind: 'cron'`** — calendar-recurring. Required: `schedule` (cron expression, min interval 1 hour), `timezone` (IANA). Optional: `endTime` (ISO-8601 absolute; alarm expires when next fire would exceed this).

**`kind: 'interval'`** — repeating every N minutes. Required: `minutes` (integer ≥ `MIN_INTERVAL_MINUTES` = 5). At most one of: `endTime` (ISO-8601 absolute) or `durationMinutes` (positive integer — total runtime from creation).

`prompt` is required for all kinds.

```ts
// success output
{
  id: 'alarm_<12hex>',
  kind: 'once' | 'cron' | 'interval',
  spec: AlarmSpec,          // structured original input — see Storage section
  prompt: string,
  timezone: string,
  next_fire_at_iso: '2026-12-25T09:00:00-08:00 (America/Los_Angeles)',
  end_at_iso: '2027-01-01T00:00:00-08:00 (America/Los_Angeles)' | null,
}

// failure output
{ status: 'failed', content: [{ type: 'text', text: '<reason>' }] }
```

`next_fire_at_iso` and `end_at_iso` are formatted via `formatAbsoluteTime(epochMs, timezone)` — full ISO-8601 with explicit offset plus IANA zone in parens.

Cap: MAX_ACTIVE_ALARMS = 50 active alarms per session.

#### `cancel_alarm`

```ts
// input: { id }
// output: { cancelled: true }
//      OR { cancelled: false, reason: 'not_found'|'already_fired'|'already_cancelled'|'firing' }
```

#### `list_alarms`

```ts
// input: {}
// output: { alarms: Array<{
//   id, kind, spec, prompt, timezone, status,
//   next_fire_at_iso, created_at_iso, end_at_iso
// }> }
```

### Storage

**Per-session snapshot** at `<LACE_DIR>/agent-sessions/<sessionId>/alarms.json`. Single JSON file, atomically rewritten on every state change via `atomicWriteJson`.

```ts
type AlarmSpec =
  | { kind: 'once-absolute'; iso: string }
  | { kind: 'once-relative'; minutes: number }
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; minutes: number };

type AlarmsSnapshot = {
  alarms: Array<{
    id: string;                  // alarm_<12hex>
    kind: 'once' | 'cron' | 'interval';
    spec: AlarmSpec;             // original user input — drives reschedule + body wording
    timezone: string;            // IANA; 'UTC' for once-relative + interval
    prompt: string;
    status: 'pending' | 'firing' | 'fired' | 'cancelled';
    // Note: 'expired' is not a status — expired rows are DELETED from alarms.json.
    next_fire_at: number;        // epoch ms
    created_at: number;          // epoch ms
    fired_at: number | null;     // epoch ms; null until first fire
    end_at: number | null;       // epoch ms; set for cron + interval with endTime/durationMinutes
  }>;
};
```

Bounded: MAX_ACTIVE_ALARMS=50 × ~200 bytes per record ⇒ ~10 KB. Atomic rewrite on every change is cheap. No append-only log, no compaction, no fold-on-replay — boot reads the JSON, snapshot is the state.

Boot recovery:

1. Read `alarms.json` (initialize empty if missing).
2. For each `pending` alarm, insert into in-memory min-heap by `next_fire_at`.
3. Re-queue any `firing` rows as `pending` — interpreted as "claimed but crashed before completing the fire." At-most-once duplicate fire, never lost.
4. Stale-recurring sweep: cron rows whose `next_fire_at` is more than 60 s in the past are silently advanced (via `computeNextCronFire`) to the next occurrence. One-shots are left alone and fire on next tick.

### Scheduler

**Per-lace-process scheduler** in `packages/agent/src/alarms/alarm-scheduler.ts`. Each lace process runs ONE scheduler that owns its session's alarms only — no cross-process coordination, no shared scheduler walking other session dirs.

Loop shape (matches `sen-core-v2/src/alarms/scheduler-service.ts` skeleton):

```
loop:
  if heap empty:                  sleep(BACKSTOP_POLL_MS=5000) OR notify()
  peek soonest:
    if next_fire_at > now:        sleep(min(diff, 5000)) OR notify()
    else:                         fire(soonest)

fire(row):
  - claim row: pending → firing; rewrite alarms.json
  - call notifier → injectNotification({ sessionDir, kind: 'alarm-fired',
                              identifiers: { 'alarm-id': row.id }, body })
    (notifier errors are caught; state transition always completes)
  - if once: status → fired; rewrite
  - if cron: compute next jittered occurrence
      if next > end_at:
        call expiredNotifier → injectNotification({ kind: 'alarm-expired', ... })
        delete row from alarms.json  (no 'expired' status — row is gone)
      else: status → pending, next_fire_at updated; rewrite; re-insert into heap
  - if interval: next_fire_at = firedAt + minutes * 60_000
      if next > end_at:
        call expiredNotifier → injectNotification({ kind: 'alarm-expired', ... })
        delete row from alarms.json
      else: status → pending, next_fire_at updated; rewrite; re-insert into heap
```

`notify()` wakes the loop in-process when `schedule_alarm` inserts a new alarm — same shape as today's `SchedulerService.notify()`, just no cross-process boundary.

### Fire mechanism — `injectNotification`

When the scheduler fires an alarm, it calls a new utility:

```ts
function injectNotification(opts: {
  sessionDir: string;
  kind: NotificationKind;
  identifiers?: Record<string, string>;  // emitted as XML attrs on the wrapper
  body: string;                          // prose body
}): void
```

Effect:

1. Wraps `body` in `<notification kind="..." [attrs]>...body...</notification>`.
2. Appends a `context_injected` durable event with `priority='immediate'` to `<sessionDir>/events.jsonl` (via existing `appendDurableEvent`).
3. If `sessionDir` is the current lace process's active session AND the agent is idle (no active turn), trigger an internal turn so the agent picks up the notification immediately rather than waiting for the next user prompt. (Same pattern as today's `job-notifications.ts:75-89`.)

For a fire targeting THIS process's session: written directly into the session we're already in.

For a `subagent-exited` notification: the subagent never touches the parent's files. On graceful shutdown it emits a `session/update(pending_alarms_on_exit)` notification over its JSON-RPC peer; the parent's per-subagent relay composes the `<notification kind="subagent-exited" ...>` body in the parent's own process and appends a `context_injected priority='immediate'` event to the parent's events.jsonl under `runExclusive`. The parent lace process then picks the event up via its runner's existing immediate-inject loop on the next turn. The subagent does not (and cannot) trigger the parent's internal-turn wake; it relies on the next external prompt or job-lifecycle wake reaching the parent.

#### Conversation runner watermark fix

There is one small, necessary tweak to make the existing pickup work end-to-end for the new "write event while idle then wake" pattern.

Current behavior (`runner.ts:197`): `lastSeenEventSeq = deriveNextEventSeqFromEventLog(sessionDir) - 1`. This snapshots the latest seq at run-start, so any event already written (including a just-written context_injected from injectNotification) is skipped.

Required behavior: the runner needs to see context_injected events written *between turns*. Two equally valid implementations:

- **A.** Make the runner accept an optional `startEventSeq` param; `injectNotification` captures the pre-write watermark and threads it through when it triggers the internal turn. Same for `session/prompt`'s entry point: capture watermark before writing the prompt event, pass to `runner.run()`.
- **B.** Have the runner derive `lastSeenEventSeq` by walking back to the last `turn_end` event (or `0` if none). Any context_injected event newer than the last turn_end is by definition unprocessed.

We pick **B** in this spec because it requires no plumbing changes outside the runner and naturally handles `ent/session/inject` calls that arrived while idle (today silently dropped — pre-existing latent bug closed as a side effect). The first iteration's `readImmediateInjectsSince` reads only events of type `context_injected` with `priority='immediate'`, so the cost is bounded.

### Unified notification shape

All lace-side agent-facing notifications share one wrapper, produced by a single utility.

**Rules:**

- Single wrapper: `<notification kind="..." [identifier-attributes]>...body...</notification>`.
- Identifiers as attributes (`alarm-id`, `job-id`, `subagent-session-id`, `persona`, ...) for machine parsing. XML-escape attribute values.
- Body is prose, not labeled fields. Lists in body get a one-sentence prose preamble plus indented bullets. End with the next-step tool-call hint when applicable.

**Kinds (implemented in `notification-wrapper.ts` + `composers.ts`):**

| `kind` | Identifiers | Composer | Replaces today |
| --- | --- | --- | --- |
| `alarm-fired` | `alarm-id` | `composeAlarmFiredBody` | (new) |
| `alarm-expired` | `alarm-id` | `composeAlarmExpiredBody` | (new) |
| `job-completed` | `job-id` | `composeJobCompletedBody` | `formatJobNotification(type='completed')` |
| `job-failed` | `job-id` | `composeJobFailedBody` | `formatJobNotification(type='failed')` |
| `job-cancelled` | `job-id` | `composeJobCancelledBody` | `formatJobNotification(type='cancelled')` |
| `job-progress` | `job-id` | `composeJobProgressBody` | `formatJobNotification(type='progress')` |
| `subagent-exited` | `subagent-session-id`, `job-id`, `persona` | `composeSubagentExitedBody` | (new) |

**`alarm-fired` body wording by sub-kind:**

```
<notification kind="alarm-fired" alarm-id="alarm_a1b2c3">
Your alarm for 2026-12-25T09:00:00-08:00 (America/Los_Angeles) just fired. Note: "Check the test status board".
</notification>
```

```
<notification kind="alarm-fired" alarm-id="alarm_b2c3d4">
Your 30-minute timer just fired. Note: "Check on the build".
</notification>
```

```
<notification kind="alarm-fired" alarm-id="alarm_c3d4e5">
Your cron alarm alarm_c3d4e5 (0 9 * * * in America/Los_Angeles) just fired. Note: "Morning standup check".
</notification>
```

```
<notification kind="alarm-fired" alarm-id="alarm_d4e5f6">
Your interval alarm alarm_d4e5f6 (every 30 minutes) just fired. Note: "Check build progress".
</notification>
```

**`alarm-expired` body wording (cron or interval reaching `end_at`):**

```
<notification kind="alarm-expired" alarm-id="alarm_c3d4e5">
Your cron alarm alarm_c3d4e5 (0 9 * * * in America/Los_Angeles) reached its end time (2027-01-01T00:00:00-08:00 (America/Los_Angeles)) and won't fire again. Last note: "Morning standup check".
</notification>
```

```
<notification kind="alarm-expired" alarm-id="alarm_d4e5f6">
Your interval alarm alarm_d4e5f6 (every 30 minutes) reached its end time (2026-06-01T00:00:00+00:00 (UTC)) and won't fire again. Last note: "Check build progress".
</notification>
```

Expiry semantics: cron and interval alarms with `end_at` expire when their next computed fire would exceed `end_at`. The expiry check occurs at reschedule time (after the final fire). On expiry: the `expiredNotifier` is called (which calls `injectNotification` with `kind: 'alarm-expired'`), then the row is deleted from `alarms.json`. The row does **not** transition to an `'expired'` status — it is gone.

**`formatAbsoluteTime` helper:**

All time display in notification bodies and tool output goes through `formatAbsoluteTime(epochMs, timezone)` in `packages/agent/src/notifications/format-time.ts`. It returns full ISO-8601 with explicit UTC offset plus IANA zone name in parentheses:

```
2026-12-25T09:00:00-08:00 (America/Los_Angeles)
```

Used by `composeAlarmFiredBody`, `composeAlarmExpiredBody`, the `schedule_alarm` result fields (`next_fire_at_iso`, `end_at_iso`), and `list_alarms` output. This centralizes formatting so all time strings are consistent and unambiguous across notification kinds.

```
<notification kind="job-completed" job-id="job_xyz">
Your background job completed successfully (exit code 0) after 12.3 seconds, writing 15,234 bytes of output. The last line was: "build finished in 5.2s". Call job_output(jobId="job_xyz") to read the full output. To continue this conversation thread, call delegate(resume="job_xyz", prompt="your message").
</notification>
```

```
<notification kind="job-progress" job-id="job_xyz">
Your background job has been running for 5m 12s and has written 142,330 bytes (+8,210 since last update). Recent output:
  building target...
  built dist/cli.js in 3.1s
  built dist/main.js in 5.2s
Call job_output(jobId="job_xyz") to check current output.
</notification>
```

```
<notification kind="subagent-exited" subagent-session-id="sess_abc" job-id="job_xyz" persona="sen-box">
Your sen-box subagent exited gracefully but had 1 pending alarm that won't fire now: alarm_z1z2 was a one-shot scheduled for 2026-05-22T17:00:00Z with the prompt "Check on the running git operation".
</notification>
```

The composer functions are pure and easily unit-tested. They have no side effects — formatting only.

### What this refactors away

The unified shape lets us collapse the existing job-notification queue + flush plumbing:

- `packages/agent/src/jobs/format-notification.ts` (the whole `formatJobNotification` and its `<background-job-notification>` wrapper) is **deleted**, replaced by the composers + `injectNotification`.
- `packages/agent/src/jobs/job-manager.ts`'s `notificationQueue` field, `queueNotification`, `getNotificationQueue`, and `flushNotifications` are **deleted**. Fanout still exists for subscription filtering; it now calls `injectNotification(...)` directly instead of pushing onto a queue.
- `packages/agent/src/jobs/job-notifications.ts`'s `createQueueJobNotification` is rewritten: instead of pushing onto the queue, it composes the body for the kind and calls `injectNotification`. The "trigger internal turn when idle" path is preserved (moved into `injectNotification`).
- `packages/agent/src/rpc/handlers/prompt.ts:102-111` — the `state.jobManager.flushNotifications()` prepend path — is **deleted**. Notifications now arrive as `context_injected` events that the runner picks up on its first iteration (via the watermark fix).

### Subagent exit handling (the courtesy bubble)

When a subagent's lace process shuts down gracefully (SIGTERM during the shutdown sequence, normal stdin EOF, etc., **not** crash):

1. Stop the scheduler loop (so no fires are in flight).
2. Read `<own-sessionId>/alarms.json` from disk (via `AlarmStore.listPending()`).
3. If any rows have `status === 'pending'`:
   - Emit a one-way `session/update` notification on the JSON-RPC peer back to the parent with the `pending_alarms_on_exit` discriminant:
     ```ts
     {
       sessionId: string,
       streamSeq: 0,
       type: 'pending_alarms_on_exit',
       alarms: Array<{
         id: string,
         kind: 'once' | 'cron' | 'interval',
         schedule: string,   // human description via describeSpecForExit(), e.g.
                             // once-absolute → ISO string; once-relative → "in N minutes";
                             // cron → cron expression; interval → "every N minutes"
         prompt: string,
         next_fire_at_iso: string,  // toISOString() of next_fire_at
       }>
     }
     ```
   - No `<notification>` wrapper is built on the subagent side — only structured data leaves the process.
4. Close the peer; exit.

The parent's per-subagent `session/update` relay in `packages/agent/src/jobs/subagent-job.ts` handles the new discriminant. In the parent's own process, the relay:

1. Validates the structured `alarms` array.
2. Composes the `<notification kind="subagent-exited" ...>` wrapper via `buildNotification` + `composeSubagentExitedBody`, using the parent's `job.subagentSessionId`, `job.jobId`, and `job.persona`.
3. Appends a `context_injected` durable event with `priority='immediate'` to the parent's own `<sessionDir>/events.jsonl` under `runExclusive`, then forwards a `session/update(context_injected)` to the client on the top-level peer so the existing inject-observation path works unchanged.

Pending alarms remain in the subagent's `alarms.json` but never fire — no scheduler is running for that session. This is documented as a known limitation (today's behavior is already to lose them).

**Why session/update and not a direct cross-process file write?** Writing to the parent's `events.jsonl` from a different process races with the parent's own runner: both compute `nextEventSeq` from the same on-disk snapshot and write lines with the same seq. The parent's relay runs the durable-event write under the parent runner's `runExclusive` mutex, so all writes to the parent session's `events.jsonl` serialize through one queue in one process.

**Why session/update and not a new RPC?** session/update is already the channel subagents use to push job lifecycle events, tool updates, text deltas, and context injections to the parent. The relay is already factored to dispatch on `type`; adding a new discriminant is a single branch instead of a new RPC method, schema, and handler-registration site.

The parent gives the subagent a window to deliver the notify by ordering its job teardown SIGTERM-first: SIGTERM is sent, the parent waits up to 3 seconds for the child to exit, **then** it closes the JSON-RPC peer. The subagent's natural shutdown handler (run on its own SIGTERM signal handler) emits the `session/update` while the peer is still open.

The intra-process variant of the same race — the `AlarmScheduler`'s notifier firing outside the runner's mutex — is closed by wrapping the scheduler's `injectNotification` call in `runExclusive` from `ensureAlarmSchedulerForActiveSession`. The same `runExclusive` wrap was applied to the top-level `ent/session/inject` handler, which had a pre-existing intra-process race that the factored `injectIntoActiveSession` helper now closes. After this refactor, every writer to the parent's `events.jsonl` (runner, alarm scheduler, top-level inject handler, subagent-exit relay) goes through the same `runExclusive` queue.

### Architectural invariant

**A lace process writes only to its own active session's files.** Cross-session effects — including a subagent informing its parent of unfireable alarms on exit — flow through `session/update` from the subagent to the parent, which the parent's relay translates into local writes in its own process under its `runExclusive` mutex. No subagent writes `events.jsonl`, `alarms.json`, `meta.json`, or `state.json` of a session it does not own.

Crash exit (uncaught exception, SIGKILL, OOM, host kill) does not notify. The parent learns via the existing job-lifecycle path (`job-failed` notification fires when the parent's job-manager detects the subagent process died).

### `SessionMeta.parent`

Add optional `parent` field, written when a subagent session is created:

```ts
type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
  parent?: {
    sessionId: string;       // parent session id
    jobId: string;           // delegate job id that spawned us
    personaName?: string;
  };
};
```

Wired in `packages/agent/src/jobs/subagent-spawn.ts` (and `subagent-job.ts`, where `client.sessionNew` is called against the subagent process): the spawning context already knows `parentSessionId`, `jobId`, and `personaName`; thread these as a new optional `parent` param on `session/new` and persist into the subagent's `meta.json`.

Missing `parent` ⇒ top-level session.

## Ent-protocol changes

**None.** No new methods. No new `DurableEvent` types. No new `SessionUpdate` discriminants. We reuse the existing `context_injected` event type with `priority='immediate'`.

Optionally: add `parent` to `SessionNewParamsSchema` so the subagent's `session/new` call can pass parent linkage through the wire format. (The handler validation already accepts an open shape via `as` casts; adding the field to the schema keeps validation strict.)

## Sen-core changes

These edits expand beyond the previous draft's scope.

**Delete:**

- `sen-core-v2/src/alarms/store.ts`
- `sen-core-v2/src/alarms/scheduler-service.ts`
- `sen-core-v2/src/alarms/tools.ts`
- `sen-core-v2/src/alarms/cron.ts`
- `sen-core-v2/src/alarms/types.ts` (`InboundAlarm` is no longer needed — alarms don't pass through sen-core's inbox; they arrive at Ada's conversation via lace's injection path)
- `sen-core-v2/mcp-servers/scheduler.ts`
- `sen-core-v2/tests/automated/alarms/` (directory)

**Update:**

- `sen-core-v2/src/main.ts:574-590` — remove `alarmsDir`/`mkdirSync`/`AlarmsStore`/`SchedulerService` + the `schedulerPromise` block. Remove related imports.
- `sen-core-v2/src/main.ts` (around `attachClientSubscriptions`, line ~203) — remove any `update.type` branches that referenced alarm handling, if present. (None today — alarms went through the inbox dispatcher, not session/update — but verify.)
- `sen-core-v2/src/slack/envelope.ts` — remove `formatAlarm`, remove the `isInboundAlarm` branch in `formatEnvelope`, narrow the type to `InboundSlackMessage[]`. The envelope formatter is now Slack-only.
- `sen-core-v2/src/slack/types.ts` — remove `InboundAlarm` re-export and `isInboundAlarm`. `InboundItem` becomes a type alias for `InboundSlackMessage` (or the union collapses to a single member).
- `sen-core-v2/src/ambient/inbox-dispatcher.ts` — drop any alarm-branch handling. The dispatcher is Slack-only now.
- `sen-core-v2/src/main.ts` — drop the dispatcher-side alarm wiring. The `dispatcher.dispatch(alarm)` callback that was supplied to `SchedulerService` goes away with the scheduler.
- `sen-core-v2/templates/agent-personas/core.md` — remove the `scheduler` MCP server entry (lines 8-14).

End state: sen-core's inbox is Slack-only. Alarms reach Ada via lace's conversation injection on Ada's session, not via sen-core's inbox dispatcher.

## Documentation updates

- **New section in lace docs** for the alarm tools (`schedule_alarm`, `cancel_alarm`, `list_alarms`) under native tools. Likely path: `docs/features/alarms.md` (new file).
- **New section** describing the unified notification shape (`<notification kind="...">`), the composer pattern, and how to add a new `kind`. Likely path: `docs/features/notifications.md` (new file) or a section in an existing tools doc.
- Sen-core docs note that the in-process scheduler has been replaced by lace's tool-driven model; alarms fire via the conversation injection path. The inbox is Slack-only.

The implementer verifies the exact locations against the lace docs tree (`docs/features/`, `docs/architecture/`, `docs/protocol-spec.md`).

## Test surface

### Lace

**Unit:**

- `packages/agent/src/notifications/__tests__/inject-notification.test.ts`: wrapper escaping, attribute serialization, `context_injected priority='immediate'` write, idle-wake trigger when called with the active session's dir.
- `packages/agent/src/notifications/__tests__/composers.test.ts`: a snapshot for each composer (`alarm-fired`, `job-completed`, `job-failed`, `job-cancelled`, `job-progress`, `subagent-exited`).
- `packages/agent/src/alarms/__tests__/alarm-store.test.ts`: snapshot read/write, `insert`/`cancel`/`claim`/`markFired`/`rescheduleCron`/`listActive`/`countActive`, MAX_ACTIVE_ALARMS=50, boot-from-disk reproduces last-written state.
- `packages/agent/src/alarms/__tests__/alarm-scheduler.test.ts`: fake clock + fake sleep; soonest-pending sequencing; `notify()` wakes early; stale-recurring sweep; claim is at-most-once; cron reschedule; `firing`-on-boot re-queued.
- `packages/agent/src/alarms/__tests__/cron.test.ts`: port of `sen-core-v2/tests/automated/alarms/cron.test.ts`.
- `packages/agent/src/tools/implementations/__tests__/schedule_alarm.test.ts`, `cancel_alarm.test.ts`, `list_alarms.test.ts`: port input-validation suites from sen-core.

**Integration (e2e):**

- `alarms.fire-delivery.e2e.test.ts` — schedule a once alarm, advance fake clock, verify `<notification kind="alarm-fired">` lands in `events.jsonl` and the conversation runner folds it into the next turn (assert by inspecting the provider request).
- `alarms.idle-wake.e2e.test.ts` — schedule alarm while agent is idle, advance clock, verify an internal turn fires automatically.
- `alarms.restart-recovery.e2e.test.ts` — schedule alarm, kill lace process, restart, advance clock, verify alarm still fires (boot reads `alarms.json`).
- `alarms.cron-reschedule.e2e.test.ts` — cron alarm fires, reschedules, fires again at the new time.
- `alarms.subagent-exit-graceful.e2e.test.ts` — spawn subagent S, schedule alarm in S, gracefully shut down S, verify parent's `events.jsonl` gets `<notification kind="subagent-exited">` listing the pending alarm.
- `alarms.subagent-exit-no-pending.e2e.test.ts` — graceful subagent exit with zero pending alarms emits no notification.

**Runner watermark regression:**

- `runner.context-inject.test.ts` (existing): extend to cover the case where a `context_injected priority='immediate'` event is written between turns and must be picked up at the next turn start.

### Sen-core

- Existing alarm test suite is deleted (its responsibility moves to lace).
- Boot smoke test: lace child starts cleanly with no `AlarmsStore`/`SchedulerService` wiring.
- End-to-end: schedule an alarm via lace's tool (driven by a prompt), advance clock, verify Ada's next conversation turn sees the `<notification kind="alarm-fired">` block. (This is best exercised in lace's e2e harness; sen-core's tests can be a thin smoke.)

## Out of scope

- `if_session_ended: wake | bubble` — dropped (D-for-now). Alarms fire only while their owning lace process is alive.
- Session naming / `session/rename` — dropped. Session-id binding is sufficient.
- Crash-on-exit notification for subagents — only graceful exits notify.
- Catastrophic session-loss recovery — separate hardening kata.
- Migrating Ada's existing `alarms.db` rows — accept the loss.
- Operator-side tooling to inspect alarms across sessions — readers can `cat alarms.json` directly for now.

## Open implementation questions (deferrable to the plan)

- Exact placement of `injectNotification`'s idle-wake call site in the server bootstrap. The plan picks this precisely.
- Whether the runner's watermark change (init to last `turn_end`) needs a feature flag for safety. Default: no — it's the obviously-correct semantics, and `runner.context-inject.test.ts` covers regression.
- Whether `findLastTurnEndEventSeq` lives next to `deriveNextEventSeqFromEventLog` in `event-log.ts` (probably yes; small helper).
- Composer line-length / truncation policy — port `formatJobNotification`'s 200-char `MAX_LINE_LENGTH` behavior into the progress composer; leave others natural-length.
