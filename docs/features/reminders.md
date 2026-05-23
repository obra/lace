# Reminders

Lace agents can schedule reminders that wake them with a prompt at a future time — as a cron-recurring schedule, a one-shot (absolute or relative), or a count-interval pattern. Reminders are owned per-session: each session has its own `reminders.json` next to `events.jsonl`.

## Tool

One built-in tool, available to every persona that includes lace built-ins:

| Tool | Purpose |
| --- | --- |
| `manage_reminders` | Schedule, cancel, or list reminders for the current session |

### `manage_reminders` parameters

The `action` field is required. All other fields depend on the action.

#### `action: 'schedule'`

Create a new reminder. Required: `prompt` (the note you leave your future self).

**When to fire (`next`):**
- `next: <seconds>` — relative delay from now (e.g. `300` → 5 minutes from now; minimum 300 seconds for recurring reminders)
- `next: "<ISO with Z or ±HH:MM offset>"` — absolute fire time (e.g. `"2026-12-25T09:00:00Z"`)

**Recurrence (`recurs`, optional):**
- Omit `recurs` for a one-shot reminder. `next` is required.
- `recurs: "<cron>"` — calendar-aware recurrence evaluated in the agent's local timezone (DST-aware). `next` must be omitted. Example: `"0 9 * * *"` for 9 AM daily. Minimum interval: 5 minutes.
- `recurs: <count>` — fire N times at `next`-second intervals. `next` (as seconds) is required. Minimum interval: 5 minutes (300 seconds). Example: `next: 600, recurs: 3` → fire 3 times, every 10 minutes.

Cap: 50 active reminders per session.

#### `action: 'cancel'`

Cancel a pending reminder by id. Required: `id`.

Does not retract notifications already written to the event log.

#### `action: 'list'`

Return all pending reminders, sorted by next fire time. No additional fields required.

For partly-fired count-interval reminders, `recurs` echoes the remaining count (or `null` when 1 remains) so you can copy fields into a new `schedule` call.

## Notification body

When a reminder fires, lace writes a `<notification kind="reminder" id="..." set-at="..." fired-at="...">` block into the session. The body contains the prompt you wrote when you scheduled the reminder. For recurring reminders, the block also carries `next-fire-at`, `last-fired-at`, and `fire-count` attributes.

## Lifetime

Reminders fire only while the owning lace process is alive. There is no cross-process scheduler. Subagent reminders fire only while the subagent's lace process is running. On graceful subagent shutdown with pending reminders, lace forwards them to the parent via a `session/update` notification carrying `type: 'pending_reminders_on_exit'`; the parent's relay composes a `<notification kind="subagent-exited">` block and injects it into its own session.

## Storage

`<LACE_DIR>/agent-sessions/<sessionId>/reminders.json` — single JSON snapshot, atomically rewritten via `atomicWriteJson` on every state change. Bounded (~10 KB at the 50-reminder cap). Boot recovery reads the file and rebuilds the in-memory min-heap.

Each row stores its `id`, `created_at`, `next_fire_at`, `prompt`, `recurs`, `fired_at`, and `fire_count`. The `recurs` field drives both the next-fire computation and the notification body at fire time.
