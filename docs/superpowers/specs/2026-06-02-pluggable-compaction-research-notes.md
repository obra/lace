# Pluggable Compaction — Research Notes (working capture)

Date: 2026-06-02
Status: research capture, feeding the design. NOT the spec yet.

## Goal (confirmed by Jesse)

Make lace compaction **pluggable** so customers (sen) can supply custom
compaction *regimes*. Three concrete asks:

1. An **agent-callable tool** that lets lace compact its own session.
2. **Injected notifications** when the context window crosses **configurable
   breakpoints**.
3. A way for customers to supply **custom compaction regimes**. Sen's regime is
   multi-stage and looks nothing like a coding agent's:
   - **De-interleave** the messages of the many concurrent conversations the
     top-level sen "person" runs in one session (Slack threads + tool calls +
     inbound notifications, all multiplexed).
   - **Rewrite in transcript form**, inlining outbound tool calls and inbound
     notifications into readable per-conversation transcripts.
   - A **custom micro-summarizer** compacts each transcript down, preserving
     each participant's intent + the information/nuance they shared, trimmed,
     plus "here's the tool call to read the full conversation".
   - A **triage layer** decides which conversations stay **inline**, which
     become **one-line pointers**, and which get **dropped** (staleness /
     irrelevance / etc).

## Current system (as built, in lace `main` @ 8aba67833)

### Event-sourced sessions
- Session = `events.jsonl` of `TypedDurableEvent`s (discriminated union in
  `packages/agent/src/storage/event-types.ts`): `prompt`, `turn_start`,
  `tool_use`, `message`, `turn_end`, `context_injected`, `context_compacted`,
  `job_started`/`job_finished`, `alarm`/`reminder`, etc.
- Replayed by message-builder into provider messages each turn.

### Tracks (the de-interleave primitive — ALREADY EXISTS)
- `PromptData.track?` and `ContextInjectedData.track?` carry a `track` string.
- Convention `<kind>:<id>`: `slack:<teamId>:<channel>:<thread_ts|ts>`,
  `job:<jobId>`, `alarm:<id>`, `reminder:<id>`, `system:idle-errors`,
  `system:bootstrap`, `untracked`.
- Producers (sen-core: slack listener, job dispatcher, scheduler) stamp the
  track. **This is sen's current — and only — customization surface.**

### Shipped compaction: "track-based" (single hardcoded strategy)
- `packages/agent/src/compaction/track-compaction.ts`
  - `compact(events, ctx: CompactionContext): Promise<CompactResult>` — **pure,
    async, does NOT write**; caller writes the returned `context_compacted` event.
  - `CompactionContext = { threadId; provider?; agent?; modelId? }`.
  - `CompactResult = { compactionEvent: {type:'context_compacted', data} } | { noop:true }`.
  - Pipeline already implemented (deterministic):
    1. `splitAtTailBoundary(events, TAIL_TURNS=10)` → `{earlier, tail}` (never
       splits a turn / tool_use+result pair).
    2. `buildTurnToTrackMap` + `groupEarlierEventsByTrack` → demux earlier
       events by track. **(= the de-interleave stage)**
    3. `salienceForTrack(trackId, events)` → per-track extraction; returns
       `null` to DROP (alarm/reminder/bootstrap). slack → transcript-form
       `<slack-thread><slack_message from=...>` (= transcript stage, deterministic);
       job → "delegated X → outcome" one-liner; idle-errors → roll-up.
    4. `maybeShrinkBlock` → per-track LLM summarize **only if block > 5_000 tok**
       (`SOFT_TOKEN_CAP_PER_TRACK`). (= a crude micro-summarize stage.)
    5. `renderCompactionPrefix` (`track-render.ts`) → markdown prefix grouped by
       kind (Slack threads / Subagent jobs / Scheduler / System / Other).
  - Output: one `context_compacted` event whose `preserved[]` = `[prefix
    user-message, ...verbatim tail]`.
- **Trigger** (`core/conversation/compaction-trigger.ts`): pure predicates.
  - `computePressure(usage, contextWindowSize)` prefers
    `usage.lastCallInputContextTokens / contextWindowSize`.
  - `shouldFireCompaction({stopReason, pressure})`: fires at GLOBAL 0.60,
    EMERGENCY 0.90; only on clean stop reasons (end_turn/stop_sequence/max_turns).
  - **Thresholds are hardcoded constants.**
- **Wiring** (`core/conversation/runner.ts` ~L1043): in the turn-end `finally`
  block, computes pressure, and if `shouldFireCompaction`, reads all events,
  calls `compact()`, and writes the `context_compacted` event under
  `runExclusive`. Failures logged, never abort the turn; no persistent disable.

### Notifications (infra EXISTS)
- `notifications/inject-notification.ts`: `injectNotification()` writes a
  `context_injected` durable event (`<notification>` wrapper, priority
  `immediate`), and optionally idle-wakes the session to run an internal turn
  (`IdleWakeHooks`: isActive / hasActiveTurn / triggerInternalTurn).
- So "inject a notification at a breakpoint" has a ready-made primitive; what's
  missing is the breakpoint *evaluator* + config + the wake decision.

### The registry was DELIBERATELY REMOVED
- An older `compaction/registry.ts` + `CompactionStrategy` interface +
  `TrimToolResultsStrategy` existed; the track-based work deleted them.
  Non-goal quote: *"Multi-strategy registry... There's one strategy. If we want
  a second one later, we add the plumbing then."*
- `docs/design/threads.md` still describes `registerCompactionStrategy()` — that
  prose is STALE.
- **This task is exactly "add the plumbing then."**

### Prior art / history (don't repeat)
- `2026-05-25-typed-capsule-compaction-strategy-design.md`: a structured
  schema-validated "capsule" (13 sections: currentLiveSituation, participants,
  agentSelfContinuity, commitments, decisions, openQuestions, userCorrections,
  emotionalContext, chronology, exactLanguageToPreserve, toolState, doNotInfer).
  **Paused after 6 non-converging revision rounds.** Track-based replaced it.
- `2026-05-25-working-memory-compaction-research.md`: research report behind the
  capsule. Argues compaction should be **pluggable strategies** (trim / summary /
  typed-summary / edit / native / hybrid, cf. Inspect AI). Also proposes (future,
  unbuilt): agent-facing `request_working_memory_checkpoint` +
  `mark_tool_result_ephemeral` tools, and a "runtime owns compaction, agent only
  *requests* it" principle (#7).

### Offline harness (separate repo, complementary)
- `sen2/compaction/` standalone CLI: size / view (HTML transcript) / harness.
  Has its OWN `CompactionStrategy { name; compact(events,{meta}): TypedDurableEvent[] }`
  registry (sync) used for offline A/B against Ada's ~2036-event fixture. Reads
  sessions offline; does NOT run in production. The chosen algorithm graduates
  into lace by hand; the *fixture* graduates into lace tests.

## Implications for the design
- We are re-introducing a strategy seam that was intentionally cut. The bar:
  keep the seam **narrow** and avoid the typed-capsule tar pit (it died from
  scope/convergence, not from lack of a registry).
- The de-interleave + transcript stages already exist as concrete code for the
  slack/job/system tracks — sen's regime can likely be expressed as a
  *parameterization/extension* of that pipeline rather than a from-scratch
  strategy. Open question: stage-level plugin (override micro-summarizer +
  triage) vs whole-strategy plugin (replace `compact()` wholesale).
- Three asks map to three seams: (1) self-compact tool → agent tool that
  *requests* runtime compaction; (2) breakpoints → configurable trigger +
  notification injection; (3) regimes → the strategy seam itself.

## Resolved design decisions (brainstorming, 2026-06-02)
- **Granularity:** Whole-strategy plugin. `CompactionStrategy { name; compact(events,
  ctx): Promise<CompactResult> }` + registry; `track-based` is the default built-in;
  sen registers `sen-multiconv`. ALSO export the existing stages (splitAtTailBoundary,
  demux, transcript renderers, buildPreservedTail) as a composable toolkit so regimes
  reuse rather than reinvent.
- **Selection:** Per-persona declaration. Persona catalog entry names its strategy +
  breakpoints; resolved at agent/persona boot. Default = track-based.
- **Breakpoints:** Per-breakpoint action — `{ at, action: 'notify' | 'compact', urgent? }`.
  Generalizes today's 60/90 trigger. notify → inject notification; compact → runtime
  runs the regime. Emergency (top breakpoint) = compact.
- **Self-compact tool:** Request + optional **free-text guidance** passed into the regime
  (its summarizer/triage LLM consumes it). Runtime owns the actual compaction; agent
  never hand-edits history. track-based default ignores guidance.
- **Scope:** Plumbing + the FULL sen `sen-multiconv` regime as proving reference impl.
- **Sen regime — per-conversation summary:** light structured envelope **rendered as
  markdown (NOT JSON)**: participants, intent, shared info/decisions, open threads, +
  read-full pointer.
- **Sen regime — triage (inline/pointer/drop):** Hybrid. Deterministic prefilter on
  staleness/resolution; LLM triage pass for the ambiguous middle, honoring the agent's
  free-text guidance.
- **Sen regime — pointer target:** `recall` (works for any conversation; read from lace's
  indexed history), but **keep Slack metadata (channel/thread ref) visible** in the
  rendered pointer so the agent can also re-fetch live via fetch_messages if it wants.
  Implies adding a track/conversation filter to the recall tool/index.

## Adversarial panel findings (3 Opus reviewers, 2026-06-03) — VERIFIED

**Headline (verified against code):** the `track` de-interleave primitive is
UNWIRED on the live path.
- `track` absent from `SessionPromptParamsSchema` / `EntSessionInjectParamsSchema`
  (both `.strict()`); prompt handler never writes it; `injectNotification` never
  sets it; zero sen-core producers stamp it.
- `track?` lives ONLY on `PromptEventData` / `ContextInjectedData`
  (event-types.ts:27,139) — NOT on `tool_use`/`message`. Un-stamped ⇒ `untracked`.
- ⇒ Today everything buckets `untracked`; shipped track-based compaction
  de-interleaves nothing in prod. **Confirm with Jesse: is track-stamping
  known-pending integration, or latent?** Either way it's a hard prerequisite.

**Attribution is structurally wrong for concurrent threads (verified):** lace is
single-turn (`SessionBusy` on `activeTurn`); sen multiplexes threads via mid-turn
`ent/session/inject`. `buildTurnToTrackMap` attributes a whole turn to the
preceding prompt's track, so cross-thread replies inside one turn mis-file.
Outbound `slack/send_message` carries its TRUE dest in `input.channel`/`thread_ts`
but `slackSalience` reads only `input.text`. ⇒ demux must derive track from tool
input / per-message, NOT the enclosing turn.

**recall `track` filter is an FTS migration, not a column add:** no track column
(index-db.ts), `eventToRow` is stateless per-event, FTS5 can't `ALTER ADD COLUMN`
⇒ full rebuild/backfill; and track on tool_use/message doesn't exist (above). The
rendered `convRef` uses hardcoded `T0FIXTURE` and won't match a real slack track
id. Pointer as specced resolves to nothing.

**Seam hardening (Reviewer A):**
- Breakpoint "recompute fired-state from log" is INFEASIBLE — nothing marks which
  breakpoint fired or at what `at`. ⇒ store `highestFiredAt` in `SessionState`.
- `buildPreservedWithPrefix` (the no-consecutive-user-role invariant) is NOT in
  the toolkit exports; message-builder replay only strips orphan tools, won't
  repair back-to-back same-role. ⇒ export it + registry runs `validatePreserved()`
  on every regime output (reject empty/whitespace/consecutive-same-role).
- once-per-crossing + reset-on-SUCCESS breaks current behavior on noop/<10-turn
  sessions (fires once, noops, never resets). ⇒ reset on measured pressure, not
  "successful compaction."
- §4 deadlock claim is mis-described: `run()` isn't under `runExclusive`; real
  hazard is `injectNotification` appending WITHOUT the lock. ⇒ run notify writes
  under `runExclusive`; rewrite §4.
- compact_session turn-state cell doesn't exist; must add a mutable ref in `run()`
  passed into the tool. Strategy resolution must be LAZY (first compaction), not
  boot — else registration-ordering race.

**Strategic consensus (Reviewer C, echoed by A+B): SPLIT.**
- Registry revival is JUSTIFIED (the deferred "add plumbing later" coming due) —
  do NOT re-litigate. Seam itself is clean, narrow, event-preserving. No fatal.
- But yoking `sen-multiconv` (5 LLM stages, knob-dense, stub-only-testable) to the
  seam re-imports the exact failure mode that killed typed-capsule across 6 rounds.
  ALL the YAGNI/nondeterminism lives inside sen-multiconv; none in the seam.
- ⇒ **Spec A (ship now, lace):** seam + registry + toolkit (+ validate) +
  compact_session + breakpoints + track-based-onto-toolkit. Default behavior
  unchanged, deterministically testable, explicit phase plan, Phase 1 merges alone.
  CUT `resolveModel` (sen-core builds its own providers). KEEP the 0.90 default gate.
- ⇒ **Spec B (downstream, sen-core-v2):** sen-multiconv, graduated through the
  offline Ada-fixture harness (where LLM-judgment stages belong), incl. recall
  track filter + pointers.
- ⇒ **Spec 0 (prerequisite):** wire `track` end-to-end (protocol + producers +
  per-message attribution). Blocks B, not A.

## REBASE onto the built plugin system (2026-06-03, late)

Another engineer implemented the lace plugin system on `pri2012-shim-lace`
(a5210d5a1..bf641bf7e, not pushed). Most of the original Spec A SHIPPED. Specs
redesigned to conform. As-built (verified in code):
- `LACE_PLUGINS` loader + `register(api)`/`meta`/`manifest` + async `boot()`
  (loads before frames) + subagent reach via env inheritance (`plugins/loader.ts`,
  `main.ts:101`, `jobs/subagent-spawn.ts:48`). ONE loader (not LACE_COMPACTION_PLUGINS).
- 4-registry `PluginApi`; `api.compaction.register(name, strategy)`, owner-injected,
  dup→fatal (`plugins/api.ts:36`, `registry.ts:20`).
- `CompactionStrategy {name; compact(events,ctx)}`, `CompactResult`,
  `CompactionContext = {threadId, sessionDir, provider?, agent?, modelId?}`
  (`compaction/types.ts`). NO guidance, NO resolveModel.
- `validatePreserved` + `mergePreservedAdjacent` (`compaction/strategy.ts:21`,
  `toolkit.ts:51`). 3 call sites routed; track-gate removed. `compact()` unchanged.
- Persona schema already has `compaction: {strategy?, breakpoints?}`
  (`persona-registry.ts:109`); `compactionStrategyNameForSession` consumes
  `strategy` (`compaction/select.ts`). **`breakpoints` is DEAD — schema-only, no
  consumer.** Trigger still hardcoded 0.6/0.9 (`compaction-trigger.ts:6`).
- Toolkit promotion DEFERRED (only mergePreservedAdjacent promoted). Capability
  manifest = only `'credentials'`; reading events / using provider is ungated.

Embedder doc (`sen-core-v2/docs/superpowers/specs/2026-06-03-lace-embedder-architecture.md`,
Part 7) confirms: the worktree's loader/register(api) FOLD INTO the built system;
its `compact_session` + breakpoints remain; lace leads, compaction conforms.

**Spec re-scope (this is what the worktree now owns):**
- Spec A → only: (1) wire the dead `compaction.breakpoints` field → evaluator
  (replace hardcoded 0.6/0.9) + `SessionState.highestFiredBreakpointAt`; (2)
  `compact_session` tool + additive `CompactionContext.guidance`; (3) additive
  `CompactionContext.resolveModel?(modelId)` (connection-scoped) — the ONLY in-process
  model-mixing seam, since as-built ctx gives only one concrete provider.
- Spec 0 (track wiring) — unchanged; demux lives in track-compaction.ts (not a
  promoted toolkit yet).
- Spec B (sen-multiconv) — a `LACE_PLUGINS` plugin via `register(api)`/
  `api.compaction`; OWNS toolkit promotion (demux/tail/renderer); uses
  guidance+resolveModel from Spec A; persona selects it via the built `strategy` field.

## Panel round 3 (2026-06-03) — applied; kept de-leak in Spec A (scoped down)

3-opus panel on the rebased specs. One real blocker + precision fixes; all applied:
- **Demux ownership contradiction (the blocker):** Spec A §4 called the demux
  domain-neutral while Spec 0 §0.3 added slack attribution to it "in place," and the
  code already synthesizes `job:` tracks in the demux. FIX (all 3 converged):
  `demuxByTrack(events, attributeFn)` = pure kernel primitive; attribution
  (slack-send→track, prose→nearest-send) becomes the PLUGIN's `attributeFn`. Spec 0
  shrinks to STAMPING only (§0.1/§0.2) + delete `T0FIXTURE`; it no longer edits the
  kernel demux. Spec B owns the slack attributeFn.
- **De-leak is SLACK-ONLY:** jobs/alarms/reminders/system are kernel-generic (subagent
  lifecycle = kernel per embedder doc) → stay. Generic salience helpers
  (untracked/job/alarm/system) are EXPORTED in the toolkit so both the kernel default
  AND the plugin render non-slack tracks from one source. Only Slack moves to the plugin.
- **§3 `query` contract fixed to the code:** `createResponse` returns `.content` (not
  `text`), no `TokenUsage` type, `model` required → resolve session default; runner's
  turn provider is `cleanup()`'d before the post-turn hook → `oneShotQuery` builds a
  fresh provider. Bind `ctx.query`+`guidance` at all 3 call sites (not just runner);
  `ent/session/compact` gains optional guidance.
- **Spec B split:** B-surface (slack attributeFn + renderer + recall track column/
  filter/indexer-scope — pinnable now) vs B-regime (LLM stages — harness-graduated).
- Minor: `ctx.agent.generateSummary` already dead (no site passes it); golden test is
  a refactor check on toolkit primitives, slack assertions move to plugin suite;
  delete stale types.ts doc comment when removing vestigial provider/modelId/agent.
- Structural call (Jesse): **keep the de-leak in Spec A, scoped down** (not a separate
  spec). Panel verdict was "ship-with-named-cuts"; A §1–§3 clean, §4 needed the demux
  split (done).

## No-deploy-until-built (2026-06-03, Jesse)

Nothing deploys to sen until the whole thing is built; don't worry about breaking
sen. ⇒ DROP the de-leak migration sequencing (the a→d "gate the de-leak on
sen-multiconv being live so sen never regresses"). Build the end-state directly:
kernel default domain-neutral from the start, slack/job rendering in the sen plugin
from the start, no transitional preservation. Golden test guards only the Layer-1
extraction refactor, not the kernel default's end-state behavior.

## Two refinements (2026-06-03, Jesse) — SUPERSEDE `resolveModel` + "promote 6 funcs"

1. **Drop `resolveModel`; add a kernel one-shot LLM `query`.** Handing a plugin an
   `AIProvider` to drive+clean-up was the wrong altitude. lace already has the floor
   (`createProviderForTurn` + `provider.createResponse`); wrap it as a kernel
   `oneShotQuery({connectionId, model?, messages})`, bound at the compaction call
   site to the session connection, exposed as `ctx.query({messages|prompt, model?})`.
   Lower-level (one stateless call, no provider object/lifecycle), model-mixing via
   the `model` arg, and it **subsumes `agent.generateSummary`**. Generic kernel
   primitive (not compaction-specific). After the de-leak (below), the kernel
   default needs no model access → `provider?/modelId?/agent?` become vestigial.
2. **Toolkit = the kernel/plugin seam; de-leak slack from the kernel ("clean seam").**
   `track-compaction.ts` has ~11 slack refs — sen-domain logic in the kernel, against
   the "lace = generic kernel" thesis. Layer 1 (domain-neutral: splitAtTailBoundary,
   demuxByTrack, buildPreservedTail/WithPrefix, generic prefix assembler,
   mergePreservedAdjacent) → promote to `@lace/agent/compaction/toolkit`. Layer 2
   (slack transcript/ref + job/alarm salience + the LLM shrink) → MOVE OUT to the sen
   plugin (Spec B). Kernel default strategy becomes domain-neutral + deterministic.
   Migration a→d gates the de-leak (step d) on `sen-multiconv` being live so sen never
   regresses.

## Topology & extension mechanism (decided 2026-06-03) [SUPERSEDED by the rebase above — mechanism C is now the built LACE_PLUGINS loader]

**sen-core and lace are SEPARATE PROCESSES.** sen depends only on
`@lace/ent-protocol`, spawns the lace agent as a child (`lace-supervisor.ts`), and
talks NDJSON JSON-RPC over stdio. sen does NOT link `@lace/agent`. ⇒ "register a
strategy in-process from sen" is impossible.

Existing extension patterns: client passes config at `session/new`/`session/prompt`
(`mcpServers: McpServerConfig[]` that lace spawns; `persona` + persona search
paths). lace already reverse-calls the client once (`peer.request('host/spawn/env')`).
`ent/session/compact` already exists (sen `force-compact` CLI fires it, takes a
`--strategy`). sen and lace share the session dir on disk.

**Decision: mechanism C — in-process plugin bundled into the lace image.** sen
builds the lace image (sen-docker); it bundles `sen-multiconv` as a module; lace
dynamic-imports it at boot (`LACE_COMPACTION_PLUGINS`) and registers it. Persona
selects by name. Runs in lace's process → synchronous full event access, no
connected-client dependency (no detached-fallback case needed).

**Consequence: `resolveModel` goes BACK into the seam ctx.** The panel's "cut
resolveModel" was conditioned on the regime running in sen's process (rejected
mechanism A). In-process (C) the regime can't reach models otherwise, so lace
injects `resolveModel(instanceId, modelId)` backed by `ProviderInstanceManager`
(keyed on instanceId per panel's verification). sen configures the image's
provider instances/credentials, so model-mixing is realizable.

**Specs produced (2026-06-03):**
- `2026-06-03-track-propagation-spec0.md` — prerequisite (+ prod-bug flag).
- `2026-06-03-pluggable-compaction-design.md` — Spec A, shippable lace seam.
- `2026-06-03-sen-multiconv-regime-specB.md` — Spec B outline.

## Panel round 2 (post-split + mechanism C) — VERIFIED & RESOLVED

Reviewed the 3-spec set. Decision: **keep mechanism C with corrected rationale.**
Verified-true findings, all now folded into the specs:
- lace runs from the **bind-mounted, main-sen-rewritable checkout** (not baked
  image); only the credential broker/helper are image-baked. ⇒ C's "trusted because
  in the image" rationale was false. Corrected to: rewritable-checkout trust, plugin
  touches only main-sen's OWN session + creds, no privilege crossing, loaded only
  from a boot allowlist. (Spec A "Extension mechanism".)
- **Three compaction call sites** (`runner.ts`, `ent/session/compact`,
  `/compact`); two bypass the registry, and `ent/session/compact` hardcodes
  `track-based`. ⇒ all three route through `getCompactionStrategy` +
  `validatePreserved`; gate removed. (Spec A §4 + Phase 1.)
- `resolveModel` must be **async** (getInstance is async + HTTP catalog). Fixed.
- Breakpoint reset must key off **each turn's measured pressure**, not a
  nonexistent "post-compaction pressure"; justification was backwards. Fixed (§3).
- `validatePreserved` needs its **own** same-role merge algorithm;
  buildPreservedWithPrefix only does the leading-prefix merge. Fixed (§1).
- Plugin module load: cross-checkout ⇒ must use **`register(api)` injection** (no
  duplicate `@lace/agent`), and main.ts needs a **real async boot-init** before the
  peer accepts frames; boot-fatal respawns under LaceSupervisor (documented). (§1.5.)
- **Track string was 4 incompatible formats**; outbound send input lacks
  teamId/label; renderer only has `T0FIXTURE`. ⇒ ONE canonical label-free
  conversation key `slack:<teamId>:<channelId>(/<threadTs>)` via a single shared
  `formatSlackConvTrack`/`parseSlackConvTrack`; teamId from session context;
  renderer reads stamped track. (Spec 0 §0.2/§0.3.)
- §0.3 assistant-prose residual **cross-contaminates** sen-multiconv transcripts ⇒
  reclassified Spec-B-blocking; Spec B attributes prose to nearest-following send.
- recall indexer is stateless ⇒ v1 scopes track-filtered recall to
  prompts/injects + sends; prose not track-filterable. (Spec B.)
- Minor: `.strict()` Zod for persona/prompt/inject schemas; notify lock is
  per-process (append is the cross-process safety); `compact_session` threads via
  `ToolContext` + must tell the model to end its turn. All fixed.

Deferred-by-design (not bugs): exact envelope/thresholds/prompts (Spec B harness);
in-turn LLM latency (Spec B risk, measure); guidance injection posture (Spec B).

## Read-full mechanisms found
- `recall` built-in tool (`tools/implementations/recall.ts`): FTS `search` + `read` by
  event_id, backed by `storage/recall/` index. Filters: query, persona, session_id,
  since, until, order. NO track filter today → add one for conversation-scoped recall.
- sen Slack `fetch_messages` MCP (`sen-core-v2/src/mcp/servers/slack/tools/fetch-messages.ts`):
  live channel history / thread replies. Slack track id encodes channel + thread_ts, so a
  pointer can reconstruct it.
