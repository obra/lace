# Spec 0 — Track Propagation & Demux Attribution (prerequisite)

Date: 2026-06-03 Author: Jesse + Bot Status: design, pending review Siblings:
**Spec A** (pluggable seam — does NOT depend on this) · **Spec B**
(`sen-multiconv` — HARD-depends on this)

## ⚠️ Prod-bug flag

The `track` field that the shipped track-based compaction de-interleaves on is
**never populated on any live path** (verified):

- `track` is absent from `SessionPromptParamsSchema` and
  `EntSessionInjectParamsSchema` (both `.strict()`), so a caller cannot pass it.
- `prompt.ts` never writes `track`; `injectNotification()` never sets it.
- **Zero** sen-core producers stamp a `slack:`/`job:`/`alarm:` track.
- `track?` exists only on `PromptEventData`/`ContextInjectedData`
  (`event-types.ts:27,139`), not on `tool_use`/`message`.

⇒ Every event buckets as `'untracked'`; the shipped track-based compaction
de-interleaves nothing today. Under the de-leak (Spec A §4) the kernel default
_intentionally_ stops handling Slack anyway — so this is **not** "a prod bug to
fix in the kernel default." Its real significance: **stamping is the substrate
`sen-multiconv` needs**, and the _protocol/producer wiring_ (not any kernel
de-interleave) is the genuinely-missing piece nothing else builds. Still worth a
Linear note that today's de-interleave is inert, but the fix is stamping + the
plugin, not patching the kernel default.

## Problem

Two gaps:

1. **Input-boundary wiring.** Inbound prompts and injects have no way to carry a
   track from the producer (sen) through the protocol into the event log.
2. **In-turn attribution.** lace is single-turn (`SessionBusy` on `activeTurn`);
   sen multiplexes concurrent Slack threads by issuing mid-turn
   `ent/session/inject` calls while one turn is open. The current demux
   (`buildTurnToTrackMap` + `groupEarlierEventsByTrack`) attributes _every_
   in-turn `tool_use`/`message` to the track of the prompt that opened the turn.
   So when the agent replies to thread B inside a turn opened for thread A, B's
   outbound `slack/send_message` is mis-filed under A. The send's TRUE
   destination is in its own `input.channel`/`input.thread_ts`, which the
   salience extractor ignores (`slackSalience` reads only `input.text`).

## Design

### 0.1 Input-boundary wiring

- Add `track?: NonEmptyString` to `SessionPromptParamsSchema` and
  `EntSessionInjectParamsSchema` (explicit — both are `.strict()`).
- `prompt.ts` / the inject handler pass `track` into the `prompt` /
  `context_injected` event data (the field already exists there).
- `injectNotification()` gains an optional `track` and writes it onto the
  `context_injected` event (so breakpoint/job/scheduler notifications can be
  attributed or deliberately left `untracked`).

### 0.2 The canonical conversation-track key + producer stamping

**One canonical conversation-track format**, defined ONCE and used by every site
that produces or parses it (panel finding: today there are four incompatible
formats — §0.2's old bare-colon stamp, `refs.ts`'s per-message `…|label…@ts`
ref, the renderer's `T0FIXTURE/label/thread`, and a team-less outbound
derivation; an `=`-matched recall filter on these matches nothing).

```
slack:<teamId>:<channelId>(/<threadTs>)      # threaded → with /<threadTs>; channel-level → without
job:<jobId>   alarm:<id>   reminder:<id>   system:idle-errors   system:bootstrap
```

- **Label-free.** Channel labels are display-only and mutable (renames);
  including them makes the key unstable. The existing `formatSlackMessageRef`
  (`sen-core-v2/src/slack/refs.ts`) is a _per-message_ ref (`…|label…@msgTs`) —
  a DIFFERENT thing; do not reuse it as the conversation key.
- **One shared owner.** Add `formatSlackConvTrack(parts)` /
  `parseSlackConvTrack(s)` in a single module both lace and sen-core can depend
  on (e.g. alongside `@lace/ent-protocol`, which both already import), with a
  golden round-trip test. Spec 0 §0.3 (demux), Spec B (recall indexer +
  pointer), and the producers all **import** it — none "mirror" it.

Producers stamp via that helper:

- **Slack listener** → `formatSlackConvTrack({teamId, channelId, threadTs?})` on
  the `session/prompt` / `ent/session/inject` it issues. teamId comes from the
  install scope (`enrichment.ts`), NOT from any tool input.
- **Job dispatcher** → `job:<jobId>` on job-return injects.
- **Scheduler** → `alarm:<id>` / `reminder:<id>`.

### 0.3 Scope boundary — Spec 0 STAMPS; it does NOT edit the demux

**Important (resolves the A/0 demux contradiction the panel found).** Spec A §4
redefines the demux as a pure `demuxByTrack(events, attributeFn)` that takes a
caller-supplied per-event track attributor. So the _attribution logic_ does not
live in the kernel demux — it lives in each strategy's `attributeFn`. Therefore:

- **Spec 0 owns only stamping** (§0.1 protocol + §0.2 producers) — putting a
  real `track` on inbound `prompt`/`context_injected` events. That's genuine
  protocol/producer work nothing else does.
- **Slack-send + prose attribution is the PLUGIN's `attributeFn` (Spec B), not a
  kernel demux edit.** `tool_use slack/send_message` →
  `formatSlackConvTrack({teamId (from session install-scope, not tool input), channelId: input.channel, threadTs: input.thread_ts})`;
  assistant `message` → nearest-following-send in the turn. Spec 0 does NOT
  touch `buildTurnToTrackMap`/`groupEarlierEventsByTrack` in place (Spec A is
  about to promote them into the pure `demuxByTrack` + retire the in-kernel
  `job:`/slack special-casing into attributors).
- **The `T0FIXTURE` renderer reconstruction is DELETED, not fixed** — Spec A §4
  removes the kernel slack renderer entirely and the Spec B plugin renders from
  the stamped `track` correct-by-construction. (Earlier drafts had Spec 0 "fix
  the renderer in place"; under the de-leak that code is removed, so there is
  nothing to fix here.)

Spec 0's value is precisely: **stamping is the substrate `sen-multiconv` (and
any track-aware strategy) needs.** It is NOT "make shipped track-based
de-interleave" — the kernel default after the de-leak is domain-neutral and does
not de-interleave Slack at all.

### 0.4 Timestamps / resolution signals

No new work — `TypedDurableEvent.timestamp` already exists, and `tool_use`
events already carry `result` at write time, so per-track "time/turns since last
activity" and "last message is the agent's" are derivable once the plugin's
`attributeFn` (Spec B) groups correctly on top of Spec 0's stamps.

## Non-goals

- The recall `track` filter / index column — that is Spec B (only the pointer
  needs it). The indexer is **stateless per-event** today (`eventToRow` sees one
  event + `{sessionId, persona}`), so it cannot replicate the turn→track demux
  for assistant prose / non-send tools without becoming stateful. Spec B must
  decide: make the indexer stateful (buffer per-turn track), or scope
  track-filtered recall to the deterministically-attributable events (stamped
  prompts/injects + sends) and document that prose isn't track-filterable. Gated
  on 0.3 + the shared helper.
- True per-message track labels. Spec B uses the nearest-following-send
  heuristic (above) for assistant prose, not real per-message labels.

## Testing (Spec 0 = stamping only)

- Stamping: each producer (slack listener, job dispatcher, scheduler) emits the
  expected canonical track string via the shared helper.
- Round-trip: producer-stamped track parses back via `parseSlackConvTrack`, and
  equals the track a Spec B pointer reconstructs (one golden pinned across
  repos).

(The **attribution-under-interleave** test — two Slack threads in one turn, each
outbound `slack/send_message` groups under its own thread — belongs to **Spec
B**, since the slack `attributeFn` lives in the plugin now, not the kernel
demux.)

## Sequencing

Spec 0 (§0.1/§0.2 stamping + the shared `formatSlackConvTrack` helper) is
independent of Spec A and can land in parallel. Spec B cannot start until
stamping is merged and a real sen session shows non-`untracked` tracks on its
events.
