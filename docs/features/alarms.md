# Alarms

Lace agents can schedule alarms that wake them with a prompt at a future time — as a cron-recurring schedule, a one-shot (absolute or relative), or a repeating interval. Alarms are owned per-session: each session has its own `alarms.json` next to `events.jsonl`.

## Tools

Three built-in tools, available to every persona that includes lace built-ins:

| Tool | Purpose |
| --- | --- |
| `schedule_alarm` | Create a new alarm (cron, one-shot absolute, one-shot relative, or interval) |
| `cancel_alarm` | Cancel a pending alarm by id |
| `list_alarms` | List pending/firing alarms for the current session |

### `schedule_alarm` parameters

The accepted shape depends on `kind`:

**`kind: 'once'`** — one-shot alarm. Exactly one of:
- `schedule`: ISO-8601 absolute timestamp (e.g. `'2026-12-25T09:00:00Z'`)
- `minutes`: positive integer — relative delay from now (e.g. `5` → 5 minutes from now)

Body wording:
- absolute → `Your alarm for 2026-12-25T09:00:00+00:00 (UTC) just fired. Note: "..."`.
- relative → `Your 5-minute timer just fired. Note: "..."`.

**`kind: 'cron'`** — recurring on a calendar schedule.
- `schedule`: cron expression (5 fields, min interval 1 hour) e.g. `'0 9 * * *'`
- `timezone`: IANA name (required) e.g. `'America/Los_Angeles'`
- `endTime` (optional): ISO-8601 absolute. After this time, the alarm expires (see "Expiry" below).

Body: `Your cron alarm <id> (<expr> in <tz>) just fired. Note: "..."`.

**`kind: 'interval'`** — recurring every N minutes from now.
- `minutes`: positive integer ≥ 5 (the minimum interval)
- Exactly one of (optional, mutually exclusive):
  - `endTime`: ISO-8601 absolute end time
  - `durationMinutes`: positive integer — total runtime in minutes from creation

Body: `Your interval alarm <id> (every N minutes) just fired. Note: "..."`.

Cap: 50 active alarms per session.

## Expiry

Cron and interval alarms with an `end_at` (set via `endTime` or `durationMinutes`) expire when their next scheduled fire would exceed the end time. On expiry, lace writes a `<notification kind="alarm-expired" alarm-id="...">` block into the session and **deletes** the row from `alarms.json` — it no longer appears in `list_alarms`.

`end_at` is INCLUSIVE: a fire whose `next_fire_at` exactly equals `end_at` still fires. The alarm expires when computing the NEXT fire (because next would be > end_at). This means `{ kind: 'interval', minutes: 5, durationMinutes: 5 }` is a valid "fire once then expire" pattern — the alarm fires at +5 min and expires when the scheduler computes the next fire at +10 min > end_at.

Body: `Your cron alarm <id> (<expr> in <tz>) reached its end time (<formatted-time>) and won't fire again. Last note: "..."`.

(Or the equivalent interval variant.)

## Fire path

When an alarm fires, lace writes a `context_injected` durable event with `priority='immediate'` to the session's `events.jsonl`. The content is a `<notification kind="alarm-fired" alarm-id="...">` block. The conversation runner's existing immediate-inject pickup folds it into the next turn as a `role: 'user'` message.

If the agent is idle when the alarm fires, lace triggers an internal turn so the agent processes the notification immediately. A post-turn rescan also catches alarms that fired in the closing microseconds of a turn (so the wake is never lost).

## Lifetime

Alarms fire only while the owning lace process is alive. There is no cross-process scheduler. Subagent alarms fire only while the subagent's lace process is running. On graceful subagent shutdown with pending alarms, lace forwards them to the parent via a `session/update` notification carrying `type: 'pending_alarms_on_exit'`; the parent's relay composes a `<notification kind="subagent-exited">` block and injects into its own session.

## Storage

`<LACE_DIR>/agent-sessions/<sessionId>/alarms.json` — single JSON snapshot, atomically rewritten via `atomicWriteJson` on every state change. Bounded (~10 KB at the 50-alarm cap). Boot recovery reads the file and rebuilds the in-memory min-heap.

Each row stores its `spec` (the structured user input — `once-absolute` / `once-relative` / `cron` / `interval`), `timezone`, `prompt`, `status`, `next_fire_at`, `end_at`, and lifecycle timestamps. The `spec` drives both the next-fire computation and the notification body wording at fire/expiry time.
