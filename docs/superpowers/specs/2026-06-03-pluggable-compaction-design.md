# Spec A — Compaction: Breakpoints, Self-Compact, One-Shot Query & Kernel De-leak

Date: 2026-06-03 (rev 2 — rebased onto the implemented plugin system) Author:
Jesse + Bot Status: design, pending review Worktree:
`lace-worktrees/pluggable-compaction` (branch `design/pluggable-compaction`)
Conforms to: the lace plugin system implemented on `pri2012-shim-lace` (commits
a5210d5a1..bf641bf7e) and
`sen-core-v2/docs/superpowers/specs/2026-06-03-lace-embedder-architecture.md`.
Siblings: **Spec 0** (track propagation — prerequisite for Spec B) · **Spec B**
(`sen-multiconv` regime — a `LACE_PLUGINS` plugin on `api.compaction`).

## What changed: most of the original Spec A already shipped

Another engineer built the lace plugin system. Its compaction slice (plan Part
C) implemented the bulk of what this spec originally proposed. **Already built —
conform, do not re-spec** (file:line on `pri2012-shim-lace`):

- **Plugin loader + boot.** `LACE_PLUGINS` (one loader, not a
  compaction-specific one), `register(api)` / `meta` / `manifest` module shape
  (`plugins/loader.ts`, `plugins/api.ts:55`), async `boot()` loading plugins
  before frames (`main.ts:101-119`), subagent reach via env inheritance
  (`jobs/subagent-spawn.ts:48`).
- **Registry seam.** `api.compaction.register(name, strategy)`, owner-injected,
  dup→fatal (`api.ts:36-44`, `registry.ts:20`); `registerBuiltinCompaction()` +
  `resolveCompactionStrategy(name)` (`compaction/strategy.ts`).
- **The contract.**
  `CompactionStrategy { name; compact(events, ctx): Promise<CompactResult> }`
  and `CompactResult` (`compaction/types.ts:32-44`).
  `CompactionContext = { threadId; sessionDir; provider?; agent?; modelId? }`
  (`types.ts:14-30`) — note `sessionDir` is present.
- **Replay safety.** `validatePreserved(result)` + `mergePreservedAdjacent`
  (`compaction/strategy.ts:21`, `compaction/toolkit.ts:51`) — empty→noop,
  same-role merge, leading-user forced.
- **All three call sites routed** through the registry with the hardcoded
  track-based gate removed (`runner.ts:1066`, `session-operations.ts:488`,
  `slash-commands.ts:161`).
- **Per-persona strategy selection.** Persona schema has
  `compaction: { strategy?, breakpoints? }` (`config/persona-registry.ts:109`);
  `compactionStrategyNameForSession(sessionDir)` resolves `strategy`
  (`compaction/select.ts`).
- **Built-in `track-based`** wraps the **unchanged** `compact()`
  (`track-compaction.ts:442`; golden byte-identical test, commit 996e6ae91).

So the registry, validation, routing, loader, and strategy-selection are
**done**. This spec is now only the three compaction-specific things the plugin
work explicitly left open.

## This spec owns (the remainder)

1. **Breakpoints — wire the dead schema field.** Persona
   `compaction.breakpoints: [{at, action: 'notify'|'compact'}]` already parses
   but has **zero consumers**; the trigger is still hardcoded `0.6/0.9`
   (`core/conversation/compaction-trigger.ts:6-7`). Wire it.
2. **`compact_session` tool + `CompactionContext.guidance`** — neither exists.
3. **A kernel one-shot LLM `query` primitive** — the as-built context gives a
   plugin one concrete `provider?`/`modelId?` it must drive itself; there is no
   clean way to do a single model-mixed query. Add a low-level kernel primitive
   (replaces the rejected `resolveModel`; subsumes `agent.generateSummary`).
4. **Toolkit promotion + de-leak slack from the kernel** — draw the compaction
   kernel/plugin seam: promote the _domain-neutral_ primitives, and move the
   _sen/slack-domain_ rendering OUT of the kernel into the plugin (Spec B),
   leaving a domain-neutral default strategy. (Decided: "clean seam.")

## Non-goals

- Anything in "Already built" above.
- The `sen-multiconv` regime (Spec B) and `track` wiring (Spec 0).
- Reviving the typed-capsule; changing `context_compacted` / replay.
- API context-overflow mid-stream recovery (existing runner error handling).

---

## Section 1 — Breakpoints (wire the existing persona field → the trigger)

The persona schema field exists; build its evaluator and consumer.

```ts
// already in the schema: { at: number; action: 'notify' | 'compact' }
```

- **Selection.** Add `compactionBreakpointsForSession(sessionDir): Breakpoint[]`
  mirroring `compactionStrategyNameForSession` (same `personaForSessionDir`
  read). Default when unset:
  `[{ at: 0.60, action: 'compact' }, { at: 0.90, action: 'compact' }]` —
  reproduces today's `0.6/0.9` thresholds.
- **Evaluator** replaces the hardcoded constants in `compaction-trigger.ts`.
  Evaluated where `shouldFireCompaction` is today (runner post-turn hook, clean
  stop reasons only — unchanged gate). Pressure = today's `computePressure`.
- **Fired-state in `SessionState`** (recompute-from-log is infeasible — nothing
  in the log marks which breakpoint fired or at what `at`). Add one scalar
  `highestFiredBreakpointAt: number` (`storage/session-store.ts`). A breakpoint
  fires when this turn's measured pressure first exceeds its `at` AND
  `at > highestFiredBreakpointAt`; on fire, set it to `at`.
- **Reset keys off each turn's MEASURED pressure** (not a nonexistent
  "post-compaction pressure" — compaction only shrinks the _next_ turn's
  context). Each post-turn, if measured pressure is below the lowest breakpoint
  `at`, reset to 0. A `<10-turn` session where `compact()` no-ops never drops,
  so it fires once and stays quiet (desired) rather than spamming every turn.
- **Actions.** `notify` → `injectNotification` (pressure %, the breakpoint,
  nudge to wrap up or call `compact_session`); the runner wraps this append in
  its own `runExclusive` to serialize with the compaction write **within this
  process** (cross-process injects are made safe by the event-log append itself;
  `runExclusive` is per-process). Idle-wake off in v1. `compact` → run
  `resolveCompactionStrategy(compactionStrategyNameForSession(sessionDir))` now
  (the built path), result through `validatePreserved`.

One deliberate behavior change vs today: `shouldFireCompaction` currently fires
on _every_ clean turn ≥0.6; the new once-per-crossing fires once per crossing.
Behavior tests must expect once-per-crossing.

## Section 2 — `compact_session` tool + `guidance`

Built-in lace tool registered through the built `registerBuiltinTools()` path
into `api.tools` (owner `'builtin'`). Schema `{ guidance?: string }`. It does
**not** rewrite history mid-turn:

- `run()` holds a mutable per-turn cell
  `{ requested: boolean; guidance?: string }`, threaded to the tool via a new
  `ToolContext` field (same pattern as `reminderScheduler`/`activeSessionDir`:
  `run()` → `executeToolCall` → `executeSingleTool` → `ToolContext`). The tool
  sets it and returns a result that **tells the model to end its turn**
  ("Compaction is scheduled; end your turn to let it run") — not implying
  context already shrank (the tool returns before the post-turn hook compacts).
- The post-turn hook (already the single place compaction runs in the runner)
  becomes: `if (compactionRequest.requested || breakpointCompactCrossed)` →
  resolve strategy → `compact(events, ctxWith({ guidance }))` →
  `validatePreserved` → write. At most one compaction per turn; tool `guidance`
  carried in; auto-fired compactions have no guidance.
- **`CompactionContext.guidance?: string`** — additive field. Built-ins (the
  kernel default) ignore it; sen-multiconv feeds it to its triage stage. **All
  three call sites thread it** (not just the runner): `ent/session/compact`
  gains an optional `guidance` param (it already takes `--strategy`), and
  `/compact` passes its free-text tail (matching pi's
  `/compact [instructions]`). Otherwise an operator-triggered compaction
  silently drops guidance. The same three sites bind `ctx.query` (§3) — each
  already builds a provider via `createProviderForTurn`, so each has the
  `connectionId` to bind.

## Section 3 — The kernel one-shot LLM `query` primitive

`resolveModel` (handing the plugin an `AIProvider` to drive + clean up) was the
wrong altitude. The lower-level primitive: lace already has all the pieces —
`createProviderForTurn({connectionId, modelId})` (`providers/turn-factory.ts`) +
`provider.createResponse(messages, [], model)` (`base-provider.ts:281`). Wrap
them into one atomic kernel operation:

```ts
// kernel service; lace owns provider construction, the single call, and cleanup:
async function oneShotQuery(opts: {
  connectionId: string;
  model: string; // REQUIRED downstream — resolve the default before calling
  messages: ProviderMessage[]; // or { prompt, system } the binder converts to messages
  signal?: AbortSignal;
}): Promise<{ text: string; usage?: ProviderResponse['usage'] }>;
// impl: createProviderForTurn({connectionId, modelId: model}) → createResponse(messages, [], model)
//       → return { text: resp.content, usage: resp.usage } → provider.cleanup() in finally
```

Contract details verified against code (don't repeat the last round's signature
errors):

- `createResponse` returns `ProviderResponse` with **`.content: string`** (not
  `text`) and a `.usage` of `{promptTokens, completionTokens, ...}` — there is
  **no `TokenUsage` type**. `oneShotQuery` adapts `.content`→`text` and passes
  the real usage shape through.
- `createProviderForTurn`/`createResponse` require a **non-optional resolved
  `model`** (the factory throws on empty connectionId/modelId). So `ctx.query`'s
  `model?` defaults to the **session `modelId`**, resolved by the binder before
  the call — never passed empty.
- **Builds a fresh provider.** In the runner, the turn provider is already
  `cleanup()`'d (`runner.ts:983`) before the post-turn compaction block runs, so
  the runner cannot lend it; `oneShotQuery` constructs and disposes its own.

Bound by **each compaction call site** (all three have `connectionId` in scope —
`RunnerConfig.connectionId` from `prompt.ts:288`; `effectiveConfig.connectionId`
at `session-operations.ts:476` and `slash-commands.ts:157`) and exposed as
**`ctx.query({ messages | prompt, model?, system? })`**:

- **Lower-level than `resolveModel`**: one stateless "ask the model once" — no
  provider object, no lifecycle, no cleanup burden on the plugin (strictly below
  `BaseHelper`: no tools, no multi-turn).
- **Model-mixing falls out**: a different `model` per call, on the session's own
  connection/credential. Cross-_instance_ mixing stays out of scope.
- **Subsumes the live LLM path.** Today the only model use in compaction is
  `maybeShrinkBlock` via `ctx.provider.createResponse`
  (`track-compaction.ts:146`); `ctx.agent.generateSummary` is **already dead**
  (no call site passes `ctx.agent`). Once §4 moves that path to the plugin (as a
  `ctx.query` call), the kernel default needs no model access and
  `provider?/modelId?/agent?` become removable (§4).
- **Generic kernel capability**: implement once, bind into each plugin context
  that needs it (compaction now; tools later).

`ctx.guidance` (§2) and `ctx.query` are the only additive context fields, and
**both are bound at all three call sites** (runner hook, `ent/session/compact`,
`/compact`) — see §2 on guidance routing.

## Section 4 — Toolkit promotion + de-leaking slack from the kernel (the clean seam)

`compaction/track-compaction.ts` carries **sen/slack-product logic in the lace
kernel** (~15 slack references: `<slack-thread>` transcript rendering, slack-ref
derivation incl. the `T0FIXTURE` hack, the slack-aware `slackSalience` + the
slack-`#`-sectioned `renderCompactionPrefix` in `track-render.ts`, the per-track
LLM shrink). That violates the embedder doc's MANDATORY "no sen references in
lace" invariant. **The de-leak is Slack-specific** — jobs, alarms, reminders,
and `system:*` are _generic lace concepts_ (subagent lifecycle is kernel per the
embedder doc), so they **stay in the kernel**. Draw the seam in three pieces:

- **(A) The exported toolkit — `@lace/agent/compaction/toolkit`** (pure,
  reusable by any strategy/plugin; safe as a cross-checkout external import).
  Promote: `splitAtTailBoundary`, `buildPreservedTail`,
  `buildPreservedWithPrefix`, the generic section-assembler, and the
  already-present `mergePreservedAdjacent`. Plus a **redefined
  `demuxByTrack(events, attributeFn)`** — a _pure_ grouper that takes a
  caller-supplied `attributeFn(event): string`. This is the fix for the panel's
  central contradiction: the demux is only domain-neutral if attribution is
  injected. Today's demux hard-codes `job:<jobId>` synthesis
  (`track-compaction.ts:65`) and Spec 0 wanted to add slack-send attribution _in
  place_ — both move into attribute functions instead (job attributor = kernel;
  slack attributor = plugin). Caveat (panel): `buildPreservedTail` currently
  imports `coreToolResultFromProtocol`/ `toNonEmptyString` from `rpc/utils.ts`;
  copy those tiny pure helpers into the toolkit so Layer A is self-contained
  (don't drag `rpc/utils` into the toolkit). Also export the **generic
  (non-Slack) salience helpers** — `untrackedSalience`, `jobSalience`,
  alarm/reminder/`system:*` roll-ups — and a **slack-free** generic section
  renderer, so BOTH the kernel default AND the sen plugin render non-Slack
  tracks from one source (the plugin owns the whole compaction, so it needs
  these too). These are domain-neutral (jobs/alarms are kernel concepts), so
  they belong in the shared toolkit, not hidden in the default.
- **(B) The kernel default strategy** (lace built-in; NOT "the toolkit" — its
  own thin composition _of_ the toolkit): tail-split + `demuxByTrack` with a
  **trivial kernel attributor** (`e.data.track ?? 'untracked'`, plus the kernel
  `job:` rule) + the generic salience helpers + the slack-free renderer. **No
  model access** (confirmed: the only LLM use is `maybeShrinkBlock`,
  Slack/oversize, → the plugin).
- **(C) The sen plugin owns all Slack** (Spec B): the slack `attributeFn`
  (`slack/send_message` → `formatSlackConvTrack`, teamId from session context;
  prose → nearest-following-send), the `<slack-thread>` renderer, slack-ref
  derivation, and the oversize LLM shrink as a `ctx.query` call. **No slack code
  remains in the kernel** — the `T0FIXTURE` hack is deleted, not relocated.

**No transitional sequencing — build the end-state directly.** Nothing deploys
to sen until the whole thing is built (Ada-only, we own the box, coordinated
build + `--recreate`), so there is no live sen to regress and no need to keep
slack rendering in the kernel through a transition. Build the target: kernel
default is domain-neutral from the start; the Slack pieces (C) live in the sen
plugin from the start; sen's persona selects `sen-multiconv`. The only ordering
is plain dependency order (toolkit A → kernel default B and plugin C both
compose it), not a safety gate. The toolkit (A) extraction keeps a golden test
purely as a _refactor_ check on the pure primitives — NOT a behavioral promise
for the kernel default (B), whose end-state intentionally differs from today's
track-based (Slack handling is gone). The existing whole-pipeline golden
(`__tests__/track-compaction.test.ts`, commit 996e6ae91) asserts slack output;
its slack assertions move to the plugin's suite.

Also delete the stale `CompactionContext` doc comment that references
`resolveModel`/ `guidance` (`compaction/types.ts:17-18`) when removing the
vestigial `provider?/modelId?/agent?` fields.

> Note: "track-based" today is a sen-flavored strategy in the kernel. After
> this, the kernel built-in is a **domain-neutral default** (untracked + job +
> alarm/system salience, generic render); the _Slack_ substance becomes
> `sen-multiconv`. Keep the name `track-based` for the neutral default or rename
> — minor.

---

## Phasing (dependency-ordered; coordinated build, not incremental-to-prod)

Nothing ships to sen until the whole thing is built, so phases are ordered by
dependency, not by "must preserve behavior at each step." They can still land as
separate PRs for review sanity.

1. **Breakpoints.** `compactionBreakpointsForSession` + evaluator replacing the
   hardcoded constants + `SessionState.highestFiredBreakpointAt` + reset rule +
   `notify`/`compact` actions. Default list reproduces 0.6/0.9. _Mergeable
   alone._
2. **`compact_session` + `guidance`.** Built-in tool + per-turn cell via
   `ToolContext` + additive `CompactionContext.guidance` + post-turn
   integration. _Mergeable alone._
3. **Kernel one-shot `query`.** `oneShotQuery` kernel service + bind `ctx.query`
   at the compaction call sites. _Mergeable alone; lands with / just before Spec
   B, its first consumer._
4. **Toolkit + de-leak.** (A) extract the pure toolkit incl.
   `demuxByTrack(events, attributeFn)` (golden refactor check); (B) build the
   domain-neutral kernel default (untracked+job+alarm+system salience +
   slack-free renderer + kernel job attributor) and delete all Slack from the
   kernel incl. `T0FIXTURE`; (C) Slack lives in the sen plugin (Spec B).
   Dependency: B and C both compose A. No transitional step (nothing deployed).
   Coordinate with Spec 0 (which now only _stamps_, not edits the demux).

## Testing (all deterministic; no LLM)

Breakpoint evaluator (crossing, once-per-crossing, reset on measured drop, noop
session fires-once); `compactionBreakpointsForSession` default + persona
override; `compact_session` (schedules not mid-turn,
both-fire-compacts-once-with-guidance, end-turn copy); `guidance` + `ctx.query`
plumbed to a stub strategy (`query` against a stub provider — model arg honored,
no real LLM); **Layer-1 extraction golden test: the primitives behave
identically before/after promotion** (a refactor check — not a behavioral
promise for the post-de-leak kernel default). The built
registry/validate/routing already have tests.

## Risks

- `SessionState` gains one scalar (small; matches existing per-session scalars).
- The persona `compaction` block is `.strict()` Zod — already includes
  `breakpoints`, so no schema change needed for Section 1 (just a consumer).
- `ctx.query` is connection-scoped (same credential, model-overridable). It is a
  generic kernel primitive, not a compaction bolt-on; built-in deterministic
  strategies never call it. Once §4's de-leak lands, the vestigial
  `provider?`/`modelId?`/`agent?` context fields can be removed (churn deferred
  to that step).
- The §4 de-leak moves **Slack** rendering out of the kernel into the plugin
  (jobs/ alarms/system stay kernel-generic in the toolkit). No transition to
  manage (nothing deployed until the whole thing is built), so the kernel
  default is built domain-neutral directly; the golden test guards only the
  Layer-1 extraction refactor, not a behavioral-equivalence promise for the
  default.
- Spec A still ships against a world where `track` is unwired (Spec 0);
  irrelevant to breakpoints/tool/query — only §4 reuse + Spec B need the demux
  to de-interleave.
