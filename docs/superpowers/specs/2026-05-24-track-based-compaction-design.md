# Track-based Compaction Strategy — Design

Date: 2026-05-24 Author: Jesse + Bot Supersedes:
`2026-05-25-typed-capsule-compaction-strategy-design.md` (v1–v6, paused after 6
non-converging rev rounds — see `project_compaction_design_in_hell.md` memory).

## Why

Sen's lace session is a single-persona, single-memory-thread agent whose inbound
prompts are **multiplexed across distinct conversational tracks**: multiple
Slack channel/thread pairs, subagent-job return notifications, scheduler
alarm/reminder fires, idle-error reports, and a one-time bootstrap. Treating
this as one undifferentiated transcript — which the current `summarize` strategy
does — produces an opaque prose blob
([PRI-1827](https://linear.app/prime-radiant/issue/PRI-1827),
[PRI-1828](https://linear.app/prime-radiant/issue/PRI-1828)) and silently mixes
unrelated threads.

Ada's actual 2,036-event main session (`sen2/compaction/fixtures/ada-main/`) has
184 prompts in one Slack channel, 118 in a DM, ~50 subagent jobs, and 32 system
notifications — all interleaved into a single event stream. The current
`summarize` blob loses the per-track structure that's already implicit in the
data.

This spec replaces `summarize` with a track-aware strategy: producers stamp a
`track` field on durable input events, compaction demuxes by track and applies
per-track salience filters, the result is concatenated as a structured prefix
message + verbatim recent-turn tail.

It is intended to ship in the same wave as
`2026-05-25-slack-agent-message-context-spec.md` (slack-context-v2), which is
being implemented now. That spec already adds `idempotencyKey` and `source` to
the durable `prompt` and `context_injected` events. We add one more sibling
field: `track`.

## Non-goals

- Migration of historical event logs. Ada is being cleared anyway as part of
  slack-context-v2's reset marker; we reuse that window.
- New durable event types. Reuse `context_compacted`.
- Zod schema for the compaction output. The model reads structured markdown; we
  don't validate field-by-field.
- Persistent-disable failure backoff. Failure = log + Slack alarm; pressure
  stays high; next turn retries.
- Recall/FTS indexing of summary content. Recall reads canonical events only.
- Multi-strategy registry. There's one strategy. If we want a second one later,
  we add the plumbing then.
- Provider-pinning for the summarizer call. We use whatever provider the session
  is on.

## Preconditions

1. **slack-context-v2 lands and Ada is reset.** That spec ships the
   `idempotencyKey` and `source` fields, and triggers the Ada reset marker. We
   piggyback on the same reset for our cutover.
2. **PRI-1817 (turn_end cache fields) shipped.** Already merged. The trigger
   arithmetic reads `cacheCreationInputTokens` and `cacheReadInputTokens` from
   `turn_end.usage`.
3. **The compaction trigger's input requires last-call usage, not
   turn-cumulative.** Existing
   `turn_end.usage.{inputTokens,cacheCreationInputTokens,cacheReadInputTokens}`
   are sums across every API call in the turn. We need the last call's
   on-the-wire context size. Add `usage.lastCallInputContextTokens` as part of
   this kata (small lace change to `runner.ts` + `event-types.ts`).

## Architecture

### High-level shape

```
Producers stamp `track` on input events
        │
        ▼
Compaction trigger fires after turn_end
        │
        ▼
compact() reads canonical events
        │
        ├── demux by track
        ├── salience filter per track
        ├── render to markdown prefix
        └── append verbatim tail (last N turns)
        │
        ▼
Returns context_compacted event with preserved[] = [prefix, ...tail]
        │
        ▼
Caller writes the event (writeAndAdvance OR raw appendDurableEvent
depending on the caller's existing lock context — same as today)
```

### Module layout

```
lace/packages/agent/src/
├── compaction/
│   ├── summarize-strategy.ts          DELETED (replaced)
│   ├── summarize-strategy.test.ts     DELETED
│   ├── trim-tool-results-strategy.ts  KEPT — orthogonal primitive, can stay
│   ├── track-compaction.ts            NEW — exports compact(), demux, salience filters
│   ├── track-render.ts                NEW — render compacted blocks to markdown
│   ├── types.ts                       MODIFIED — CompactionResult shape unchanged
│   └── __tests__/
├── core/conversation/
│   ├── runner.ts                      MODIFIED — hook after turn_end + lastCall usage
│   ├── compaction-trigger.ts          NEW — pressure evaluator
│   └── __tests__/
├── storage/
│   ├── event-types.ts                 MODIFIED — add `track?: string` to PromptData
│   │                                              and ContextInjectedData
│   └── __tests__/
└── message-building/
    └── message-builder.ts             UNCHANGED — already handles context_compacted.preserved[]
```

External (sen-core + scheduler MCP, not lace):

```
sen-core-v2/src/
├── slack/listener.ts         stamps track on every Slack envelope
├── jobs/job-dispatcher.ts    stamps track on subagent-return injections
└── mcp-servers/scheduler.ts  stamps track on alarm/reminder injections
```

## Data model

### Track field on durable input events

Add optional `track?: string` to two existing event types in
`storage/event-types.ts`:

```ts
type PromptData = {
  content: ContentBlock[];
  idempotencyKey?: string; // from slack-context-v2
  source?: SourceMetadata; // from slack-context-v2
  track?: string; // NEW (this spec)
};

type ContextInjectedData = {
  content: ContentBlock[];
  priority?: 'immediate' | 'normal';
  source?: SourceMetadata; // from slack-context-v2
  track?: string; // NEW (this spec)
};
```

Lace stores it opaquely. The string is producer-defined.

### Track shapes by producer

Convention: `<kind>:<id>`. Kinds we ship with:

| Producer                                     | Track                                        | Components                              |
| -------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| sen-core slack listener                      | `slack:<teamId>:<channel>:<thread_ts ?? ts>` | from the slack-context-v2 envelope      |
| sen-core delegate (job-return notifications) | `job:<jobId>`                                | jobId already on hand                   |
| scheduler MCP (alarm fires)                  | `alarm:<alarmId>`                            | alarmId owned by scheduler              |
| scheduler MCP (reminder fires)               | `reminder:<reminderId>`                      | reminderId owned by scheduler           |
| sen-core idle-error reporter                 | `system:idle-errors`                         | singleton                               |
| sen-core bootstrap                           | `system:bootstrap`                           | singleton (fires once at session start) |

Operator-initiated events (slash command `/compact`, RPC `ent/session/compact`)
do NOT stamp tracks — they're meta-actions, not conversation.

### `context_compacted` event reuse

No new event type. The existing `context_compacted` event's `data.preserved`
array is what the message-builder already replays. We continue producing the
same shape:

```ts
{
  type: 'context_compacted',
  data: {
    strategy: 'track-based',         // new value
    messagesCompacted: number,       // count of events folded
    preserved: PreservedMessage[],   // [prefix-user-message, ...verbatim-tail-messages]
  }
}
```

The existing `'summarize'` and `'truncate'` strategy values stay valid for
back-reading existing events; we just stop _writing_ them.

## Trigger and lifecycle

### Signal

Pressure =
`(lastCallInputContextTokens + cacheCreationInputTokens + cacheReadInputTokens) / contextWindowSize`,
all fields read with `?? 0` for forward-compat across providers. (Non-Anthropic
providers that don't emit cache fields produce the right formula naturally.)

Thresholds:

- **60% global** — compact at end of next eligible turn
- **90% emergency** — compact at end of next eligible turn even if 60% trigger
  already fired in this session

Gate: only fire when
`turn_end.stopReason ∈ {end_turn, stop_sequence, max_turns}`. Error/abort stop
reasons are skipped — the model's state is unreliable, and we'll re-evaluate on
the next clean turn.

### Hook placement

Inside `runner.run()`, synchronously after the `turn_end` event is written and
before returning to the caller. The runner is already inside its `runExclusive`
scope; the compaction event is appended via the same raw `appendDurableEvent` +
`writeSessionState` path the runner uses elsewhere.

```ts
// runner.ts — pseudocode, inside runExclusive
await appendDurableEvent(sessionDir, state, { type: 'turn_end', ... });
const pressure = computePressure(turnEnd.usage, contextWindowSize);
const shouldCompact = shouldFireCompaction(pressure, recentCompactionState);
if (shouldCompact) {
  try {
    const events = await readAllSessionEvents(sessionDir);
    const result = await compact(events, ctx);
    await appendDurableEvent(sessionDir, state, result.compactionEvent);
  } catch (err) {
    logger.error('compaction failed', { err, sessionId });
    emitOpsAlert(`compaction failed in session ${sessionId}: ${err.message}`);
    // No persistent disable. Next turn re-evaluates.
  }
}
```

`/compact` slash command and `ent/session/compact` RPC continue to call
`compact(events, ctx)` themselves and write the result via their existing write
paths (writeAndAdvance for the slash command, raw append inside the RPC's
existing runExclusive scope). Each caller deals with its own write path — we
don't try to hide this behind a single helper, because lace already has these
two patterns and they're orthogonal to the compaction logic.

## Compaction algorithm

### `compact()` signature

```ts
export async function compact(
  events: TypedDurableEvent[],
  ctx: CompactionContext
): Promise<CompactionResult>;
```

`CompactionContext` is the existing type. Adds nothing new in v1; the existing
`agent` / `provider` reference is what we use for the optional LLM-summary call.

`CompactionResult` is the existing type. We populate `compactionEvent` with the
new `track-based` strategy id and `preserved` with the rendered conversation.

`compact()` is **pure**: it does not write events. The caller writes. This
intentionally avoids the "two write paths" trap from prior spec revs —
`compact()` doesn't know whether its caller is already in a `runExclusive`
scope.

### Algorithm

```
1. Skip filter: drop existing `context_compacted` events.
   (Always rebuild from canonical; prior compactions are not consulted.)

2. Walk events to build turnId → track:
   - For each `turn_start[T]`, look back for the most recent `prompt` event
     with the same eventSeq predecessor. T.track = prompt.data.track ?? 'untracked'.
   - Mid-turn `context_injected` events are NOT folded into T's track —
     they're their own one-event slices.
   - Top-level (out-of-turn) `prompt` and `context_injected` events use their
     own track.

3. Tail boundary: find the last N=10 complete turns. Snap leftward if the
   boundary would split an assistant tool_use from its tool_result (same as
   the current summarize-strategy's snap logic, kept verbatim).

4. Earlier events (before tail boundary): group by track.

5. Per-track salience extraction (see table below). Each track produces a
   markdown block.

6. Render: concatenate the per-track blocks under labeled headings, then
   append the verbatim tail as PreservedMessage entries.

7. Return CompactionResult with:
   - strategy: 'track-based'
   - messagesCompacted: count of earlier events folded
   - preserved: [
       { role: 'user', content: <rendered markdown> },
       ...verbatim tail messages
     ]
```

### Per-track salience filters

| Track kind               | What we keep                                                                                                                                                                                                                     | What we drop                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `slack:*`                | Deterministic Q&A extraction: inbound message texts (deduped by source_id since slack-context-v2 makes them addressable), Ada's outbound `slack/send_message` arguments. Format: "User X said: ...; You said: ..." per Q&A pair. | `<recent>` re-replays (already de-duplicated by slack-context-v2's delta logic), `slack/fetch_messages` tool-result bodies |
| `job:*`                  | "Delegated <description> → outcome: <completed/failed/in-flight>" using fields from `job_started` + `job_finished`.                                                                                                              | Full notification text, `job_output` tool-result bodies, subagent transcripts                                              |
| `alarm:*` / `reminder:*` | Drop entirely. Render a single roll-up at end: "scheduler has N alarms, M reminders pending — use `list_alarms` / `list_reminders` for details"                                                                                  | The notification body itself; queryable state is in the scheduler MCP                                                      |
| `system:bootstrap`       | Drop entirely. (The bootstrap context_injected only fires once at session start with the persona/model config. The persona files on disk are the source of truth; system_prompt_set is the durable record.)                      | Everything                                                                                                                 |
| `system:idle-errors`     | One-line roll-up: "K idle-error reports since last compaction."                                                                                                                                                                  | Notification bodies                                                                                                        |
| `untracked`              | Deterministic prose extraction similar to current summarize: walk events, emit role+content lines. LLM fallback if block > 5K tokens.                                                                                            | n/a                                                                                                                        |

### LLM fallback (per-track, opt-in by size)

Each track block is sized after deterministic extraction. If a single track's
block exceeds 5,000 tokens (char/4 estimate), summarize that track via one
cheap-model call using the same provider as the session.

Prompt: minimal, track-flavored. Example for a Slack track:

> Summarize this Slack thread conversation. Preserve who said what, decisions
> reached, and open questions. Output at most 800 tokens.

Two retries if the output is over 2× the soft budget. Then accept whatever the
model returned (do not loop forever).

Most tracks never need an LLM call. For Ada's 2,036-event fixture, only the two
most active Slack threads have any chance of exceeding 5K tokens
deterministically.

### Rendering

The compaction result's first preserved entry is the prefix user-message:

```markdown
[Earlier conversation, compacted by track]

## Slack threads

### DM with @U0A2GP26U94 (channel D0B3HV2MUKZ)

- They said: "you are brand new. we're just checking in. What's your full name?"
- You replied (via slack/send_message): "..."
- They said: "can you log into your shell box and see if you can install a
  linear cli?"
- You delegated job_4b28e42d (survey linear CLI options) → failed
- You delegated job_8bbf1ddc → completed, recommended `@linear/cli`
- They said: "Hey. We just rebuilt your container. Are you there?"
- [no reply yet]

### #channel C0ABM2LCZ9V

- @U0A2GP26U94 asked browser-driver to fetch BBC headlines
- ...

## Subagent jobs

- job_a5e15760 ✓ subagent IP check → 13.57.47.194
- job_72ad4575 ✗ record name in persona — 404 "opus" model not found
- job_4b28e42d ✗ survey linear CLI options — image pull denied
- job_8bbf1ddc ✓ linear CLI re-survey → @linear/cli recommended
- ...

## Scheduler

3 alarms scheduled, 1 reminder pending. Use `list_alarms` / `list_reminders` for
details.

## System events

2 idle-error reports since last compaction.
```

Then the verbatim tail (last 10 turns) follows as separate `PreservedMessage`
entries with their original roles.

### Always rebuild

Every `compact()` call re-reads canonical events from the start of the session.
Prior `context_compacted` events are filtered out — they're synthetic and don't
represent canonical truth. Because tracks are demuxed independently and each
track's deterministic extraction is cheap (regex/counting), the total compute is
bounded by the size of the canonical log, not by the summary cascade pattern
that broke prior spec revs.

This sidesteps PRI-1828 entirely: there's no "stale summary preservation across
compactions" because we never read prior summary text as input.

## Tail policy

- **N = 10 turns verbatim.**
- A "turn" starts at `turn_start[T]` and ends at the matching `turn_end[T]` (or
  the next `turn_start` if no terminal end exists yet — the in-progress trailing
  turn).
- The boundary cannot split an assistant `tool_use` from its `tool_result`. If
  it would, snap leftward until safe. (Same algorithm as
  `summarize-strategy.ts:splitAtSnappedBoundary`, kept.)
- If the entire session is ≤ 10 turns, return events unchanged (no compaction
  event).

## Failure handling

- Throw from `compact()` → caller logs at ERROR level + emits an ops alert (one
  Slack message to a known ops channel).
- No persistent disable. No `compactionDisabled` field on SessionState. No
  backoff state machine.
- The pressure stays high; the next turn will re-evaluate and either fire again
  or wait for pressure to drop (e.g., model finishes a tool-heavy turn whose new
  events shift the cache window).
- Rate-limit the ops alert: at most one alert per 10-minute window per session,
  regardless of how many compactions fail in that window. Implementation: a
  simple in-memory `Map<sessionId, lastAlertAt>` in the runner; no durable
  state.

## Concurrency

- `compact()` is pure and stateless. It takes no lock.
- Each call site already has its own write context:
  - **Runner lifecycle hook**: already inside `runExclusive`. Writes the result
    via raw `appendDurableEvent`.
  - **`ent/session/compact` RPC handler**: already inside its own `runExclusive`
    (`session-operations.ts:468`). Writes the result via raw
    `appendDurableEvent`.
  - **`/compact` slash command**: not in `runExclusive`. Writes via
    `writeAndAdvance`, which itself wraps in `runExclusive`.

This is the same pattern lace uses today for other event writes. No new locking
primitives. No "deadlock guard" — `compact()` doesn't take a lock, so deadlock
isn't possible.

## Subagent sessions

Subagent sessions are themselves lace sessions with their own event logs. They
use the same compaction strategy with no changes. Their event logs typically
have one or two tracks (bootstrap + the delegating prompt) and rarely hit the
60% threshold because their lifetimes are short. The code path is shared.

## Cutover

- **Same window as slack-context-v2 reset.** When the new slack-context-v2 reset
  marker fires for Ada (clearing her events.jsonl), this strategy lands in the
  same lace build.
- **Producer changes ship in lockstep.** sen-core slack listener (already
  changing for slack-context-v2), sen-core delegate, and scheduler MCP all gain
  `track`-stamping in the same PR wave.
- **No migration tool.** Ada's pre-cutover events.jsonl is wiped; her persona
  files on disk are untouched. Her on-disk knowledge / journal / scheduler state
  survive.
- **No fleet-wide backfill.** Other agents (none in production today besides
  Ada) will be created post-cutover and never see pre-track events.

## Build / repo plumbing

Files created:

- `packages/agent/src/compaction/track-compaction.ts` — exports `compact()`,
  demux, per-track filters
- `packages/agent/src/compaction/track-render.ts` — markdown renderer
- `packages/agent/src/core/conversation/compaction-trigger.ts` — pressure
  evaluator + 60/90 thresholds
- `packages/agent/src/compaction/__tests__/track-compaction.test.ts` — unit
  tests
- `packages/agent/src/core/conversation/__tests__/compaction-trigger.test.ts` —
  trigger tests

Files modified:

- `packages/agent/src/storage/event-types.ts` — add `track?: string` to
  `PromptData` + `ContextInjectedData`; add `lastCallInputContextTokens` to
  `TurnEndUsage`
- `packages/agent/src/core/conversation/runner.ts` — write
  `lastCallInputContextTokens` on `turn_end.usage`; hook compaction trigger
  after `turn_end`
- `packages/agent/src/conversation/slash-commands.ts` — `/compact` now calls
  `compact()` from `track-compaction.ts`
- `packages/agent/src/rpc/handlers/session-operations.ts` —
  `ent/session/compact` calls `compact()` from `track-compaction.ts`; legacy
  `strategy: 'trim-tool-results'` wire value removed

Files deleted:

- `packages/agent/src/compaction/summarize-strategy.ts`
- `packages/agent/src/compaction/summarize-strategy.test.ts`
- `packages/agent/src/compaction/registry.ts` (the strategy registry — only
  consumer was `compact-dropped-messages.ts`)
- `packages/agent/src/compaction/compact-dropped-messages.ts` (legacy adapter)

External (lockstep PRs in sen-core):

- `sen-core-v2/src/slack/listener.ts` — compute and stamp `track` on every Slack
  envelope (uses `installScope.teamId` + envelope channel + effective thread_ts)
- `sen-core-v2/src/jobs/job-dispatcher.ts` — stamp `track: 'job:<jobId>'` on
  every job-return `context_injected` call
- `sen-core-v2/mcp-servers/scheduler.ts` — stamp `track: 'alarm:<id>'` /
  `'reminder:<id>'` on every alarm/reminder fire

## Testing

### Unit (offline, no live API)

Run against `sen2/compaction/fixtures/ada-main/events.jsonl` (the existing
2,036-event Ada fixture):

- **Demux:** assert every turn maps to a track; assert the distribution roughly
  matches what we manually counted (118 + 184 Slack prompts in two channels, ~50
  jobs, ~32 system).
- **Slack track salience:** assert that `<recent>` blocks are dropped (the
  deterministic extractor reads only the new-message portion of each prompt).
- **Job track salience:** assert that `job_output` tool-result bodies are
  dropped from the compacted block; only `job_started.description` and
  `job_finished.outcome` survive.
- **Alarm/reminder track salience:** assert that alarm/reminder content
  disappears entirely from the rendered prefix and is replaced with the roll-up
  line.
- **Tail policy:** last 10 turns appear verbatim; boundary snap correctness when
  the 10th-back turn ends in a tool_use whose result is one turn later.
- **LLM fallback:** mock the provider; assert it's called only when a track
  block exceeds 5K tokens.
- **Always-rebuild:** run `compact()` twice in sequence; assert the second
  call's output is byte-identical to the first (because no new events were
  added).

### Integration

- **Compact the Ada fixture end-to-end.** Measure token count of the rendered
  prefix; assert it's < 30K tokens for a 2,036-event session.
- **Run `compact()` from a real lace process** against a temp-dir session
  populated by replaying the Ada fixture. Verify the `context_compacted` event
  lands in storage and the message-builder reconstructs the expected
  conversation.

### Smoke (live, post-deploy)

- Deploy the new strategy to Ada with track-stamping enabled in sen-core. Watch
  for 24 hours.
- **Cost check:** compare per-turn input-token cost before vs after. Expected:
  meaningful reduction once Ada has enough history to trigger compaction
  (typically 2-3 hours of activity).
- **Behavioral check:** Ada should be able to continue active Slack threads
  after compaction. Look for "I forgot what we were talking about" symptoms in
  her replies — they shouldn't appear.

## Implementation order

**Phase 1 — Track field plumbing.** Ships in same PR wave as slack-context-v2.

- Lace: add `track?` field to event types + storage parsers (no consumer logic
  yet).
- sen-core: stamp `track` in slack listener, delegate, scheduler MCP.
- Lands as a single coordinated PR pair.

**Phase 2 — `compact()` against the fixture.** Pure offline.

- Build `track-compaction.ts` + `track-render.ts` + unit tests in
  `sen2/compaction/` harness.
- Demonstrates expected output against Ada's fixture.

**Phase 3 — Wire trigger + replace old strategy.**

- Add `compaction-trigger.ts` + `lastCallInputContextTokens` to lace runner.
- Update `/compact` slash + RPC handlers to call the new `compact()`.
- Delete `summarize-strategy.ts`, `registry.ts`, `compact-dropped-messages.ts`.

**Phase 4 — Deploy + monitor.**

- Ship lace + sen-core builds together with the Ada reset marker.
- Smoke for 24 hours, then declare done or file a follow-up.

## Open questions

1. **Per-channel vs per-thread granularity for Slack.** I'm defaulting to
   per-thread (`channel:thread_ts`). If Ada uses few enough threads that
   per-channel rollup is preferable for rendering, we can group at render time
   without changing the demux key. **Decision: ship per-thread, defer rollup to
   render-time tuning.**

2. **The 5K-token soft cap for LLM fallback.** Arbitrary. May need tuning
   post-deploy. Filing a follow-up kata to revisit after a week of production
   data.

3. **What if a track has a single huge tool result mid-history?** (e.g., a
   50K-token `bash` output.) Deterministic extraction drops verbose tool results
   by default — we render them as `[bash: cmd → exit 0]`. If the model needs the
   actual content, it can re-run the command or use scheduler state. This is the
   serf-style "reference replaces content" pattern. Mentioned here to avoid
   re-asking it during implementation review.

## Reference: source material

- Current code: `lace/packages/agent/src/compaction/summarize-strategy.ts` (254
  lines, being replaced)
- Inspiration: `inspo/serf/agent/context_manager.go` (deterministic checkpoint
  pattern — `checkpoint()` function at line 549)
- Inspiration: `inspo/hermes-agent/trajectory_compressor.py` (head +
  middle-summarize + tail algorithm)
- Coordinating spec:
  `sen2/sen-core-v2-worktrees/slack-agent-message-context/docs/specs/2026-05-25-slack-agent-message-context-spec.md`
- Test fixture: `sen2/compaction/fixtures/ada-main/events.jsonl`
- Research source: `sen2/compaction/docs/research/working-memory-compaction.md`
  (the multi-section capsule research; v1–v6 spec attempted to faithfully
  implement it; this spec deliberately picks a smaller subset)
