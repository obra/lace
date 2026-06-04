# Spec B — `sen-multiconv` Compaction Regime (outline)

Date: 2026-06-03 Author: Jesse + Bot Status: outline — depends on the **built**
plugin system (`pri2012-shim-lace`), Spec A's additive seam bits (`guidance` +
the kernel one-shot `query`) + its Layer-1 toolkit promotion, and Spec 0 (track
wiring). Full design + tuning happens against the offline harness, not in this
doc. Home: **sen-core-v2**, shipped as a `LACE_PLUGINS` plugin on
`api.compaction`.

## What it is

The reference custom regime: sen's top-level "person" runs many concurrent Slack
conversations multiplexed into one lace session. `sen-multiconv` de-interleaves
them into per-conversation transcripts, micro-summarizes each, and triages each
inline / pointer / drop. It is what proves the Spec A seam is real for an
external customer.

## How it plugs in (conforming to the built plugin system)

- Lives in `sen-core-v2/src/compaction/sen-multiconv.ts`, **bundled** (esbuild,
  `@lace/agent` external) into one self-contained module shipped in the lace
  checkout the image runs.
- Registered via the built loader: the module **exports `register(api)`** (and
  optional `meta`/`manifest`) and calls
  `api.compaction.register('sen-multiconv', strategy)` — the as-built
  `PluginRegistrar` shape (`plugins/api.ts:55`). It must NOT `import` lace
  runtime singletons (avoids a duplicate `@lace/agent`); for the toolkit
  primitives it needs (below) it imports the **promoted**
  `@lace/agent/compaction/toolkit` exports as external. The image sets
  `LACE_PLUGINS` to include the bundle (one loader; there is no separate
  `LACE_COMPACTION_PLUGINS`).
- sen's top-level persona sets `compaction.strategy = 'sen-multiconv'` (consumed
  by `compactionStrategyNameForSession`, already built) and its breakpoint
  ladder (e.g. `[{0.55,'notify'},{0.75,'notify'},{0.90,'compact'}]`, consumed
  once Spec A §1 wires the field).
- Implements the as-built contract:
  `compact(events, ctx): Promise<CompactResult>` where
  `ctx = { threadId, sessionDir, ... }` **plus** the additive `guidance?` and
  **`query?`** (the kernel one-shot, Spec A §3) Spec A adds. Returns a
  `CompactResult`; the built `validatePreserved` runs on its output at the call
  site.
- Runs **in-process in lace**; mixes models via
  `await ctx.query({ messages | prompt, model })` — one model for the
  per-conversation summary, optionally another for triage, on the session's own
  connection. No provider object, no cleanup, no cross-instance access (not
  needed).
- **Trust posture:** rewritable-checkout trust, touches only main-sen's own
  session
  - own creds. Capability manifest: needs none (the only capability is
    `'credentials'`; reading session events + calling `ctx.query` is ungated).
    So no `manifest` declaration required.

## Pipeline (reuses the Spec A toolkit; new stages are LLM-bearing)

**Layer split (Spec A §4 "clean seam"):** Spec A's toolkit (A) exports the pure
primitives — `splitAtTailBoundary`, `demuxByTrack(events, attributeFn)`,
`buildPreservedTail`, `buildPreservedWithPrefix`, generic section renderer,
`mergePreservedAdjacent` — **plus the generic non-Slack salience helpers**
(`untrackedSalience`, `jobSalience`, alarm/reminder/`system:*` roll-ups). Those
stay kernel-generic; the plugin **imports** them to render the sen agent's own
jobs/alarms. **Spec B owns ONLY the Slack pieces** (Spec A §4 (C)): the slack
`attributeFn`, the `<slack-thread>` renderer, slack-ref derivation, and the
oversize LLM shrink. So sen-multiconv = toolkit (imported) + Slack (owned) + the
LLM stages below. The slack `attributeFn` is correct only after Spec 0 stamping
lands.

1. **De-interleave + transcript render.** Pass the plugin's **slack
   `attributeFn`** into `demuxByTrack`: `slack/send_message` →
   `formatSlackConvTrack({teamId (session install-scope), input.channel, input.thread_ts})`;
   assistant `message` → the nearest-following-send in the turn (so a mid-turn
   reply to thread B lands in B's transcript, not the turn-opener A's); else the
   event's stamped `track`. Then the plugin's `<slack-thread>` renderer inlines
   each conversation's tool calls/results + `context_injected` notifications.
   Non-Slack tracks render via the imported generic salience helpers.
   Deterministic.
2. **Micro-summarize** — one LLM call per conversation (parallel), producing a
   **markdown** envelope (participants / intent / shared info+decisions / open
   threads / read-full pointer). Model(s) chosen per `ctx.query({model})` call;
   small conversations under a token floor inline raw. Per-conversation failure
   → fall back to the deterministic transcript block (never fails the whole
   compaction).
3. **Triage (hybrid)** — deterministic prefilter on staleness + resolution
   (clear-stale → pointer, clear-active → inline); ambiguous middle → one LLM
   call over the small envelopes + staleness metadata + the agent's free-text
   `ctx.guidance`, assigning `inline | pointer | drop`.
4. **Assemble** — inline → full envelope; pointer → one-line gist + pointer;
   drop → omitted (no rollup line; still recoverable via recall). + non-Slack
   blocks + verbatim tail → one `context_compacted` event.

## B-surface vs B-regime (split, per panel)

This spec has two separable parts with very different convergence profiles:

- **B-surface** (pinnable lace changes — design now, deterministic): the slack
  `attributeFn` + `<slack-thread>` renderer (stage 1), and the **recall `track`
  column + filter + indexer-scope decision** below. These are concrete
  schema/code changes gated only on Spec 0's stamping + shared helper; they do
  NOT wait on the harness and should be pinned in a Spec-B-surface design before
  build.
- **B-regime** (LLM-judgment stages 2–4: micro-summarize, hybrid triage,
  assemble): envelope schema, thresholds, token floor, prompts, model
  assignments — **tuned in the offline Ada-fixture harness**, then written up as
  Spec B-regime v1. This is where all the nondeterminism is quarantined (the
  typed-capsule lesson).

## Recall pointer (B-surface)

Pointer = a runnable `recall` call scoped to the conversation, using the
**canonical conversation-track key** from Spec 0 (`formatSlackConvTrack`,
label-free), Slack metadata kept visible for live re-fetch:

```
full: recall(track:"slack:T123:C123/1678…", order:"recent")   (live: fetch_messages channel=C123 thread_ts=1678…)
```

Requires extending `recall`:

- Index a **`track`** column (UNINDEXED, `=`-filtered like `session_id`). FTS5
  cannot `ALTER ADD COLUMN` ⇒ **full index rebuild/backfill**.
- **Indexer track derivation — decide the scope (Spec 0 flags this).** The
  indexer is stateless per-event; it can derive track for stamped
  prompts/injects and for `slack/send_message` sends (via
  `formatSlackConvTrack` + session teamId), but NOT for assistant prose /
  non-send tools without becoming stateful. v1 choice: scope track-filtered
  recall to those deterministically-attributable events and document that prose
  isn't track-filterable (the pointer still recovers the inbound thread + the
  agent's sends — enough to re-read the conversation). Revisit a stateful
  indexer only if that proves insufficient.
- Add an optional `track` filter to `recall.search`. The track is produced and
  parsed **only** through the one shared
  `formatSlackConvTrack`/`parseSlackConvTrack` helper (Spec 0 §0.2) — never
  hand-built — so producer, demux, indexer, and pointer agree by construction. A
  golden round-trip test pins it across the lace and sen-core builds.

## Known risks (carried from the panel; resolve in the harness)

- **Latency / head-of-line block.** Compaction runs inside the runner's
  post-turn path, which the `session/prompt` response awaits. N+1 LLM calls
  (even parallel) hold the turn for seconds on a busy multi-thread session — a
  "person" expected to feel responsive. Measure; consider a cheaper/again-async
  path if it hurts.
- **Free-text `guidance` is a self-steering / injection surface** (the agent,
  fed attacker-controlled Slack text, steers which threads get dropped). Drops
  are silent (no rollup) but recall-recoverable. Decide the trust posture in the
  harness; at minimum, drop must remain recall-recoverable.
- **Nondeterminism** concentrates here (stages 2–3). This is why Spec B is
  separate from the shippable seam and graduates through the offline
  `sen2/compaction/` harness against Ada's fixture, exactly as `track-based` did
  — not through the lace unit suite.

## Out of scope for the outline

Exact envelope schema, staleness thresholds, token floor, prefilter/LLM
boundary, triage prompt, model assignments — all tuned in the harness against
real session data, then written up as Spec B v1.
