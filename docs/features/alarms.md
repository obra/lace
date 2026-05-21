# Alarms

Lace agents can schedule alarms that wake them with a prompt at a future time, either as a cron-recurring schedule or as a one-shot. Alarms are owned per-session: each session has its own `alarms.json` next to `events.jsonl`.

## Tools

Three built-in tools, available to every persona that includes lace built-ins:

| Tool | Purpose |
| --- | --- |
| `schedule_alarm` | Create a new alarm (cron or one-shot) |
| `cancel_alarm` | Cancel a pending alarm by id |
| `list_alarms` | List pending/firing alarms for the current session |

### `schedule_alarm` parameters

- `kind`: `'cron'` or `'once'`
- `schedule`: cron expression (`0 9 * * *`, min interval 1 hour) or ISO-8601 timestamp (`2030-01-01T09:00:00Z`)
- `prompt`: text the alarm fires with — what the agent's future self should be told
- `timezone`: IANA name (required for cron; defaults to UTC for one-shot)

Cap: 50 active alarms per session.

## Fire path

When an alarm fires, lace writes a `context_injected` durable event with `priority='immediate'` to the session's `events.jsonl`. The content is a `<notification kind="alarm-fired" alarm-id="...">…</notification>` block. The conversation runner's existing immediate-inject pickup folds it into the next turn as a `role: 'user'` message.

If the agent is idle when the alarm fires, lace triggers an internal turn so the agent processes the notification immediately.

## Lifetime

Alarms fire only while the owning lace process is alive. There is no cross-process scheduler. Subagent alarms fire only while the subagent's lace process is running. On graceful subagent shutdown with pending alarms, lace writes a `<notification kind="subagent-exited">` block into the parent session — see [notifications.md](./notifications.md).

## Storage

`<LACE_DIR>/agent-sessions/<sessionId>/alarms.json` — single JSON snapshot, atomically rewritten via `atomicWriteJson` on every state change. Bounded (~10 KB at the 50-alarm cap). Boot recovery reads the file and rebuilds the in-memory min-heap.
