# Pluggable Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each implementer follows superpowers:test-driven-development against the LIVE code — read the cited files; the specs give the interfaces.

**Goal:** Add compaction breakpoints, an agent self-compact tool, a kernel one-shot LLM query, and de-leak Slack from the lace compaction kernel into a sen plugin — all on top of the already-built lace plugin system.

**Architecture:** lace already has the compaction registry, `validatePreserved`, 3 routed call sites, the `LACE_PLUGINS` loader + `register(api)`, and per-persona `compaction.strategy` (verified, branch `pri2012-shim-lace`). This plan adds the remaining compaction-specific surface (Spec A), the `track` substrate (Spec 0), and the deterministic Slack plugin surface (Spec B-surface). The LLM regime (Spec B-regime) is OUT OF SCOPE — it is tuned in the offline `sen2/compaction/` harness, not built via TDD here.

**Tech Stack:** TypeScript (lace `@lace/agent`, `@lace/ent-protocol`; sen-core-v2), vitest, zod, SQLite FTS5 (recall), esbuild (plugin bundle).

**Specs (in this worktree `docs/superpowers/specs/`):** `2026-06-03-pluggable-compaction-design.md` (Spec A), `2026-06-03-track-propagation-spec0.md` (Spec 0), `2026-06-03-sen-multiconv-regime-specB.md` (Spec B). Read the relevant section before each task.

**Repos / worktrees:**
- **lace** — this worktree: `lace-worktrees/compaction-impl` (branch `pri2012-compaction-impl`, off `c52d62ba8`). Phases 1–3.
- **sen-core-v2** — a worktree to be created off `pri2012-sen-docker-shim` at Phase 4 start (controller sets it up then). Phases 4–5.

**Concurrency note:** another session commits to `pri2012-shim-lace`. We are on a dedicated worktree/branch (separate index) so commits don't race. Expect a rebase onto their latest at integration; do NOT commit to `pri2012-shim-lace` directly.

**Out of scope (explicit):** Spec B-regime (micro-summarize, hybrid triage, assemble stages); idle-wake on notify; cross-instance model mixing; the `recall` stateful indexer (v1 scopes track-filtered recall to stamped prompts/injects + sends).

---

## Phase 1 — Lace: Spec A core (breakpoints, self-compact, one-shot query)

### Task 1: Kernel one-shot LLM query (`oneShotQuery`) + `ctx.query` binding

Spec ref: Spec A §3. Verified shapes: `createProviderForTurn` (`providers/turn-factory.ts:16`, async, throws on empty connectionId/modelId), `provider.createResponse(messages, tools, model)` → `ProviderResponse{ content: string; usage? }` (`providers/base-provider.ts:281`). There is NO `TokenUsage` type.

**Files:**
- Create: `packages/agent/src/conversation/one-shot-query.ts`
- Create: `packages/agent/src/conversation/__tests__/one-shot-query.test.ts`
- Modify: `packages/agent/src/compaction/types.ts` (add optional `query` to `CompactionContext`)

- [ ] **Step 1: Failing test.** In `one-shot-query.test.ts`, with a stub provider whose `createResponse` returns `{ content: 'SUMMARY', usage: { promptTokens: 1, completionTokens: 1 } }` and a stubbed `createProviderForTurn` (inject via param/DI — see below), assert `oneShotQuery({ connectionId: 'c', model: 'm', messages: [{role:'user',content:'hi'}] })` resolves `{ text: 'SUMMARY', usage: {...} }`, calls `createResponse(messages, [], 'm')` (empty tools), and calls `provider.cleanup()` exactly once even if `createResponse` throws.
- [ ] **Step 2: Run → FAIL** (`npm test -- one-shot-query`). Expected: module/function not found.
- [ ] **Step 3: Implement.** `export async function oneShotQuery(opts: { connectionId: string; model: string; messages: ProviderMessage[]; signal?: AbortSignal }, deps?: { createProviderForTurn?: typeof createProviderForTurn }): Promise<{ text: string; usage?: ProviderResponse['usage'] }>`. Build provider via `createProviderForTurn({ connectionId, modelId: model })`; `try { const r = await provider.createResponse(opts.messages, [], opts.model); return { text: r.content, usage: r.usage }; } finally { await provider.cleanup?.(); }`. Accept an injected `createProviderForTurn` for testability (default to the real import).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Add `query` to `CompactionContext`.** In `compaction/types.ts`, add `query?: (opts: { messages?: ProviderMessage[]; prompt?: string; model?: string; system?: string; signal?: AbortSignal }) => Promise<{ text: string; usage?: ProviderResponse['usage'] }>;`. Add a doc comment: the binder converts `{prompt, system}`→messages and defaults `model` to the session modelId. Do NOT remove `provider`/`modelId`/`agent` yet (Task 6 retires them).
- [ ] **Step 6: Run typecheck** (`npm run typecheck`). Expected: PASS.
- [ ] **Step 7: Commit.** `feat(lace/compaction): oneShotQuery kernel primitive + ctx.query type`

**Acceptance:** `oneShotQuery` is pure-ish (provider lifecycle owned internally), tested with a stub, cleans up on success and error. `CompactionContext.query` typed and optional.

### Task 2: Bind `ctx.query` + `ctx.guidance` at all three call sites

Spec ref: Spec A §2 (guidance), §3 (binding at all 3 sites). The 3 sites: `core/conversation/runner.ts` (~1066 post-turn block; has `RunnerConfig.connectionId` from `prompt.ts:288`, and `this.config.modelId`), `rpc/handlers/session-operations.ts:476-489` (`effectiveConfig.connectionId`), `conversation/slash-commands.ts:157-162` (`effectiveConfig.connectionId`). They already build `ctx = { threadId, sessionDir, provider, modelId }` and call `resolveCompactionStrategy(name).compact(ctx)` then `validatePreserved`.

**Files:**
- Modify: `packages/agent/src/compaction/types.ts` (add `guidance?: string`)
- Modify: `core/conversation/runner.ts`, `rpc/handlers/session-operations.ts`, `conversation/slash-commands.ts`
- Test: `packages/agent/src/compaction/__tests__/ctx-binding.test.ts` (or extend existing call-site tests)

- [ ] **Step 1: Add `guidance?: string` to `CompactionContext`** (`compaction/types.ts`).
- [ ] **Step 2: Failing test.** A test that constructs each call site's ctx (or a shared `buildCompactionContext({connectionId, modelId, sessionDir, threadId, guidance})` helper — preferred: extract one) and asserts `ctx.query` is a bound function that, when called with `{prompt:'x'}`, invokes `oneShotQuery` with `{connectionId, model: modelId, messages:[{role:'user',content:'x'}]}`. Assert `ctx.guidance` is threaded through.
- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement.** Extract `buildCompactionContext(opts)` in `compaction/` that sets `query` = `(o) => oneShotQuery({ connectionId: opts.connectionId, model: o.model ?? opts.modelId, messages: o.messages ?? [{role:'user', content: o.prompt!}], signal: o.signal })` and passes `guidance`. Use it at all 3 sites. `ent/session/compact` params gain optional `guidance` (thread from `parsed?.guidance`); `/compact` passes its free-text tail as guidance.
- [ ] **Step 5: Run → PASS; typecheck.**
- [ ] **Step 6: Commit.** `feat(lace/compaction): bind ctx.query + guidance at all 3 compaction call sites`

**Acceptance:** All three call sites produce a ctx with a working `query` and `guidance`; built-ins ignore them; no behavior change for `track-based`.

### Task 3: `compact_session` built-in tool + per-turn request cell

Spec ref: Spec A §2. Built-ins register via `registerBuiltinTools()` into `api.tools` (`tools/builtins.ts`). `ToolContext` (`tools/types.ts`) carries runner-injected fields (e.g. `activeSessionDir`, `reminderScheduler`); add one. Tool→runner cell threads `run()` → `executeToolCall` → `executeToolByName` → `ToolContext`.

**Files:**
- Create: `packages/agent/src/tools/implementations/compact_session.ts` + test
- Modify: `packages/agent/src/tools/types.ts` (ToolContext field), `tools/builtins.ts` (register), `core/conversation/runner.ts` (per-turn cell + thread into ToolContext + post-turn read)

- [ ] **Step 1: Failing test (tool).** `compact_session.test.ts`: tool schema is `{ guidance?: string }`; `execute({ guidance: 'g' }, ctx)` sets `ctx.compactionRequest = { requested: true, guidance: 'g' }` (a mutable cell on ToolContext) and returns a result whose text tells the model to **end its turn** (assert it contains "end your turn" / "scheduled"). Does NOT itself compact.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement tool + `ToolContext.compactionRequest?: { requested: boolean; guidance?: string }`** field; register in `builtins.ts` (owner `'builtin'`, uniform dup→fatal).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Failing test (runner wiring).** Integration test: a turn where the agent calls `compact_session` sets the run-scoped cell; assert the post-turn block sees `compactionRequest.requested === true` and runs the resolved strategy with `guidance` in ctx. (Use existing runner test harness; stub strategy records ctx.)
- [ ] **Step 6: Run → FAIL.**
- [ ] **Step 7: Implement runner wiring.** In `run()`, create `const compactionRequest = { requested: false } as { requested: boolean; guidance?: string }`; pass it into the ToolContext built in `executeToolByName`; in the post-turn block change the fire condition to `if (compactionRequest.requested || breakpointCompactCrossed)` (breakpoint var added in Task 4 — for now `compactionRequest.requested || shouldFireCompaction(...)`), passing `guidance: compactionRequest.guidance` into the ctx. Compact at most once per turn.
- [ ] **Step 8: Run → PASS; typecheck.**
- [ ] **Step 9: Commit.** `feat(lace/tools): compact_session tool schedules post-turn compaction with guidance`

**Acceptance:** Agent can schedule compaction; it runs once post-turn via the resolved strategy + `validatePreserved`; guidance flows; tool tells the model to end its turn.

### Task 4: Configurable breakpoints (wire the persona field → trigger)

Spec ref: Spec A §1. Persona schema already has `compaction.breakpoints: [{at:number, action:'notify'|'compact'}]` (`config/persona-registry.ts`, `.strict()`, parsed, zero consumers). Trigger hardcoded `GLOBAL_THRESHOLD=0.6`/`EMERGENCY_THRESHOLD=0.9` (`core/conversation/compaction-trigger.ts:6-7`). `compactionStrategyNameForSession` (`compaction/select.ts`) is the mirror to follow. `injectNotification` (`notifications/inject-notification.ts`). SessionState scalar (`storage/session-store.ts`).

**Files:**
- Modify: `compaction/select.ts` (add `compactionBreakpointsForSession`)
- Modify: `core/conversation/compaction-trigger.ts` (breakpoint evaluator replacing constants)
- Modify: `storage/session-store.ts` (`highestFiredBreakpointAt?: number` on SessionState)
- Modify: `core/conversation/runner.ts` (post-turn: evaluate breakpoints, fire notify/compact, persist/reset scalar under existing `runExclusive`)
- Tests: `compaction-trigger.test.ts`, `select.test.ts`, a runner integration test

- [ ] **Step 1: Failing test — `compactionBreakpointsForSession`.** Returns persona's `compaction.breakpoints` when set; default `[{at:0.60,action:'compact'},{at:0.90,action:'compact'}]` when unset. (Mirror `compactionStrategyNameForSession` tests.)
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Failing test — evaluator.** Pure `evaluateBreakpoints({ pressure, breakpoints, highestFiredAt })` → `{ fire: Breakpoint|null; nextHighestFiredAt: number; reset: boolean }`. Cases: crossing 0.60 first time fires `compact`; same turn ≥0.60 again with `highestFiredAt=0.60` does NOT re-fire (once-per-crossing); pressure below lowest `at` ⇒ `reset:true` (nextHighestFiredAt=0); notify vs compact action returned correctly; ladder `[{0.55,notify},{0.75,notify},{0.90,compact}]` fires the highest crossed not-yet-fired breakpoint.
- [ ] **Step 4: FAIL → implement evaluator in `compaction-trigger.ts`** (keep `computePressure`; replace `shouldFireCompaction` constants with `evaluateBreakpoints`). Keep the clean-stop-reason gate at the caller. → PASS.
- [ ] **Step 5: Add `highestFiredBreakpointAt?: number` to SessionState** + read/write mappers (`session-store.ts`). Test round-trips.
- [ ] **Step 6: Failing test — runner integration.** Post-turn: crossing a `notify` breakpoint calls `injectNotification` (assert event written, under `runExclusive`) and does NOT compact; crossing a `compact` breakpoint runs the resolved strategy; the scalar persists and resets on measured-pressure drop on a later turn; a `<10-turn` noop session fires once and stays quiet.
- [ ] **Step 7: FAIL → implement runner wiring** (read `compactionBreakpointsForSession(sessionDir)` + `state.highestFiredBreakpointAt`; call `evaluateBreakpoints`; on `notify` → `injectNotification` under `runExclusive`; on `compact` → set `breakpointCompactCrossed`; persist scalar; on reset set 0). → PASS.
- [ ] **Step 8: Typecheck; commit.** `feat(lace/compaction): configurable breakpoints (notify/compact) replace hardcoded 0.6/0.9`

**Acceptance:** Persona breakpoints drive notify/compact; once-per-crossing with measured-pressure reset; default reproduces 0.6/0.9 thresholds (once-per-crossing semantics, not every-turn); notify writes under the lock.

---

## Phase 2 — Lace: Spec A §4 (toolkit promotion + Slack de-leak)

### Task 5: Promote the pure toolkit + generic salience helpers (refactor, golden-guarded)

Spec ref: Spec A §4 (A). Today these are private in `compaction/track-compaction.ts` (`splitAtTailBoundary:396`, `buildPreservedTail:539`, `buildPreservedWithPrefix:492`) and `track-render.ts`; only `mergePreservedAdjacent` is in `compaction/toolkit.ts`. `buildPreservedTail` imports `coreToolResultFromProtocol`/`toNonEmptyString` from `rpc/utils.ts` — copy those tiny pure helpers into the toolkit so it's self-contained.

**Files:**
- Modify: `compaction/toolkit.ts` (add exports), `compaction/track-compaction.ts` (re-import from toolkit), `compaction/track-render.ts`
- Test: `compaction/__tests__/toolkit.test.ts`; keep the existing golden `__tests__/track-compaction.test.ts` green

- [ ] **Step 1: Characterization/golden first.** Confirm the existing golden test (`track-compaction.test.ts`, commit 996e6ae91) passes on this branch (`npm test -- track-compaction`). This is the refactor guard.
- [ ] **Step 2: Move `splitAtTailBoundary`, `buildPreservedTail`, `buildPreservedWithPrefix` into `toolkit.ts`** as exports; copy `coreToolResultFromProtocol`/`toNonEmptyString` into the toolkit (do not import `rpc/utils`). Re-export/import from `track-compaction.ts` so its behavior is unchanged.
- [ ] **Step 3: Add `demuxByTrack(events, attributeFn)`** to the toolkit: a pure grouper that buckets earlier events using a caller-supplied `attributeFn(event): string`. Provide a `kernelAttributor` (event.data.track ?? 'untracked'; plus the `job:<jobId>` rule for job events) used by the kernel default. Unit-test grouping with a custom attributeFn.
- [ ] **Step 4: Export the generic salience helpers** — `untrackedSalience`, `jobSalience`, and alarm/reminder/`system:*` roll-ups — from the toolkit (move from `track-compaction.ts`). Add a slack-free generic section renderer (extract the non-slack parts of `renderCompactionPrefix`).
- [ ] **Step 5: Run the golden test → PASS** (track-based output byte-identical). Run new toolkit unit tests → PASS.
- [ ] **Step 6: Typecheck; commit.** `refactor(lace/compaction): promote pure toolkit + demuxByTrack(attributeFn) + generic salience (golden-identical)`

**Acceptance:** Toolkit exports the pure primitives + `demuxByTrack(attributeFn)` + generic non-Slack salience + slack-free renderer; existing golden test still byte-identical (this task changes NO behavior).

### Task 6: Domain-neutral kernel default; delete Slack from the kernel

Spec ref: Spec A §4 (B)+(C). Remove the Slack pieces from the kernel: `<slack-thread>` rendering, `slackSalience`, `extractEnvelopeMetadata`/`T0FIXTURE`, the slack section in `renderCompactionPrefix`, and the `maybeShrinkBlock` LLM path (moves to the plugin in Phase 5). Jobs/alarms/system STAY (toolkit helpers).

**Files:**
- Modify: `compaction/track-compaction.ts` → becomes the domain-neutral default strategy (tail-split + `demuxByTrack(kernelAttributor)` + generic salience + slack-free renderer); delete slack code + `maybeShrinkBlock` + the `provider`/`modelId`/`agent` usage.
- Modify: `compaction/types.ts` (remove vestigial `provider?`/`modelId?`/`agent?` from `CompactionContext`; delete the stale doc comment referencing resolveModel/guidance). Keep `query`/`guidance`.
- Modify: `compaction/__tests__/track-compaction.test.ts` (slack assertions REMOVED here — they move to the Phase 5 plugin suite).
- Modify: any call site passing `provider`/`modelId`/`agent` into the ctx (they keep building a provider for other reasons, but stop putting it in CompactionContext) — verify no compile breaks.

- [ ] **Step 1: Failing test — domain-neutral default.** New test: a session with `slack:`-tracked + `job:`-tracked + untracked events → the default produces job one-liners + untracked prose + tail, and treats `slack:` tracks generically (no `<slack-thread>`, no T0FIXTURE). Assert NO string `T0FIXTURE` / `<slack-thread>` appears.
- [ ] **Step 2: Run → FAIL** (current code still renders slack).
- [ ] **Step 3: Implement.** Rewrite `compact()` to compose the toolkit: `splitAtTailBoundary` → `demuxByTrack(kernelAttributor)` → generic salience per track → slack-free render → `buildPreservedWithPrefix` + tail. Delete `slackSalience`, `extractEnvelopeMetadata`, the slack renderer branch, `maybeShrinkBlock`. Remove `provider`/`modelId`/`agent` from `CompactionContext` + the stale comment.
- [ ] **Step 4: Update the existing golden test** — remove slack-specific assertions (they belong to the plugin now); keep job/untracked/tail assertions.
- [ ] **Step 5: Run → PASS; typecheck the whole package** (`npm run typecheck`) — fix any references to removed ctx fields.
- [ ] **Step 6: Grep guard.** `rg -i "slack|T0FIXTURE" packages/agent/src/compaction` returns nothing (the embedder "no sen refs in lace" invariant). Commit.
- [ ] **Step 7: Commit.** `refactor(lace/compaction)!: domain-neutral kernel default; remove Slack + LLM-shrink from the kernel`

**Acceptance:** No Slack/sen references remain in `packages/agent/src/compaction`; the kernel default is deterministic with no model access; `CompactionContext` is `{ threadId, sessionDir, query?, guidance? }`; package typechecks.

---

## Phase 3 — Lace: Spec 0 §0.1 (track substrate) + Spec B-surface recall

### Task 7: Protocol `track?` on prompt/inject + handler pass-through + `injectNotification`

Spec ref: Spec 0 §0.1. `SessionPromptParamsSchema` + `EntSessionInjectParamsSchema` (`packages/ent-protocol/src/schemas/methods.ts`, both `.strict()`). `PromptEventData`/`ContextInjectedData` already carry `track?` (`event-types.ts:27,139`). `prompt.ts` handler; `notifications/inject-notification.ts`.

**Files:**
- Modify: `packages/ent-protocol/src/schemas/methods.ts` (add `track?: NonEmptyString` to both schemas)
- Modify: `packages/agent/src/rpc/handlers/prompt.ts` + the inject handler (pass `track` into event data)
- Modify: `packages/agent/src/notifications/inject-notification.ts` (optional `track` → event)
- Tests: ent-protocol schema test; prompt/inject handler tests

- [ ] **Step 1: Failing test.** Schema accepts `{ ..., track: 'slack:T:C/123' }` and rejects `track: ''`; handler writes `track` onto the `prompt`/`context_injected` event; `injectNotification({..., track})` sets it.
- [ ] **Step 2: FAIL → implement (3 edits) → PASS.**
- [ ] **Step 3: Typecheck both packages; commit.** `feat(lace/protocol): carry track? on prompt/inject; handlers + injectNotification stamp it`

**Acceptance:** A caller can pass `track` end-to-end into the event log; empty rejected.

### Task 8: Shared `formatSlackConvTrack`/`parseSlackConvTrack` helper

Spec ref: Spec 0 §0.2. Canonical conversation key `slack:<teamId>:<channelId>(/<threadTs>)`, label-free. Lives in a module BOTH lace and sen-core import (alongside `@lace/ent-protocol`, which both already depend on).

**Files:**
- Create: `packages/ent-protocol/src/slack-track.ts` (or agreed shared location) + test
- Modify: `packages/ent-protocol/src/index.ts` (export)

- [ ] **Step 1: Failing round-trip test.** `parseSlackConvTrack(formatSlackConvTrack({teamId:'T',channelId:'C',threadTs:'123'})) === {teamId:'T',channelId:'C',threadTs:'123'}`; channel-level (no threadTs) round-trips; rejects malformed; NEVER includes a label.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit.** `feat(ent-protocol): canonical formatSlackConvTrack/parseSlackConvTrack helper`

**Acceptance:** One shared, golden-tested helper; the only producer/parser of slack conversation tracks.

### Task 9: Recall `track` column + filter (B-surface, lace)

Spec ref: Spec B "Recall pointer (B-surface)". `storage/recall/{event-to-row.ts,index-db.ts,index-writer.ts}`, `tools/implementations/recall.ts`. FTS5 can't `ALTER ADD COLUMN` → bump the index schema version + full rebuild/backfill. v1 scope: track on stamped prompts/injects + `slack/send_message` sends (via `parseSlackConvTrack`/the slack attributor) — prose NOT track-filterable (documented).

**Files:**
- Modify: `storage/recall/index-db.ts` (schema + version bump), `event-to-row.ts` (populate `track`), `index-writer.ts` (insert column), `tools/implementations/recall.ts` (optional `track` filter on `search`)
- Tests: recall index + search-by-track tests

- [ ] **Step 1: Failing test.** Index events with a `track`; `recall.search({ track: 'slack:T:C/123' })` returns only those rows; empty `track` rejected (`.min(1)`); rebuild/backfill repopulates `track`.
- [ ] **Step 2: FAIL → implement** (schema column UNINDEXED `=`-filtered like `session_id`; version bump triggers rebuild; `eventToRow` sets `track` from `event.data.track` for prompts/injects + derives from `slack/send_message` input via the shared helper). → PASS.
- [ ] **Step 3: Typecheck; commit.** `feat(lace/recall): track column + track filter on recall.search (full rebuild)`

**Acceptance:** Track-scoped recall works for stamped prompts/injects + sends; documented that prose isn't track-filterable.

---

## Phase 4 — sen-core-v2: Spec 0 §0.2 producers (NEW WORKTREE)

> **Controller:** before Phase 4, create a sen-core worktree off `pri2012-sen-docker-shim` and copy the specs in. Tasks 10–14 run there. sen-core depends on the lace changes via `@lace/ent-protocol` (`file:` link) — Tasks 7–8 must be merged/available first.

### Task 10: Slack listener stamps `track`

Spec ref: Spec 0 §0.2. teamId from install-scope (`src/slack/enrichment.ts` / handoff-groups), NOT tool input. Use the shared `formatSlackConvTrack`.

**Files:** Modify the slack inbound path that issues `session/prompt`/`ent/session/inject` (`src/slack/*`, `src/ambient/*`); test.

- [ ] **Step 1: Failing test.** An inbound slack message for `(teamId T, channel C, thread 123)` produces a prompt/inject whose `track === 'slack:T:C/123'` via the shared helper.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit.** `feat(sen-core/slack): stamp slack: conversation track on inbound prompts/injects`

### Task 11: Job dispatcher + scheduler stamp `track`

Spec ref: Spec 0 §0.2. `job:<jobId>` on job-return injects; `alarm:<id>`/`reminder:<id>` from the scheduler.

**Files:** Modify job dispatcher + scheduler inject paths; tests.

- [ ] **Step 1: Failing tests** (job-return inject `track==='job:<id>'`; scheduler `alarm:`/`reminder:`).
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit.** `feat(sen-core): stamp job:/alarm:/reminder: tracks`

**Acceptance (Phase 4):** A real sen session shows non-`untracked` tracks on its events (the substrate Spec B needs).

---

## Phase 5 — sen-core-v2: Spec B-surface plugin (Slack attributeFn + renderer)

> Spec B-**regime** (LLM stages) is OUT OF SCOPE — harness-graduated. This phase builds only the deterministic plugin surface: registration, the slack `attributeFn`, and the `<slack-thread>` renderer (the Slack code that left the lace kernel in Task 6).

### Task 12: `sen-multiconv` plugin skeleton + slack `attributeFn`

Spec ref: Spec B "How it plugs in" + stage 1. Module exports `register(api)`; bundled (esbuild, `@lace/agent` external); `api.compaction.register('sen-multiconv', strategy)`.

**Files:** Create `sen-core-v2/src/compaction/sen-multiconv.ts` + `slack-attributor.ts` + tests; build/bundle config.

- [ ] **Step 1: Failing test — slack attributeFn.** `slackAttributor(event, { teamId })`: `tool_use slack/send_message` with `input.channel=C, input.thread_ts=123` → `'slack:T:C/123'` (via shared helper); assistant `message` → nearest-following-send's track in the same turn; else `event.data.track ?? 'untracked'`.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Failing test — attribution under interleave** (the Spec 0/B blocker case): two slack threads interleaved in one turn, a send to each → each send (and its preceding prose) groups under its own thread, not the turn-opener's. Use `demuxByTrack(events, slackAttributor)` from the toolkit.
- [ ] **Step 4: FAIL → implement → PASS.**
- [ ] **Step 5: Plugin skeleton** — `register(api)` registers a strategy whose `compact` uses `demuxByTrack(slackAttributor)` + toolkit primitives; for now non-slack tracks render via imported generic salience and slack tracks render a minimal placeholder (full renderer in Task 13). Test `register` wiring.
- [ ] **Step 6: PASS; commit.** `feat(sen-core/compaction): sen-multiconv plugin skeleton + slack attributeFn (interleave-correct)`

### Task 13: `<slack-thread>` transcript renderer (Layer C)

Spec ref: Spec B stage 1 + Spec A §4 (C) — this is the Slack rendering that left the lace kernel. Renders per-conversation transcript inlining tool calls/results + `context_injected` notifications; pointer uses `recall(track:...)` + visible slack metadata.

**Files:** Create `sen-core-v2/src/compaction/slack-render.ts` + test (port + de-`T0FIXTURE` the logic removed from lace in Task 6; use real stamped track).

- [ ] **Step 1: Failing test.** Given a slack track's events, renders `<slack-thread ref="slack:T:C/123">` with interleaved inbound/outbound messages + inlined tool calls + the recall pointer; NO `T0FIXTURE`; ref comes from the stamped track.
- [ ] **Step 2: FAIL → implement → PASS.**
- [ ] **Step 3: Commit.** `feat(sen-core/compaction): slack-thread transcript renderer (B-surface)`

### Task 14: Register plugin in the image + persona selection

Spec ref: Spec B "How it plugs in". `LACE_PLUGINS` includes the bundled `sen-multiconv`; sen's top persona sets `compaction.strategy='sen-multiconv'` + a breakpoint ladder.

**Files:** Modify sen-docker image/config that sets `LACE_PLUGINS`; the top-level persona `.md` frontmatter.

- [ ] **Step 1: Failing/integration test or smoke.** With `LACE_PLUGINS` pointing at the bundle, boot lace and assert `sen-multiconv` is registered (reuse the plugin reach/integration test pattern). Persona resolves to `sen-multiconv`.
- [ ] **Step 2: FAIL → implement (config + persona) → PASS.**
- [ ] **Step 3: Commit.** `feat(sen-core): load sen-multiconv via LACE_PLUGINS; top persona selects it + breakpoint ladder`

**Acceptance (Phase 5):** sen boots with `sen-multiconv` registered and selected; deterministic de-interleave + slack transcript work; the LLM summarize/triage stages remain stubbed/pass-through pending B-regime harness work.

---

## Deferred (NOT in this plan)

- **Spec B-regime:** micro-summarize (per-conversation `ctx.query` calls), hybrid prefilter+LLM triage, assemble (inline/pointer/drop). Tuned in `sen2/compaction/` against Ada's fixture → written up as Spec B-regime v1. The Phase-5 plugin leaves these as deterministic pass-through (inline raw transcript) so the surface is shippable without them.
- Idle-wake on `notify`; cross-instance model mixing; stateful recall indexer for prose track-filtering.

## Integration

After all phases: rebase `pri2012-compaction-impl` onto the latest `pri2012-shim-lace` (the active session will have advanced it), resolve any `persona-registry.ts`/`compaction/` conflicts, run the full suite, then `superpowers:finishing-a-development-branch`.
