# Reminders — a coherent design

**Status:** Draft, 2026-05-22, converged with Jesse over chat.
Pre-implementation. Supersedes the alarm surface that PRI-1744 just shipped.
**Branch:** `alarms-design` (from lace 87adcf039). **Inputs:** [PRI-1759]
umbrella (Ada's 8 complaints), [PRI-1744] (the just-shipped move-to-lace),
Jesse's blog post _"When it comes to MCPs, everything we know about API design
is wrong"_ (2025-10-19), Claude's own scheduling primitives, three rounds of
adversarial review.

---

## 0. The framing

Two ideas frame this whole doc. Everything below follows from them.

**(1) The blog post lens.** Tools for LLMs are not APIs for programmers. The
consumer is a model with finite attention, no documentation tab, and no fast
feedback loop. The schema is for failing wrong shapes fast; the description is
the manual; the response is teaching material; the error message is how you keep
the model from getting stuck. Postel's law applies: liberal in what you accept,
conservative in what you do. The blog post explicitly rehabilitates the "one
tool, `action` dispatcher, untyped `payload`" pattern when it makes the model's
life easier.

**(2) Ada's reframing.** Ada calls these _"messages from past-me to future-me"_.
That's the right mental model. A reminder has two parts: **when to deliver** and
**what past-me wrote**. The whole letter is reconstituted on fire — not just a
stripped-down prompt. The fire notification's body is the prose past-me wrote;
the envelope is the metadata the system already knows (when it was set, when it
fired, whether it'll fire again, how many times).

This drives a rename: **`alarm` → `reminder`** at every layer.

---

## 1. The shape

One tool, three actions, type-discriminated time fields.

```ts
manage_reminders({
  action: "schedule" | "cancel" | "list",

  // schedule:
  prompt?: string,                  // what future-you will see, verbatim
  next?:   number | string,         // seconds-from-now OR ISO-with-offset
  recurs?: string | number,         // cron expression OR a fire count

  // cancel:
  id?: string,
})
```

Five fields beyond `action`. `list` takes no params.

### 1.1 Why one tool with an action enum

The `use_browser` pattern from the blog post. One tool description at session
start; one verb to remember; shape rules live in the description.

The schema discriminates parameters by JSON type, not by a kind enum.
`next: 300` (number) means seconds; `next: "2026-05-23T16:00:00-07:00"` (string)
means ISO. Same for `recurs`: cron is a string, count is a number.

### 1.2 The four legal schedule shapes

| Use case                        | Call                                |
| ------------------------------- | ----------------------------------- |
| Fire once in 5 min              | `next: 300`                         |
| Fire once at a specific instant | `next: "2026-05-23T09:00:00-07:00"` |
| Fire N times, every M seconds   | `next: 1800, recurs: 5`             |
| Fire on a calendar pattern      | `recurs: "0 9 * * 1-5"`             |

Recurring forever-until-cancelled: pass `recurs: "<cron>"`. For absolute-start +
count + interval, compute the seconds-from-now to your start instant and pass
that as `next`.

### 1.3 Cross-field rules

- `schedule` requires `prompt` AND at least one of `next`/`recurs`.
- `recurs: <count>` requires `next: <number>` AND `count ≥ 2`. `recurs: 1` is
  rejected with a teach-error pointing the agent at one-shot syntax (use `next`
  alone, no `recurs`). `recurs: 0` is rejected as nonsensical.
- `recurs: <cron>` rejects `next` — cron specifies its own first fire.
- `cancel` requires `id`.
- `next` must be `≥ 0`. With `recurs: <count>`, `next` must be `≥ 300` (the
  5-min floor).
- Cron's evaluated min-interval (sampled over the next 20 fires) must be `≥ 300`
  seconds.
- ISO timestamps must include an explicit offset (`Z` or `±HH:MM`).
- **String coercion:** `next` and `recurs` accept stringified non-negative
  integers (regex `/^\d+$/`, parsed via `Number(s)`) and route to the number
  branch. Negative-looking strings (`"-300"`) are rejected with a teach-error.
  Other non-integer strings on `next` route to ISO parsing; non-integer strings
  on `recurs` must be a 5-field cron expression. Failure produces a teach-error.

Every cross-field violation rejects loudly with a fix-it message. Examples:

> `next` is not used with cron recurrence — cron expressions specify their own
> first fire. Remove `next`, or drop `recurs` if you wanted a single fire at
> this instant.

> `recurs: 5` (count) requires `next` as a number of seconds — without an
> interval the system doesn't know when to fire. Pass
> `next: <seconds>, recurs: <count>`.

> `next: "2026-05-23T09:00:00"` lacks an offset. Add `Z` for UTC or `±HH:MM` for
> a specific timezone, or pass `next: <seconds>` for a relative delay.

> `next: "-300"` is negative. Use a non-negative number of seconds for relative
> delay, or an ISO timestamp for an absolute time.

### 1.4 Timezone: cron uses agent localtime

Lace reads `process.env.TZ` (or
`Intl.DateTimeFormat().resolvedOptions().timeZone` as fallback) at startup.
That's the agent's localtime — used both for cron evaluation and for formatting
all ISO outputs.

**TZ unset:** the reminders subsystem refuses to initialize. Every tool call
returns an error:
`"reminders subsystem is not running because TZ is unset; set TZ to an IANA timezone (e.g. America/Los_Angeles)"`.
Existing rows in `reminders.json` stay on disk untouched.

**TZ changed across restarts:** cron rows have `next_fire_at` recomputed on boot
(§3.4). One-shot and count-interval reminders are not recomputed — they're
absolute instants.

**ISO + DST:** ISO timestamps with an offset are evaluated to a specific
instant. The instant doesn't move when DST happens. If an agent in May schedules
`next: "2026-11-15T09:00:00-07:00"` thinking "9am local on Nov 15," the stored
instant is `16:00:00Z`, which after fallback DST renders as `10:00 PST` on the
agent's clock. **For absolute scheduling across a DST boundary, prefer cron
(calendar-aware) over `next: <ISO>` (instant-locked).** The tool description
carries this warning.

### 1.5 No history surface (with one footnote)

No `include_recent`, no `include_cancelled`, no separate history file. The
agent's conversation log contains every past fire as a
`<notification kind="reminder">` event in `events.jsonl`. "Did the 9am one fire
today" is answered by scrolling the conversation.

**Footnote:** an events-read tool that lets the agent read past `events.jsonl`
content beyond its live context window is on the roadmap. Until it lands,
recurring reminders across compaction boundaries lose visibility — acceptable
for v1.

### 1.6 No update, no preview, no chrono, no notify-retry

- **`update_alarm`** — cancel + schedule composes. With metadata folded into
  `prompt`, the reminder id has no external semantic.
- **`preview`** — the model interprets cron expressions on its own.
- **Natural-language time input** — silent chrono misparses are unrecoverable.
- **Notify-retry / per-row failure counter** — disk-write failures in
  `injectNotification` are operationally indistinguishable from "the agent
  itself is broken." Retry logic would either reintroduce duplicate-fire windows
  (the structural bug we just removed) or add a parallel queue with its own
  consistency questions. Accept silent loss in the rare failure case (§3.3).

---

## 2. The fire notification

When a reminder fires, the agent receives a `context_injected` event whose
content is:

```
<notification kind="reminder" id="reminder_a1b2c3"
  set-at="2026-05-22T15:33:00-07:00"
  fired-at="2026-05-22T15:38:00-07:00">
Follow up on the deploy in slack channel C0ABM2LCZ9V thread 1779436495.314189
</notification>
```

The body is **the prompt, XML-escaped using the standard text-content rules**:
first `&` → `&amp;`, then `<` → `&lt;`. (`>` is not escaped — it's not required
in text content, and leaving it raw keeps human-readable prompts readable.)
Escape order matters: `&` first so `&lt;` doesn't double-escape into `&amp;lt;`.

No lead sentence, no preamble, no trailing hint to call other tools.

### 2.1 Attributes

Always present:

- `kind="reminder"`
- `id="reminder_<12hex>"`
- `set-at` — when past-me scheduled this (ISO with agent local offset)
- `fired-at` — when it just fired (ISO with agent local offset)

Present for recurring fires (absent for one-shots):

- `last-fired-at` — the previous fire (absent on the first fire of a recurring
  reminder)
- `next-fire-at` — the next fire after this one, **if any** (absent when this is
  the terminal fire)
- `fire-count` — 1-indexed; this is the Nth time this reminder has fired

**Absence of `next-fire-at` is the signal that no more fires are coming**
(one-shot, or terminal of count/cron). A one-shot has no `fire-count` either; a
terminal recurring fire has `fire-count="N"`.

**Honest note on `last-fired-at`:** the attribute reflects the internal
`fired_at` on the row, which is updated in §3.3 step 3's commit BEFORE step 4's
notify. If a notify fails (the rare disk-write-failure case in §3.3), the row's
`fired_at` records a fire the agent never saw. The next successful fire will
then carry `last-fired-at` pointing at that ghost fire. The operator log (the
loud single-line entry from §3.3 step 6) is the authoritative record of which
fires actually delivered. For in-process injection this divergence is
theoretical — failures here would also break the rest of the agent's operation.

### 2.2 Why attributes, not prose

Attributes are machine-parseable metadata; the body is what the agent reads as
content. The agent can quote the exact ISO from `set-at` without
prose-extraction risk. The body remains past-me's instruction.

### 2.3 All ISO outputs are agent localtime with offset

Times come back in the agent's localtime (`-07:00` for an agent with
`TZ=America/Los_Angeles`). No UTC ↔ local conversion needed.

ISO outputs are rendered at output time using the CURRENT TZ. For long-lived
rows, `set-at` reflects current-TZ rendering, not the offset the agent saw at
schedule time. Operator-driven TZ changes are rare; this is acceptable in
practice.

Storage stays epoch ms (`ReminderRow.next_fire_at: number`). The response
formatter renders into local-offset ISO at the boundary.

### 2.4 List response echoes the wire shape

`list` returns rows in the same field shapes the agent would write to
`schedule`, with two important caveats about what "cloning" means.

- `recurs: string | number | null`, matching the wire format.
- For count-limited reminders with `remaining ≥ 2`, `list` returns
  **`recurs: <remaining>`** (NOT the original `N`), and
  `next: <interval_seconds>`. This lets the agent copy these fields into a new
  `schedule` call to clone "the remaining schedule." The original `N` is not
  preserved (and isn't useful — the model can re-derive intent from the prompt).
- For a count-limited reminder where `remaining == 1` (the next fire is the
  terminal fire), list returns `recurs: null` instead of `recurs: 1` — because
  `recurs: 1` is rejected by schedule (§1.3). This makes the clone workflow
  round-trip: copy `recurs` and `next` verbatim and schedule succeeds with a
  one-shot, matching the one-fire-left semantic.
- **Cloning shifts phase.** `next` in the wire format means "seconds-from-now to
  first fire." A copy-paste clone fires its first iteration `interval_seconds`
  after the clone time, NOT at the original `next_fire_at`. If the agent wants
  the new reminder to fire at the same wall-clock instants as the original, it
  must compute `next = max(1, (original_next_fire_at - now) / 1000)` and use
  that instead. The tool description spells this out.
- `prompt` is returned **raw** (not XML-escaped). Bodies are escape-displayed at
  injection time only. An agent comparing stored prompt to a fire-notification
  body must apply the same `& → &amp;`, `< → &lt;` transformation.

---

## 3. Storage and lifecycle

### 3.1 One file, one lifecycle, per-session async mutex

`reminders.json` (at `<sessionDir>/reminders.json`) contains only `pending`
rows. The file is rewritten atomically via `atomicWriteJson` (temp file +
rename, atomic on POSIX — readers always see a complete prior-or-current
version, never a torn read).

The per-session scheduler runs in the lace process's single JS event-loop and
owns a per-session async mutex. **All state mutations — the fire path (§3.3) AND
cancel (§3.5) — acquire the mutex before touching disk or the in-memory heap.**
The mutex makes the two paths mutually exclusive; there are no race windows, no
half-committed states, no compensation logic. Cancel may block for the duration
of an in-flight fire (typically ~10ms — one `atomicWriteJson` plus an event-log
append); this is acceptable for cancel's role and removes the class of subtle
interleaving bugs that earlier multi-set designs kept reintroducing.

The scheduler maintains an in-memory min-heap keyed on `next_fire_at`. The heap
is rebuilt at boot from disk (§3.4). All heap mutations — push on `schedule`,
push on recurring reschedule, pop on tick, remove on cancel — happen under the
mutex, in lockstep with the corresponding disk write. The heap and the on-disk
state never diverge.

There is no in-memory `currentlyFiring` set, no `cancelDuringFire`, no
`pending_cancel` flag. By the time cancel acquires the mutex, either the fire
has fully completed (disk write committed, notification appended to
`events.jsonl`) or it hasn't started yet. Those are the only two states cancel
can observe.

There is no `reminders-history.jsonl`, no append-only audit log, no separate
`cancelled`/`fired` retention. The agent's conversation log is the audit (§1.5).

### 3.2 The row shape

```ts
interface ReminderRow {
  id: string; // 'reminder_' + 12 hex
  created_at: number; // epoch ms — surfaces as set-at attribute
  next_fire_at: number; // epoch ms — when the next fire should happen

  prompt: string; // past-me's words, stored raw

  // recurrence: discriminated by `kind`. null = one-shot.
  recurs:
    | { kind: 'cron'; expr: string }
    | { kind: 'count'; interval_ms: number; remaining: number }
    | null;

  // book-keeping:
  fired_at: number | null; // most recent successful fire
  fire_count: number; // increments on every successful fire
}
```

**Count semantics:** `recurs: <N>` on the wire means _N total fires_, with the
first at `now + next` seconds and subsequent fires at `interval_ms` intervals
(`N ≥ 2`; `recurs: 1` is rejected per §1.3). The row stores `remaining = N` at
insert; on each successful fire we decrement; the fire when `remaining` reaches
0 is the terminal fire (row is deleted, no further reschedule).
`fire_count + remaining == N` (initial) is an invariant that holds in all
on-disk states.

No `status` field. No `firing` state. No `pending_cancel` flag. No
`notify_attempts` — see §3.3 for why.

### 3.3 Fire ordering: single write per fire, at-most-one missed

The fire path is structured so that exactly one disk write commits the fire's
outcome, and any crash leaves the row either pre-fire or post-fire — never
half-committed. The honest trade: a crash or notify failure between the commit
write and the agent receiving the event results in _one silently missed fire_.
We never duplicate.

The whole flow (with one row, identified by `row.id`, popped from the heap
because its `next_fire_at` has been reached):

1. **Acquire the per-session mutex** (§3.1). Block until acquired. The rest of
   the flow runs serialized against cancel.
2. **Re-read the row from disk.** Cancel may have run while we waited for the
   mutex (it cannot have run _during_ the fire, but it may have run before we
   acquired). If the row is no longer present on disk, release the mutex and
   return — there is nothing to fire. (The row may also have been mutated by
   `schedule`/`update`, but those operations don't change the id; the heap's
   record still matches.)
3. **Compute the post-fire row state** in memory; deep-clone the _pre-fire_ row
   into a closure variable `prior` for logging (mutating `row` in subsequent
   steps must not affect `prior`):
   - For continuing recurring (cron with another match, or count with
     `remaining > 1`): post-fire state is the row with `next_fire_at` advanced
     (cron: next match strictly `> now` in current TZ; count:
     `now + interval_ms`), `remaining -= 1` (count only), `fired_at = now`,
     `fire_count += 1`.
   - For one-shots or terminal recurring: post-fire state is "row deleted."
4. **Commit:** `await atomicWriteJson(...)` with the post-fire state. On persist
   failure: for continuing recurring, push the _pre-fire_ heap entry back onto
   the heap (the row was popped before step 1; the disk is unchanged, so the
   next tick should retry); for one-shots and terminal recurring, also push the
   pre-fire entry back so the next tick retries the fire-and-delete. Log the
   failure (one log line: `row.id`, "step 4 persist failed", reason). Release
   the mutex and return — no notify. On persist success: for continuing
   recurring, push the _updated_ heap entry. The fire is now considered
   committed.
5. **Notify:** `await injectNotification(...)`. The attributes (`fired-at`,
   `fire-count`, `last-fired-at`, `next-fire-at`) reflect the committed
   post-fire state.
6. **Release the mutex** (always — `finally` block).
7. **On notifier failure (step 5 threw):** log loudly (one log line: `row.id`,
   "step 5 notify failed", reason, the _new_ `fire_count` from the post-fire
   state, the _original_ `next_fire_at` from `prior`). The row is already in its
   post-fire state. The agent does not receive this fire. This is the
   at-most-one-missed trade.

**Notify failures and silent loss.** In-process `injectNotification` is
essentially a JSONL append to `events.jsonl`; the only realistic failure modes
are disk full, permission, or filesystem corruption — all of which would also
break the rest of the agent's operation. We accept silent loss in these cases
because (a) they're rare, (b) the operator can detect them from the log stream,
(c) attempting retry would either require keeping the row in a half-fired state
(the structural bug we just removed) or storing a separate retry queue (added
complexity for a near-impossible failure mode). **For one-shots, this means
notify failure = the reminder is gone, period.** Document loudly in the tool
description: "in pathological scenarios (disk full, etc.) a reminder may be lost
without notice; this is rare in normal operation but cannot be retried without
producing duplicate fires under other failure modes."

**Concurrency model.** The mutex makes the fire path and cancel mutually
exclusive. There is no "in-flight" state visible to anything outside the
scheduler — by the time cancel acquires the mutex, either the fire has fully
completed (its writes are durable, its notification is in `events.jsonl`) or it
hasn't started yet. Cancel sees a stable disk state; the scheduler sees a stable
heap. Step 2's re-read covers the case where cancel acquired first and deleted
the row.

**Crash points and their consequences:**

- Crash before step 4 commits: row unchanged on disk. Boot recovery picks it up,
  re-fires on next tick.
- Crash during step 4's persist: `atomicWriteJson` is atomic — either the new
  file is fully written or the old one survives. On boot either the pre-fire or
  post-fire state is loaded; no partial state. Pre-fire → next tick re-fires
  (correct). Post-fire → notification was never sent (one fire missed;
  operator-visible via the absence of any `<notification kind="reminder">` event
  written for this fire).
- Crash between step 4 and step 5: same as the post-fire-no-notify case. One
  fire missed.
- Crash during step 5's notify: `injectNotification` either succeeded in
  appending the `context_injected` event before the crash (agent will see it on
  next boot — fire delivered) or did not (fire missed). At most one delivery in
  any case.

The trade-off summarized: prefer silent miss over duplicate. Agents handle
missing fires (the user follows up; the next recurrence catches them; the
operator sees logs) far better than duplicate fires (the model concludes the
cron is broken).

### 3.4 Boot recovery

On lace startup:

1. Refuse to start the reminders subsystem if TZ is unset (§1.4). Every reminder
   tool call returns the unset-TZ error. Existing rows stay on disk; no fires
   happen.
2. Load `reminders.json` into an in-memory snapshot.
3. **For each cron row in the snapshot:** compute
   `new_next = next cron match strictly > now` in current TZ. If
   `new_next > persisted_next_fire_at + 60s` (we're past the persisted time):
   log `dropped_fires` with
   `count = number of cron matches in [persisted_next_fire_at, now]`, evaluated
   in current TZ. Update the in-memory snapshot's `next_fire_at = new_next`.
   - **Note:** if the operator changed TZ across the restart, the recompute will
     produce a different `next_fire_at` than the persisted value even with no
     downtime. The `dropped_fires` count accurately answers "how many fires
     would have happened in the new TZ during the gap." Operators changing TZ on
     a session with active cron reminders should expect non-zero drop counts on
     the next boot; the alternative (silently using TZ-of-schedule-time) would
     produce wall-clock drift on every fire instead.
4. **For each count-interval row in the snapshot:** if
   `next_fire_at + 60s < now`, set `next_fire_at = now + interval_ms`; log
   `schedule_shifted` with the old and new fire times. **`remaining` is not
   changed** — count of total promised fires is preserved; only the wall-clock
   schedule shifts.
5. **Single persist:** if any rows were modified in steps 3–4, write the updated
   snapshot to `reminders.json` once via `atomicWriteJson`. A single write keeps
   recovery atomic — a crash partway through the recompute loop just leaves the
   original file intact for the next boot to retry. If the write throws (disk
   full, etc.), log loudly and continue with the in-memory state; the next
   successful fire will commit a fresh disk snapshot in §3.3 step 4.
6. Populate the in-memory heap; start the loop.

**50-cap on recovery:** if recovery leaves more than 50 rows in
`reminders.json`, recovery itself does not delete or reject. Subsequent
`schedule` calls reject with an educational error:

> Cannot schedule: 54 reminders are currently pending (over the 50-active cap).
> Call `manage_reminders({action: "list"})` to see them and cancel ones you no
> longer need.

This makes the lockout visible and actionable.

**On missed-fire visibility:** `dropped_fires` (cron) and `schedule_shifted`
(count-interval) log entries are operator-facing only in v1. A future
enhancement: inject one
`<notification kind="reminder-missed" id="..." dropped-count="N">` block per
affected row on boot. Out of scope for this rework; tracked separately.

### 3.5 Cancel

The cancel handler serializes with the scheduler via the per-session mutex
(§3.1):

1. **Acquire the per-session mutex.** Block until acquired. If the scheduler was
   mid-fire when cancel was invoked, this waits until the fire completes
   (typically ~10ms).
2. **Read the row from disk.**
   - **No such row:** release the mutex, return
     `{cancelled: false, reason: "not_found"}`.
   - **Row exists:** compute the new file state without the row,
     `await atomicWriteJson(...)`. On persist failure, release the mutex, return
     `{cancelled: false, reason: "persist_failed", retry_safe: true}` — both
     disk and heap are unchanged; safe to retry. **On persist success, then**
     remove the row from the in-memory heap (idempotent — the heap may or may
     not still contain the entry, depending on whether the scheduler had already
     popped it for an imminent fire). Disk and heap mutate in lockstep.
3. **Release the mutex** (`finally` block; always runs).
4. **Return** `{cancelled: true}`.

**Contract:** `{cancelled: true}` means the row is gone from disk and from the
heap before cancel returns. **No future fires.** It does NOT mean "no
notification for this id will ever appear in your conversation" — if a fire was
already committed to `events.jsonl` before cancel acquired the mutex, that
notification is durable and the agent will see it on its next turn. Cancel stops
future scheduling; it does not retract delivered notifications.

This is honest and matches the at-most-one-missed model in §3.3 — once a fire
has committed (its `<notification kind="reminder">` is in `events.jsonl`), it is
part of the agent's conversation. Cancel can prevent further fires but not
delete history. Prior revisions of this doc tried to attach a `note` field
warning the agent about queued notifications; this was dropped because (a)
detecting "the agent hasn't processed this turn yet" requires coupling cancel to
event-stream watermarks, (b) a wall-clock proxy mis-classified long-running tool
calls, and (c) the agent can reason about this directly from the description
without a runtime signal.

Description text: "`cancel` succeeds when the reminder exists and stops all
future fires of it. Returns `{cancelled: false, reason: "not_found"}` if no such
reminder exists, or
`{cancelled: false, reason: "persist_failed", retry_safe: true}` on a rare disk
failure (unchanged state; retry). Cancel does NOT retract notifications that
were already delivered to your event log before cancel landed — if a fire
committed before your cancel acquired its turn, you'll still see that one
notification on your next turn. Cancel governs the future, not the past."

### 3.6 Schedule

The schedule handler also serializes with the scheduler via the per-session
mutex:

1. **Validate the input** (cross-field rules per §1.3) — synchronous, no mutex
   needed yet.
2. **Acquire the per-session mutex.**
3. **Re-read disk and enforce the 50-cap** against the freshly-read state (the
   cap could have changed since validation if another schedule landed). If
   over-cap, release the mutex and return the educational error from §3.4.
4. **Generate `id`, compute `next_fire_at`, build the row.**
5. **`await atomicWriteJson(...)`** with the new row appended. On persist
   failure, release the mutex and return
   `{ok: false, reason: "persist_failed", retry_safe: true}`.
6. **Push the new entry onto the in-memory heap.** If this row's `next_fire_at`
   is sooner than the heap's previous min, call the scheduler's
   `rescheduleNextTick()` (a thin wrapper around `clearTimeout` on the existing
   wake timer plus `setTimeout` for the new heap-min). The wake mechanism is
   `setTimeout`-based: at boot and after each tick, the scheduler arms a single
   timer for `heap_min - now`; schedule and cancel reset it when they change the
   heap-min under the mutex.
7. **Release the mutex** (`finally`).
8. **Return** the schedule response (§4 / Appendix A shape).

The same structural pattern as fire and cancel: validate-acquire-mutate-release,
with the heap and disk mutated in lockstep. No race against the scheduler tick
or against concurrent cancels.

### 3.7 Multiple due rows at a single tick

When the scheduler wakes and finds several rows with `next_fire_at <= now`,
**each row is fired in its own §3.3 invocation** — acquire mutex, fire one row,
release. This lets cancel (or schedule) interleave between rows in a batch
instead of blocking until the entire batch completes. The tradeoff: fewer rows
fire per millisecond, but cancel/schedule latency stays bounded by a single
fire's duration (~10ms) regardless of batch size.

### 3.8 List

`list` reads `reminders.json` and returns the rows. **It does NOT acquire the
mutex.** POSIX rename atomicity (atomicWriteJson uses temp + rename) guarantees
that a reader sees a complete prior-or-current snapshot, never a torn read. The
cost is that a row visible in one `list` may be deleted (post-fire, cancel) by
the time the next `list` runs — which is the expected behavior of a
list-then-mutate API. No correctness issue.

The mutex-free path also means `list` is fast: a single file read, no contention
with scheduler ticks or other operations.

### 3.9 The 50-active cap

`MAX_ACTIVE_REMINDERS = 50` stays. Counts only on-disk rows in `reminders.json`.
Subject to the boot-recovery rule above (§3.4).

### 3.10 No-deadlock invariant

The mutex is held during `injectNotification` (§3.3 step 5). For this to be
safe, `injectNotification` must not transitively await anything that requires
the reminders mutex. Today this holds — `injectNotification` only appends to
`events.jsonl` and triggers the conversation runner via the existing
`context_injected` mechanism, neither of which calls back into the reminders
subsystem. Future refactors that change `injectNotification` to call into
reminders (e.g., to inspect pending reminders for a UI hint) would break the
no-deadlock invariant and must be rejected or restructured.

### 3.11 The cross-session-writes invariant

Untouched from PRI-1744.

---

## 4. Tool description (the manual)

Sketch:

> `manage_reminders` — schedule, list, or cancel reminders for your future self.
> A reminder fires a `<notification kind="reminder">` block into your next turn
> at the scheduled time, carrying the prompt you wrote when you scheduled it.
> Use this for "follow up in 5 minutes," "remind me every weekday at 9am,"
> "check on this job 5 times every half hour."
>
> **Actions:**
>
> - **`schedule`** — `{action: "schedule", prompt, next?, recurs?}`. Create a
>   reminder.
>   - `prompt` is what future-you will see when it fires. Write it as a
>     self-contained instruction; include any identifiers (slack threads, ticket
>     IDs, correlation tokens) you'll need to act on — future-you reads this as
>     prose and uses what's in it.
>   - `next: <seconds>` (non-negative integer) for relative delay, OR
>     `next: "<ISO with offset>"` for absolute. Required unless `recurs` is a
>     cron expression.
>   - `recurs: "<cron>"` for calendar-aware recurrence (evaluated in your local
>     timezone, accounting for DST). Cron's own clock determines fires; do not
>     also pass `next`. **For any absolute-time scheduling more than a few days
>     out, prefer cron over `next: <ISO>` — cron tracks DST correctly while
>     ISO-with-offset is locked to an instant and will drift relative to your
>     wall clock across a DST transition.**
>   - `recurs: <count>` for "fire N times at `next`-second intervals." Requires
>     `next` as seconds. To start the series at a specific future instant,
>     compute the seconds-from-now to that instant and pass as `next`.
>   - Minimum interval is 5 minutes for both cron and count-limited recurring.
>   - Some fires may be silently missed if the lace process crashes during the
>     fire window or is down for an extended period. Cron does not catch up
>     missed fires after downtime; the system advances to the next future match.
> - **`cancel`** — `{action: "cancel", id}`. Stop all future fires of a
>   reminder. Returns `cancelled: true` on success, `cancelled: false` with
>   `reason: "not_found"` if the reminder doesn't exist, or
>   `reason: "persist_failed"` on transient disk failure. Note: cancel governs
>   the future, not the past. If a fire was already committed to your event log
>   before cancel landed, you will see that one notification on your next turn —
>   cancel cannot retract delivered notifications.
> - **`list`** — `{action: "list"}`. Return all pending reminders for this
>   session, ordered by next fire time. To see past fires, scroll your own
>   conversation for `<notification kind="reminder">` events. The returned
>   `recurs` and `next` fields match the wire format — for a partly-fired
>   count-limited reminder, `recurs` echoes the _remaining_ count and `next`
>   echoes the interval, so you can copy fields into a new `schedule` call to
>   clone the remaining schedule. NOTE: cloning shifts phase — the new
>   reminder's first fire is `next` seconds from clone-time, not aligned to the
>   original's `next_fire_at`. If you want phase preservation, compute `next`
>   yourself as the seconds-from-now to the original's `next_fire_at`.
>
> **Examples:**
>
> - `{action: "schedule", prompt: "follow up on the deploy in slack channel C0ABM2LCZ9V thread 1779436495.314189", next: 300}`
>   — fire once in 5 minutes
> - `{action: "schedule", prompt: "post daily standup agenda to #engineering", recurs: "0 9 * * 1-5"}`
>   — every weekday 9am local
> - `{action: "schedule", prompt: "ping #ops about the migration", next: 1800, recurs: 6}`
>   — 6 fires, 30 min apart
> - `{action: "cancel", id: "reminder_a1b2c3d4e5f6"}`

---

## 5. How this relates to Claude's own scheduled-work primitives

(Unchanged from prior revision — kept for cross-pollination.)

`manage_reminders` (Sen) and `ScheduleWakeup` / `CronCreate` (Claude harness)
are siblings, not parent/child. Sen's persistent-session, in-process-inject
lifecycle is incompatible with Claude's fresh-CCR-per-fire or clamped-delay
models. They should share design philosophy (single-tool-with-action-dispatcher,
type-discriminated time fields, structured attributes on fire) but separate
implementations.

What Sen took from Claude: the `use_browser`-style action dispatcher pattern.
What Claude could take from Sen: structured fire-notification attributes; list +
cancel surface for in-flight wakeups.

---

## 6. What changes from PRI-1744 — concrete diff

### 6.1 Tool surface

- **Delete:** `schedule_alarm`, `cancel_alarm`, `list_alarms`.
- **Add:** `manage_reminders` with `schedule`/`cancel`/`list` actions.
- **No:** `update`, `preview`.

### 6.2 Schema

- Wire-format fields: `{action, prompt, next, recurs, id}`. No `kind` enum, no
  `schedule`/`minutes`/`endTime`/`durationMinutes`/`timezone`/`allowSubHour`.
- Type-discriminated: `next: number | string`, `recurs: string | number`.
  Stringified non-negative integers coerce per §1.3.
- Cross-field rules enforced in the executor with educational errors.

### 6.3 Storage

- Rename: `alarms.json` → `reminders.json`. No `status` field. No `firing`
  state. No `pending_cancel`. No `notify_attempts`.
- Row shape per §3.2: discriminated `recurs` field. The scheduler holds an
  in-memory min-heap and a per-session async mutex; the fire path (§3.3) and
  cancel (§3.5) both acquire the mutex before any disk or heap mutation. No
  `currentlyFiring`/`cancelDuringFire`/`pending_cancel`/`notify_attempts` state
  — the mutex makes those unnecessary.
- **Cancelled and fired rows are deleted on transition** via the single-write
  commit in §3.3.
- No history file.
- Boot recovery per §3.4: TZ-unset refusal; cron `next_fire_at` recomputed
  against current TZ; `dropped_fires` logged for cron (matches missed during
  downtime); `schedule_shifted` logged for count-interval (remaining preserved,
  schedule shifted); over-cap state allowed transiently.

### 6.4 Fire notification

- `<notification kind="reminder">` (no `-fired` / `-expired` variants;
  attribute-absence carries the signal).
- Body is XML-escaped prompt (`&` then `<`).
- Attributes: `id`, `set-at`, `fired-at`, plus
  `last-fired-at`/`next-fire-at`/`fire-count` for recurring. `next-fire-at`
  absent ⇒ terminal fire.
- All ISO outputs in agent localtime with explicit `±HH:MM` offset, rendered at
  output time using current TZ.

### 6.5 Naming

- `alarm` → `reminder` at every layer.
- The `NotificationKind` union in `notification-wrapper.ts` changes: removes
  `'alarm-fired'`, `'alarm-expired'`; adds `'reminder'`. Job-related kinds
  untouched.

### 6.6 Timezone

- Cron evaluates in agent localtime from `process.env.TZ` / `Intl` fallback. No
  `tz` field.
- TZ unset → loud refusal to initialize. Every reminder tool call returns the
  unset-TZ error.
- TZ changed → cron rows recomputed on boot. Downtime-skipped fires are dropped
  with a `dropped_fires` log entry.
- All ISO outputs render in current agent localtime with offset.
- ISO inputs require explicit offset.
- DST + absolute ISO documented as a footgun (§1.4 + §4).

### 6.7 Cron / interval floor — intentional behavior change

- Flat 5-minute (300s) floor on both cron evaluation and `recurs: <count>`
  intervals. No `allow_sub_hour` flag. Deliberate loosening from the shipped
  1-hour cron floor.
- Cron floor enforcement: sample the next 20 cron fires; assert min delta across
  that window ≥ 300s.

### 6.8 Wrapper API change

- `buildNotification` gains an explicit
  `attributes: Record<string, string | number>` parameter, distinct from the
  existing `identifiers`.
- **Coercion rule:** numbers stringify via `String(v)`; strings pass through;
  keys with `undefined` or `null` values are OMITTED (no
  `attribute="undefined"`); `NaN` and other non-finite numbers throw an error
  (programmer bug).
- Body content goes through the standard XML text-content escape (`&` → `&amp;`,
  then `<` → `&lt;`).

### 6.9 Subagent-exited bubble — compact rendering for many reminders

When a subagent exits with pending reminders, the parent's
`<notification kind="subagent-exited">` lists them. Format:

- ≤5 reminders: render each on its own line with the full prompt.
- &gt;5 reminders: render each on one line as
  `<id> [<next-fire-at>]: <first 200 chars of prompt, truncated at the last word boundary, with an ellipsis if truncated>`.
  200 chars covers realistic prompts including embedded identifiers; the
  word-boundary truncation prevents cutting a thread ID mid-digit. Total bubble
  bounded at ~50 × 250 chars ≈ 12KB.

The subagent's own `reminders.json` is not reaped by this design — natural
session cleanup handles it.

### 6.10 What does NOT change

- `injectNotification` invocation path and `context_injected` event type.
- In-process scheduler architecture and the heap-based dispatch model.
- The 50-active cap.
- The "no cross-session writes" invariant.
- `safeInternal` and `destructiveHint` annotations.

---

## 7. Ticket disposition

| Ticket                  | Disposition                                                |
| ----------------------- | ---------------------------------------------------------- |
| PRI-1760                | Already shipped. No change.                                |
| PRI-1761 (metadata)     | **Won't-do.** Folds into `prompt`.                         |
| PRI-1762 (union schema) | **Won't-do.** Deeper rework drops `kind`.                  |
| PRI-1763 (update)       | **Won't-do.** Cancel + schedule composes.                  |
| PRI-1764 (preview)      | **Won't-do.** Model interprets cron itself.                |
| PRI-1765 (chrono)       | **Won't-do.** Silent misparses unrecoverable.              |
| PRI-1766 (history)      | **Won't-do.** Conversation log + roadmap events-read tool. |
| PRI-1767 (sub-hour)     | **Won't-do.** Flat 5-min floor.                            |
| PRI-1759 (umbrella)     | Close when rework lands.                                   |

**New ticket:** "Reminders rework: replace alarm surface with `manage_reminders`
per docs/specs/2026-05-22-alarms-coherent-design.md."

**Roadmap (separate katas, not part of this rework):**

- Events-read tool for cross-compaction history visibility.
- Boot-time `<notification kind="reminder-missed">` injection for
  `dropped_fires`.

---

## 8. Open questions

These are small remaining calls.

1. **`list` ordering.** Ascending by `next_fire_at`. Confirmed.
2. **20-sample cron-floor window (§6.7).** Adequate for realistic patterns.
3. **Subagent `reminders.json` cleanup timing.** Left to natural session-reap.

---

## Appendix A: Worked examples

### Schedule a one-shot relative

```
manage_reminders({
  action: "schedule",
  prompt: "follow up on the deploy in slack channel C0ABM2LCZ9V thread 1779436495.314189",
  next: 300
})
→ {
  id: "reminder_a1b2c3d4e5f6",
  next_fire_at: "2026-05-22T15:38:00-07:00",
  recurs: null
}
```

### Schedule a daily cron

```
manage_reminders({
  action: "schedule",
  prompt: "post daily standup agenda to #engineering",
  recurs: "0 9 * * 1-5"
})
→ {
  id: "reminder_b2c3d4e5f6a7",
  next_fire_at: "2026-05-25T09:00:00-07:00",
  recurs: "0 9 * * 1-5"
}
```

### Schedule a count-limited interval

```
manage_reminders({
  action: "schedule",
  prompt: "check on the migration job status",
  next: 1800,
  recurs: 6
})
→ {
  id: "reminder_c3d4e5f6a7b8",
  next: 1800,
  next_fire_at: "2026-05-22T16:08:00-07:00",
  recurs: 6
}
```

### Reject conflicting time inputs

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: 300,
  recurs: "0 9 * * *"
})
→ {
  ok: false,
  error: "`next` is not used with cron recurrence — cron expressions specify their own first fire. Remove `next`, or drop `recurs` if you wanted a single fire."
}
```

### Coerce stringified non-negative integer

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: "300"
})
// Coerces to next: 300, schedules normally.
```

### Reject negative integer

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: "-300"
})
→ {
  ok: false,
  error: "`next: \"-300\"` is negative. Use a non-negative number of seconds for relative delay, or an ISO timestamp for an absolute time."
}
```

### Reject `recurs: 1`

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: 1800,
  recurs: 1
})
→ {
  ok: false,
  error: "`recurs: 1` is the same as a one-shot. Omit `recurs` and use `next` alone for a single fire."
}
```

### Reject local-time ISO

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: "2026-05-23T09:00:00"
})
→ {
  ok: false,
  error: "`next` ISO timestamp lacks an offset. Add `Z` for UTC or `±HH:MM` for a specific timezone, or pass `next: <seconds>` for a relative delay."
}
```

### Reject schedule when over the 50-cap on recovery

```
manage_reminders({
  action: "schedule",
  prompt: "...",
  next: 300
})
→ {
  ok: false,
  error: "Cannot schedule: 54 reminders are currently pending (over the 50-active cap). Call manage_reminders({action: \"list\"}) to see them and cancel ones you no longer need."
}
```

### Cancel

```
manage_reminders({
  action: "cancel",
  id: "reminder_a1b2c3d4e5f6"
})
→ { cancelled: true }

// id doesn't exist (already fired and removed, or never scheduled):
→ { cancelled: false, reason: "not_found" }

// persist failed (transient):
→ { cancelled: false, reason: "persist_failed", retry_safe: true }
```

(If a fire committed before cancel acquired its turn, the notification is
already in your event log and will appear on your next turn regardless of
cancel's response.)

### List (wire-shape `recurs`, ready to clone)

```
manage_reminders({ action: "list" })
→ {
  reminders: [
    {
      id: "reminder_b2c3d4e5f6a7",
      prompt: "post daily standup agenda to #engineering",
      next_fire_at: "2026-05-25T09:00:00-07:00",
      recurs: "0 9 * * 1-5",
      set_at: "2026-05-22T15:33:00-07:00",
      last_fired_at: null,
      fire_count: 0
    },
    {
      // count-interval, mid-stream (remaining ≥ 2):
      id: "reminder_c3d4e5f6a7b8",
      prompt: "check on the migration job status",
      next_fire_at: "2026-05-22T17:38:00-07:00",
      recurs: 4,                                 // remaining count — clone-ready
      next: 1800,                                // interval as wire shape — clone-ready
      set_at: "2026-05-22T15:38:00-07:00",
      last_fired_at: "2026-05-22T17:08:00-07:00",
      fire_count: 2
    },
    {
      // count-interval, ONE fire left (remaining=1): list returns recurs:null
      // so the clone copy-paste produces a valid one-shot schedule.
      id: "reminder_d4e5f6a7b8c9",
      prompt: "final ping on the migration",
      next_fire_at: "2026-05-22T19:38:00-07:00",
      recurs: null,                              // not "1" — that would be rejected
      next: 1800,                                // interval kept for clone phase calc
      set_at: "2026-05-22T15:38:00-07:00",
      last_fired_at: "2026-05-22T19:08:00-07:00",
      fire_count: 5
    }
  ]
}
```

### Fire notification (recurring, mid-stream)

```
<notification kind="reminder" id="reminder_b2c3d4e5f6a7"
  set-at="2026-05-15T15:33:00-07:00"
  fired-at="2026-05-22T09:00:00-07:00"
  last-fired-at="2026-05-21T09:00:00-07:00"
  next-fire-at="2026-05-25T09:00:00-07:00"
  fire-count="6">
post daily standup agenda to #engineering
</notification>
```

### Fire notification (one-shot)

```
<notification kind="reminder" id="reminder_a1b2c3d4e5f6"
  set-at="2026-05-22T15:33:00-07:00"
  fired-at="2026-05-22T15:38:00-07:00">
follow up on the deploy in slack channel C0ABM2LCZ9V thread 1779436495.314189
</notification>
```

### Fire notification (terminal — last fire of a count-limited reminder)

```
<notification kind="reminder" id="reminder_c3d4e5f6a7b8"
  set-at="2026-05-22T15:38:00-07:00"
  fired-at="2026-05-22T18:38:00-07:00"
  last-fired-at="2026-05-22T18:08:00-07:00"
  fire-count="6">
check on the migration job status
</notification>
```

(Absence of `next-fire-at` = terminal.)

### Fire notification with escaped body

```
manage_reminders({
  action: "schedule",
  prompt: "check whether `&` and `</notification>` are escaped properly",
  next: 300
})
// Fires as:
<notification kind="reminder" id="..."
  set-at="..." fired-at="...">
check whether `&amp;` and `&lt;/notification>` are escaped properly
</notification>
// list() returns the raw prompt unchanged; only the notification body is escaped.
```
