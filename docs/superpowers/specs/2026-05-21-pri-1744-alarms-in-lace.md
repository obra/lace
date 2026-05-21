# PRI-1744: Move alarms into lace, per-session storage

**Status:** Design spec
**Linear:** https://linear.app/prime-radiant/issue/PRI-1744
**Author:** Bot (with Jesse)
**Date:** 2026-05-21

## Problem

Sen-core today owns the alarm subsystem:

- `sen-core-v2/src/alarms/{store,scheduler-service,tools,types,cron}.ts` implement the SQLite store, scheduler loop, MCP tool surface, and cron math.
- `sen-core-v2/mcp-servers/scheduler.ts` exposes `schedule_alarm`/`cancel_alarm`/`list_alarms` as a stdio MCP subprocess that lace spawns inside the persona container.
- `sen-core-v2/src/main.ts:574-590` instantiates a second `AlarmsStore` handle on the same SQLite file and runs the in-process `SchedulerService.run()` loop that turns due alarms into `InboundAlarm` items via the dispatcher.

Both handles target `/var/sen/instance/alarms/alarms.db` (a bind-mounted host file). Cross-process WAL across a bind-mount is the root cause of the sporadic disk-I/O errors (sen-core-v2#46) and one-shot-vanishing behaviour (sen-core-v2#45). It also forces a 5-second backstop poll because the MCP subprocess can't `notify()` the in-process scheduler in another container.

A second, longer-horizon constraint: sen-box and other personas will soon need their own alarms. Today they would share Ada's `alarms.db` via the wide `LACE_DIR` mount — wrong scope.

## Goal

Move alarm storage, scheduling, and tool surface into lace. Each lace session gets its own `alarms.jsonl` next to `events.jsonl`. Alarm fires become a new `DurableEvent` type appended to the target session's events log; the embedder picks them up through the existing `onSessionUpdate` fanout. No cross-process SQLite, no bind-mounted DB, no new subscription primitive.

## Verified constraints (from the code, 2026-05-21)

These shape the design and must hold for it to work:

1. **Session IDs are stable for the life of the session.** Rotation in `sen-core-v2/src/rotation/runner.ts:166` is implemented as `ent/session/compact` — same session, new `context_compacted` event appended. There is no "rotation creates a new session" code path.
2. **Sen-core persists its core session id and resumes it across restarts.** `sen-core-v2/src/main.ts:309-325` reads `<instance-root>/history/core-session-id` and calls `client.sessionResume({ sessionId })`. First-boot writes the file. The session-id binding alarms need is already enforced.
3. **One lace runtime hosts many sessions, sharing one `LACE_DIR`.** The parent's session and every subagent session live under `<LACE_DIR>/agent-sessions/<sessionId>/`. Only one session is *active* at a time (`state.activeSession`), but inactive sessions still own a session directory.
4. **`appendDurableEvent(sessionDir, ...)` is path-keyed**, not active-session-keyed. It opens `events.jsonl`, derives the next `eventSeq` from the log itself, and appends. It works for any session directory, active or not. (`packages/agent/src/storage/event-log.ts:84`.)
5. **Subagent sessions are spawned by lace.** `packages/agent/src/jobs/subagent-spawn.ts` owns the persona-container / native-child spawn machinery. Each delegate job records a `job_started` then a `job_session_assigned` event in the parent's `events.jsonl` linking the spawning `jobId` to the subagent's `sessionId`.

## Architecture

### Per-session storage

```
<LACE_DIR>/agent-sessions/<sessionId>/
  meta.json
  state.json
  events.jsonl       # existing
  alarms.jsonl       # NEW
```

`alarms.jsonl` is an append-only log of alarm records. Each row is a complete record; status transitions append a new row with the same `id` and the new status. The latest-by-`id` wins on replay. (Same shape as `events.jsonl` — append-only, JSON-per-line, no in-place mutation.)

Row schema:

```ts
type AlarmRow = {
  id: string;                         // alarm_<12 hex>
  kind: 'cron' | 'once';
  schedule: string;                   // cron expr OR ISO-8601 timestamp
  timezone: string;                   // IANA tz name; UTC for unspecified once
  prompt: string;
  ifSessionEnded: 'drop' | 'wake' | 'bubble';  // NEW, default 'drop'
  next_fire_at: number;               // epoch ms
  status: 'pending' | 'firing' | 'fired' | 'cancelled';
  created_at: number;                 // epoch ms
  fired_at: number | null;            // epoch ms; null until first fire
  delivered_at: number | null;        // NEW; epoch ms when alarm_fired event was emitted as session/update
};
```

`delivered_at` exists so the scheduler can replay alarm fires that occurred while the target session was inactive: when the session next becomes active (`session/load` or `session/resume`), lace emits `session/update` for every alarm row with `status='fired'` and `delivered_at=null`, then appends a follow-up alarm-row with `delivered_at` set.

### Boot recovery

On lace startup, `AlarmScheduler.start()`:

1. Lists `agent-sessions/*/` directories.
2. For each, reads `alarms.jsonl` and folds it to the latest-by-id state.
3. For each `pending` (or stuck `firing`) row, inserts `{ sessionId, alarmId, next_fire_at }` into an in-memory min-heap keyed by `next_fire_at`.
4. Runs the stale-recurring sweep (port of `SchedulerService.runStaleSweep`): cron rows whose `next_fire_at` is more than 60 s in the past are silently rescheduled to the next occurrence after `now`. One-shots are left alone — past one-shots fire on the next tick.
5. Begins the main loop (see "Scheduler loop" below).

`firing` rows on startup are interpreted as "we claimed but crashed before completing the fire" — treated as `pending` and re-queued, so a crash mid-fire results in at most a duplicate fire, never a lost fire.

### Scheduler loop

Single loop per lace runtime. Same shape as the current `SchedulerService.tick`:

```
loop:
  if heap empty:
    sleep(BACKSTOP_POLL_MS=5000) OR until notify()
    continue
  peek soonest:
    if next_fire_at > now: sleep(min(diff, BACKSTOP_POLL_MS)) OR notify(); continue
    fire(soonest)

fire(row):
  - atomic claim: append `{ ...row, status: 'firing' }` to alarms.jsonl if latest row is still 'pending'
  - if claim lost (someone else moved it): skip
  - appendDurableEvent on target session: { type: 'alarm_fired', data: { id, alarmKind, prompt, schedule, fired_at } }
  - if target session is the active session: emitSessionUpdate({ type: 'alarm_fired', ... }) and append { ...row, status: 'fired', fired_at, delivered_at: now } to alarms.jsonl
  - if target session is inactive: append { ...row, status: 'fired', fired_at, delivered_at: null }
  - if kind === 'cron': append { ...row, status: 'pending', next_fire_at: <next jittered occurrence>, fired_at, delivered_at }
  - re-insert into heap if cron
```

`notify()` wakes the loop early when a new alarm is scheduled in-process — same shape as today's notify, just no cross-process boundary anymore.

`MAX_ACTIVE_ALARMS = 50` is enforced per-session (counted from `alarms.jsonl` folded state).

### Fire delivery

Two paths, picked at fire time by checking whether the target session is the active session.

**Target session is active (the common case):**

1. Append `alarm_fired` event to `<sessionId>/events.jsonl` via `appendDurableEvent`. This is durable.
2. Emit `session/update` with the same payload. Sen-core's `onSessionUpdate` handler receives it on the live JsonRpcPeer.
3. Append the `fired` alarm row to `alarms.jsonl` with `delivered_at=now`.
4. Sen-core's existing dispatcher translates `alarm_fired` → `InboundAlarm` → inbox enqueue → ambient loop wake → next turn includes the `<alarm>` block in the prompt.

**Target session is inactive (rare but real — e.g., subagent that finished and its session is dormant, or sen-core crashed and hasn't resumed yet):**

1. Append `alarm_fired` event to `<sessionId>/events.jsonl` — durable, unchanged shape.
2. Append the `fired` alarm row to `alarms.jsonl` with `delivered_at=null`.
3. No `session/update` emitted (no live transport to deliver to for this session).

When the session becomes active again (`session/load`, `session/resume`, or in the `wake` flow described below): lace scans `alarms.jsonl` for rows with `status='fired'` and `delivered_at=null`. For each, it emits `session/update { type: 'alarm_fired', ... }` and appends an updated row with `delivered_at=now`. This is the "normal replay" — embedder receives undelivered fires through the same `onSessionUpdate` callback it always uses.

### `alarm_fired` durable event

New entry in `DurableEventData` (`packages/agent/src/storage/event-types.ts`):

```ts
export type AlarmFiredEventData = {
  type: 'alarm_fired';
  id: string;
  alarmKind: 'cron' | 'once';
  prompt: string;
  schedule: string;
  fired_at: number;   // epoch ms
};
```

Surfaced through the existing `session/update` discriminated union. New `SessionUpdate*Schema` in `packages/ent-protocol/src/schemas/methods.ts`:

```ts
const SessionUpdateAlarmFiredSchema = z.object({
  type: z.literal('alarm_fired'),
  id: NonEmptyStringSchema,
  alarmKind: z.enum(['cron', 'once']),
  prompt: z.string(),
  schedule: z.string(),
  fired_at: z.number(),
}).strict();
```

Add `SessionUpdateAlarmFiredSchema` to `SessionUpdateInnerNonJobSchema`, `_SessionUpdateInnerSchema`, and `SessionUpdateParamsSchema`.

### `if_session_ended` semantics

Per-alarm policy for what happens at fire time when the **session-id this alarm was scheduled against is no longer recoverable**. "No longer recoverable" means the session directory was removed (e.g., a subagent that completed and was cleaned up). It does NOT mean "session is currently inactive" — inactive sessions are handled by the deliver-on-activate path above.

Three values:

| value | top-level session | subagent session |
| --- | --- | --- |
| `drop` (default) | ✅ allowed; alarm is discarded silently | ✅ allowed; alarm is discarded silently |
| `wake` | ❌ rejected at schedule-time (`WakeInvalidForTopLevel`) | ✅ allowed; lace respawns the subagent |
| `bubble` | ❌ rejected at schedule-time (`BubbleInvalidForTopLevel`) | ✅ allowed; alarm is delivered to the parent session |

**Determining if a session is a subagent:** `meta.json` gains an optional `parent` field, written when lace creates a subagent session via the delegate path:

```ts
type SessionMeta = {
  sessionId: string;
  workDir: string;
  created: string;
  parent?: {
    sessionId: string;     // parent session id
    jobId: string;         // delegate job id that spawned us
    personaName?: string;  // persona that ran (for wake)
    runtime?: PersonaContainerRuntime | PersonaBoxRuntime;  // serialized spec for re-spawn
  };
};
```

`parent` is set in `subagent-job.ts` at the moment the subagent session is created (around the existing `client.sessionNew` call path), captured from the spawn options. Missing `parent` field means top-level session.

**`wake` flow (subagent only):**

1. Scheduler fires the alarm, but target session dir is gone.
2. Scheduler reads the *most recent* `alarms.jsonl` row to recover the alarm's original session's meta — but meta is gone too. Solution: when an alarm is scheduled with `wake` or `bubble`, the alarm row carries a copy of the meta's `parent` snapshot. The alarm record gains:
   ```ts
   parent?: {
     sessionId: string;
     jobId: string;
     personaName?: string;
     runtime?: ...;
   };
   ```
   Captured at schedule-time. Frozen — does not track later edits to meta.
3. Lace re-spawns the persona using `runtime` via existing `spawnSubagent()` plumbing. The new subagent comes up with a **new** session id.
4. The `alarm_fired` event is appended to the *new* session's `events.jsonl`. The `session/update` fires once the new session becomes active.
5. The original session dir stays gone. The alarm row is marked `fired`; if cron, the next occurrence is also bound to the new session id (subsequent fires go to the new session).

Edge case: if `runtime` is unavailable (e.g., persona spec evicted), wake degrades to `drop` with a warning log. Documented behavior.

**`bubble` flow (subagent only):**

1. Scheduler fires the alarm, but target session dir is gone.
2. Scheduler reads the alarm row's `parent.sessionId`.
3. Appends `alarm_fired` to the **parent** session's `events.jsonl` (and emits `session/update` if parent is active, or queues delivery via the inactive-session replay).
4. The `alarm_fired` event carries an additional `bubbled_from` field so the parent can tell it's a bubble:
   ```ts
   { type: 'alarm_fired', id, alarmKind, prompt, schedule, fired_at,
     bubbled_from?: { sessionId: string; personaName?: string } }
   ```
5. If the parent session is also gone, bubble degrades to `drop` with a warning log.

For cron alarms in `bubble` mode: subsequent fires also bubble to the parent. The cron alarm row stays bound to its (defunct) origin session-id; the scheduler keeps reading its `parent` pointer.

### Tool surface

Three first-class lace tools in `packages/agent/src/tools/implementations/`:

- `schedule_alarm.ts`
- `cancel_alarm.ts`
- `list_alarms.ts`

Input / output shape preserved exactly from `sen-core-v2/src/alarms/tools.ts`, plus the new `ifSessionEnded` parameter on `schedule_alarm`:

```ts
const scheduleInputShape = {
  kind: z.enum(['cron', 'once']),
  schedule: z.string().min(1),
  prompt: z.string().min(1),
  timezone: z.string().optional(),
  ifSessionEnded: z.enum(['drop', 'wake', 'bubble']).optional().default('drop'),  // NEW
};

const scheduleOutputShape = {
  id: z.string(),
  kind: z.enum(['cron', 'once']),
  schedule: z.string(),
  prompt: z.string(),
  timezone: z.string(),
  ifSessionEnded: z.enum(['drop', 'wake', 'bubble']),
  next_fire_at_iso: z.string(),
};
```

**Validation at schedule time:**

- Cron expression: existing `assertValidCronMinInterval` (min 1 hour) and `assertValidIanaTimezone`.
- One-shot: existing `computeNextOnceFire` (ISO-8601 in the future).
- `MAX_ACTIVE_ALARMS=50` per session.
- If `ifSessionEnded` is `wake` or `bubble` and the calling session has no `parent` field in `meta.json`, reject with `WakeInvalidForTopLevel` / `BubbleInvalidForTopLevel` (structured tool error).
- If `ifSessionEnded` is `wake` and `parent.runtime` is undefined (e.g., a subagent spawned without a persona spec, which is unusual but possible), reject with `WakeRequiresPersonaRuntime`.

**Tool execution context:** all three tools resolve the calling session as the current `state.activeSession` (the tool always runs in the context of an active session). The `AlarmStore` accessor for that session is `<state.activeSession.dir>/alarms.jsonl`.

**Tool annotations:** `schedule_alarm` is destructive (`destructive: true`, `safeInternal: false`); approval gate matches the existing alarm tool semantics. `cancel_alarm` is destructive. `list_alarms` is read-only (`readOnlySafe: true`).

### AlarmStore + AlarmScheduler in lace

Two new files in `packages/agent/src/alarms/`:

- `alarm-store.ts` — `class AlarmStore` wraps a per-session `alarms.jsonl`. Methods: `insert`, `cancel`, `listActive`, `countActive`, `claim`, `markFired`, `rescheduleCron`, `markDelivered`, `findUndelivered`. Implementation is JSONL append + in-memory fold (rebuilt on construction).
- `alarm-scheduler.ts` — `class AlarmScheduler` runs the single loop. Holds the in-memory min-heap, the per-session `AlarmStore` map, and the emit hook. Started during server initialization (after session storage is available, before tool execution can begin).

Cron math (`computeNextCronFire`, `computeNextOnceFire`, `assertValid*`) ports verbatim from `sen-core-v2/src/alarms/cron.ts` to `packages/agent/src/alarms/cron.ts`.

Wiring in `server.ts`:

```ts
state.alarmScheduler = new AlarmScheduler({
  sessionsDir: agentSessionsDir(),
  jitterMaxMs: resolveAlarmJitterMs(state.config.env),
  now: () => Date.now(),
  emitToActive: (targetSessionId, update) => {
    if (state.activeSession?.meta.sessionId === targetSessionId) {
      return emitSessionUpdate(update);
    }
    return Promise.resolve();
  },
  appendEvent: (sessionDir, event) => {
    // Reuses runExclusive for active session; direct append for inactive.
    if (state.activeSession?.dir === sessionDir) {
      return runExclusive(() => {
        const s = readSessionState(sessionDir);
        const { nextState } = appendDurableEvent(sessionDir, s, event);
        writeSessionState(sessionDir, nextState);
      });
    }
    const s = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, s, event);
    writeSessionState(sessionDir, nextState);
    return Promise.resolve();
  },
  spawnSubagentForWake: spawnSubagent,  // from jobs/subagent-spawn
});
state.alarmScheduler.start();
```

Session activation (`activateStoredSession` in `rpc/handlers/session.ts`): after `state.activeSession = ...`, call `state.alarmScheduler.flushUndelivered(state.activeSession.meta.sessionId)`. This replays any undelivered alarm fires as `session/update` notifications and marks them delivered.

`ToolContext` gains an `alarmScheduler` field so the three tools can call `state.alarmScheduler.schedule({ sessionId, ...args })` etc.

## Ent-protocol changes

Single surface change: one new `SessionUpdate` discriminant.

**`packages/ent-protocol/src/schemas/methods.ts`:**

- Add `SessionUpdateAlarmFiredSchema` (see schema above).
- Add it to `SessionUpdateInnerNonJobSchema`, `_SessionUpdateInnerSchema`, and `SessionUpdateParamsSchema`.
- Export `SessionUpdateAlarmFired` type.

**`packages/ent-protocol/src/errors.ts`:** no new error codes required. Wake/bubble rejections are tool-execution errors (returned as `{ isError: true, content: [...] }`), not RPC errors. If we later decide they should be RPC-level, we'd add `WakeInvalidForTopLevel` and `BubbleInvalidForTopLevel` to `EntErrorCodes`; out of scope for this ticket.

No changes to `session/new`, `session/load`, `session/resume`, `session/list`, `session/close`, `session/fork`, or any other method. No new methods. No name primitive. No name field on any schema.

## Sen-core changes

**Delete:**

- `sen-core-v2/src/alarms/store.ts`
- `sen-core-v2/src/alarms/scheduler-service.ts`
- `sen-core-v2/src/alarms/tools.ts`
- `sen-core-v2/src/alarms/cron.ts` (ported into lace; the sen-core copy goes)
- `sen-core-v2/mcp-servers/scheduler.ts`
- `sen-core-v2/tests/automated/alarms/` (replaced by lace's tests)

**Keep:**

- `sen-core-v2/src/alarms/types.ts` — `InboundAlarm` shape stays as the inbox envelope discriminator. Optionally trimmed to just the inbox envelope (no store-side types).

**Update:**

- `sen-core-v2/src/main.ts:574-590` — remove `alarmsDir`/`mkdirSync`/`AlarmsStore`/`SchedulerService`/`schedulerPromise`. The dispatcher's existing inbox-enqueue path for `InboundAlarm` stays.
- Extend `attachClientSubscriptions` (around `sen-core-v2/src/main.ts:204`) to recognize `update.type === 'alarm_fired'` and translate to an `InboundAlarm` for `dispatcher.dispatch(...)`. The mapping is direct: `id`, `alarmKind`, `prompt`, `schedule`, `fired_at` → same fields on `InboundAlarm`. `bubbled_from`, if present, is folded into the alarm prompt (e.g., a leading `[from subagent <name>]` line) — let sen-core decide how it surfaces.
- `sen-core-v2/templates/agent-personas/core.md` — remove the `scheduler:` MCP server entry (lines 8-14).
- `sen-core-v2/src/slack/envelope.ts` — no change. `InboundAlarm` shape is unchanged.

## Test surface

### Lace tests

**Unit (`packages/agent/src/alarms/__tests__/`):**

- `alarm-store.test.ts` — JSONL fold semantics: insert, cancel, claim, markFired, rescheduleCron, markDelivered. Replay-on-construction parity (state matches a fresh fold). MAX_ACTIVE_ALARMS=50 cap.
- `alarm-scheduler.test.ts` — fake clock + fake sleep: soonest-pending math, notify wakes the loop, stale-recurring sweep, claim contention (only one claim per fire). Boot recovery from a mixed alarms.jsonl.
- `cron.test.ts` — port the existing `sen-core-v2/tests/automated/alarms/cron.test.ts` and `assertValid*` tests.

**Unit (`packages/agent/src/tools/implementations/__tests__/`):**

- `schedule_alarm.test.ts` — valid cron, valid one-shot, invalid tz, invalid cron interval, cap exceeded, `ifSessionEnded='wake'` rejected on top-level session, `ifSessionEnded='bubble'` rejected on top-level session, both accepted on a subagent session.
- `cancel_alarm.test.ts` — port from sen-core's `cancel_alarm` tests.
- `list_alarms.test.ts` — port; verifies pending+firing rows are returned in `next_fire_at` order; fired/cancelled excluded.

**Integration (`packages/agent/src/__tests__/`):**

- `alarms.fire-delivery.e2e.test.ts` — schedule one-shot via lace tool, advance fake clock, verify `alarm_fired` lands in `events.jsonl` AND `session/update` is emitted to the connected peer.
- `alarms.inactive-session-replay.e2e.test.ts` — create session A, schedule alarm, close A, advance clock so alarm fires (lace's scheduler appends to A's events.jsonl while inactive), reopen A via `session/resume`, verify `session/update` is replayed with `alarm_fired`.
- `alarms.restart-recovery.e2e.test.ts` — schedule alarm, kill lace process, restart, advance clock, verify alarm still fires (boot recovery scanned `alarms.jsonl`).
- `alarms.wake-subagent.e2e.test.ts` — spawn a subagent that schedules an alarm with `ifSessionEnded='wake'`, complete the subagent (session dir gone), advance clock, verify lace respawns the subagent and the new subagent's events.jsonl receives the `alarm_fired` event.
- `alarms.bubble-subagent.e2e.test.ts` — spawn a subagent, schedule alarm with `ifSessionEnded='bubble'`, end subagent (session dir gone), advance clock, verify parent session receives `alarm_fired` with `bubbled_from`.
- `alarms.top-level-rejects-wake-bubble.e2e.test.ts` — top-level session calls `schedule_alarm` with `ifSessionEnded='wake'` and `'bubble'`; both are tool-level errors.
- `alarms.cron-reschedule.e2e.test.ts` — cron alarm fires, scheduler reschedules with jitter, verifies a second fire happens at the rescheduled time.

### Sen-core tests

- `tests/automated/alarms-inbound.e2e.test.ts` — given a fake `alarm_fired` `session/update`, sen-core's `attachClientSubscriptions` dispatches an `InboundAlarm` to the inbox dispatcher.
- Delete `tests/automated/alarms/` (the old store/scheduler tests). Their behavior is now covered by lace's tests.

## Documentation updates

**`docs/protocol-spec.md`** (lace top-level docs): add `alarm_fired` to the `SessionUpdate` event catalogue. Cover `bubbled_from` field semantics.

**`docs/protocol-conformance.md`**: confirm/extend the conformance list to include `alarm_fired`.

**New** `docs/features/alarms.md`: short overview of the alarm tool surface and `if_session_ended` semantics. Cross-link to `schedule_alarm` tool documentation.

**Tool docs:** confirm location with the implementer (likely the long `description` field on each Tool class is the source of truth, mirroring `delegate.ts` and `job_notify.ts`).

**`docs/about-the-protocol.md`**: brief mention if the document calls out the durable-event types catalog.

The implementer must verify each location; this spec lists the likely targets, not a contract.

## Out of scope

- Session naming as a first-class concept (the original PRI-1744 design). Sen-core's session-id persistence is sufficient.
- Session-id rotation / "new session on rotation."
- Catastrophic session-loss recovery (corrupted `core-session-id`, deleted session dir).
- Migrating Ada's existing `alarms.db` rows — accepted loss per the ticket.
- `ent/alarms/list` or other RPC for inspecting alarms from outside the agent context — operator tooling can read `alarms.jsonl` directly for now.
- Cancellation across subagent boundaries (top-level cancelling a subagent's alarm). Out of scope; `cancel_alarm` only sees alarms in the calling session's `alarms.jsonl`.

## Open implementation questions (deferrable to plan)

- Exact placement of `state.alarmScheduler.start()` in the server bootstrap (must be after session storage is reachable, before `peer.onRequest('session/...')` handlers can route schedule calls). The plan will pick this precisely.
- Whether `alarms.jsonl` needs the same partial-write defense as `events.jsonl` (newline-terminator check). Lace inherits the pattern; the plan should reuse `appendDurableEvent`'s newline guard.
- Folding strategy efficiency: read-whole-file on every store construction is cheap for 50 rows; if it becomes hot, switch to a snapshot file. Out of scope to optimize up front.
