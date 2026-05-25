# Typed-Capsule Compaction Strategy — Design (v6)

Date: 2026-05-25 (v1) / revised 2026-05-25 (v2) / revised 2026-05-25 (v3) / revised 2026-05-25 (v4) / revised 2026-05-25 (v5) / revised 2026-05-25 (v6)
Author: Jesse + Bot

> v6 applies round-5 correctness fixes on top of v5. Round 5 surfaced 19 source-verified bugs in v5 — a failure-backoff walk that always terminates on `turn_end` (so N=3/N=10 escalations were unreachable), a `/compact` slash command that is NOT inside an outer `runExclusive` scope despite v5's claim, lifecycle-hook pseudocode that called non-existent `RunnerDependencies.createProviderForTurn`, a `compact()` signature claim that did not actually match `CompactionStrategy.compact()`, a message-builder iterate-and-reset paradox where the summary's reset throws away its own tail events, missing `writeSessionState` calls in the backoff helper, and a handful of dead/contradictory minor items. v6 fixes every one with explicit verifications against current lace `main` (post-PRI-1817/1820/1818/1824/1825/1835). The biggest correctness changes: the backoff walk now skips over `turn_end`/`prompt`/`turn_start` and only terminates on `conversation_summary` or other strategy-relevant events; `/compact` keeps using `writeAndAdvance` (no outer scope = no deadlock risk), and only the in-runner lifecycle hook + the RPC handler use the raw `appendDurableEvent` path because only they are inside an outer `runExclusive` scope; the lifecycle hook pseudocode now imports `createProviderForTurn` directly from `providers/turn-factory.ts` and sources `modelId`/`connectionId` from `this.config` + the same `getEffectiveConfig` channel the RPC handler uses; the new top-level `compact()` is documented as NOT an implementation of `CompactionStrategy.compact()` (only the name matches), and the strategy registry is killed for the typed-capsule path; the message-builder runs a two-pass algorithm with an explicit pre-scan for the latest summary; backoff state writes are explicit. See the "v6 changelog" at the bottom for per-finding traceability; v5/v4/v3/v2 changelogs remain below it for history.

## Purpose

Replace lace's current `summarize` compaction strategy with a new implementation that emits a structured, typed conversation-state capsule into a dedicated durable event. The current strategy synthesizes a `[Earlier in our conversation: …]` USER_MESSAGE that is opaque, drifts across compactions ([PRI-1828](https://linear.app/prime-radiant/issue/PRI-1828)), and silently misses its token budget ([PRI-1827](https://linear.app/prime-radiant/issue/PRI-1827)). Lace currently also defaults to a near-no-op strategy ([PRI-1824](https://linear.app/prime-radiant/issue/PRI-1824)) and triggers compaction from sen-core rather than from lace itself.

This spec defines a single new strategy that supersedes `summarize`, plus the trigger logic that fires it from inside lace's runner. It is the load-bearing tier of the larger working-memory architecture sketched in `compaction/docs/research/working-memory-compaction.md`. Out-of-scope items from that research (compact critic, tool-result clearing as a separate primitive, micro-checkpoints, eval harness, drift detection, multi-user attribution as a first-class concern) are deferred to follow-up katas filed from this spec.

## Non-goals

- The compact critic (research report Phase 2). Adds an extra Anthropic call per compaction.
- Semantic micro-checkpoints + agent-facing checkpoint-request tool (Phase 4).
- Tool-result clearing as a distinct primitive (Phase 3). The capsule has a `toolState` field for future use but stays empty in v1. (Note: `trim-tool-results` is repurposed in v3/v4 as a pre-pass inside the summarize strategy — see §"Compaction algorithm → trim-tool-results pre-pass".)
- Behavioral-equivalence eval harness (Phase 5). Future kata.
- Periodic rebuild drift-detection (Phase 6 — we now always rebuild, so there's no rolling-vs-rebuild drift; bookkeeping for measuring rebuild fidelity itself is still future work).
- Multi-user attribution beyond what the report's `participants` schema already encodes.
- Per-API-call cache-position persistence (related: [PRI-1819](https://linear.app/prime-radiant/issue/PRI-1819) follow-up [PRI-1821](https://linear.app/prime-radiant/issue/PRI-1821) — handled separately).
- Indexing capsule contents in recall/FTS. Recall reads canonical events only; the summary is for the model's working memory, not for search. See §"Recall (FTS) integration".
- A rolling/incremental compaction mode. v4 always rebuilds the capsule from canonical events. See §"Compaction algorithm".
- A bounded-rebuild fallback for sessions whose canonical prefix exceeds the summarizer's context window. v4 lets the summarizer call fail and emits `compaction_failed`; the operator notices via the alarm channel. See §"Failure modes → rebuild exceeds summarizer context".

## Preconditions (must ship before this)

This spec assumes the following are already shipped + deployed in production before any code from this design lands:

1. **PRI-1817 (turn_end cache fields).** Anthropic-pathed sessions need `usage.cacheCreationInputTokens` and `usage.cacheReadInputTokens` populated on `turn_end` for the trigger arithmetic to be correct. **The lace build that introduces the new strategy does NOT refuse to start on pre-PRI-1817 sessions.** The trigger evaluator applies `?? 0` defaults to the cache fields at evaluation time. For Anthropic providers this gives correct arithmetic post-PRI-1817 and degrades gracefully (under-counts cache_read, under-firing) on legacy events. For non-Anthropic providers — which never emit cache fields by design — the `?? 0` defaults produce the right formula. See §"Trigger signal → provider compatibility" for the full provider-by-provider analysis. (This is forward-compat across providers, not legacy back-compat.)
2. **PRI-1818 (always-write turn_end).** The lifecycle hook fires after the runner's `turn_end` write; PRI-1818 guarantees that write always happens, including error paths.
3. **A new `usage.lastCallInputContextTokens` field on `turn_end`.** See §"Trigger signal" — the existing `turn_end.usage.{inputTokens,cacheCreationInputTokens,cacheReadInputTokens}` are **sums across every API call in the turn**, not a single-call snapshot. The trigger needs the last call's on-the-wire context size, not the turn-wide sum. This new field is a tiny add to `runner.ts` and `event-types.ts` and is treated as a precondition kata (file as PRI-XXXX during implementation; the typed-capsule kata does not land until it merges).

## Architecture

The new strategy lives inside lace's existing `compaction/` directory and replaces `summarize-strategy.ts` end-to-end. Trigger code lives in `core/conversation/` next to the runner because it integrates with the turn lifecycle. The message-builder reads the new event type.

Module layout:

```
lace/packages/agent/src/
├── compaction/
│   ├── registry.ts                     DELETED — the typed-capsule path does not register through `CompactionStrategy[]` at all (see §"Strategy registry — removed in v6"). The legacy `createDefaultStrategies()` factory was only consumed by `compact-dropped-messages.ts`, which is also deleted.
│   ├── trim-tool-results-strategy.ts   DELETED — operated on legacy `LaceEvent[]` from threads/types. The new strategy needs a function that operates on `TypedDurableEvent[]`; we extract that as `trimToolResultLines` (top-level in summarize-strategy.ts) and delete the old class entirely. No callers depend on the strategy-registry shape: the only consumer was `compact-dropped-messages.ts`, which is itself deleted.
│   ├── summarize-strategy.ts           REWRITTEN — exports the new top-level `compact()` function (NOT an implementation of `CompactionStrategy.compact()`; only the method name is shared — see §"`compact()` is not a `CompactionStrategy.compact()` implementation (Critical 4)"). Capsule markdown + summarizer prompt + budget-retry + the new `trimToolResultLines(events: TypedDurableEvent[], lineCap: number): TypedDurableEvent[]` helper are top-level functions in this file
│   ├── compact-dropped-messages.ts     DELETED — its `compactDroppedMessagesWithCore` adapter takes `ProviderMessage[]` and routes through the legacy `LaceEvent[]` strategy interface (verified at `compact-dropped-messages.ts:201-237`). With the typed-capsule strategy the slash command and RPC handler call the new top-level `compact()` directly on `TypedDurableEvent[]` from canonical events; no `ProviderMessage[]` adapter is needed. The `ModelPinnedProvider` wrapper is gone with it (see §"Lifecycle hook" for the replacement pattern).
│   ├── capsule-types.ts                NEW — capsule schema (zod)
│   ├── tail-policy.ts                  NEW — last N turns + last K human prompts (single-pass walk)
│   └── __tests__/
├── core/conversation/
│   ├── runner.ts                       MODIFIED — hook after turn_end + new last-call usage field
│   ├── compaction-trigger.ts           NEW — hybrid signal evaluator
│   └── __tests__/
├── conversation/
│   ├── slash-commands.ts               MODIFIED — /compact now emits conversation_summary via the new strategy; wraps the call in try/catch that writes a `compaction_failed{reason:'user_initiated'}` event on error (see §"Writers that produce conversation_summary")
│   └── __tests__/
├── providers/
│   └── base-provider.ts                MODIFIED — `getModelContextWindow` becomes `public` so the trigger evaluator can read it without going through a derived class. One-line visibility change. (Critical 7.)
├── rpc/handlers/
│   └── session-operations.ts           MODIFIED — ent/session/compact emits conversation_summary via the new strategy; legacy 'trim-tool-results' wire option removed; failure path explicitly writes a `compaction_failed{reason:'user_initiated'}` event before rethrowing
├── storage/
│   ├── event-types.ts                  MODIFIED — add conversation_summary + compaction_failed; REMOVE context_compacted; remove `strategy` enum value 'trim-tool-results' from RPC params
│   ├── session-store.ts                MODIFIED — `SessionState` type gains `compactionDisabled?: boolean` and `nextRetryAtEventSeq?: number`; `readSessionState`'s whitelist parser MUST be updated to read both new fields (the function is at `session-store.ts:143-166`; the whitelist body is lines 147-162; type-only additions are silently dropped on read without this change — v6 Minor 1 corrects the v5 citation). See §"Failure backoff → persistent disable round-trip".
│   └── recall/
│       └── event-to-row.ts             MODIFIED — REMOVE context_compacted case; conversation_summary returns null (NOT indexed)
└── message-building/
    └── message-builder.ts              MODIFIED — render conversation_summary as prefix; reject unknown types; skip compaction_failed; ALWAYS run dropOrphanedToolBlocks regardless of whether a summary was rendered
```

Note on the `conversation/` vs `core/conversation/` split: `slash-commands.ts` lives at `packages/agent/src/conversation/slash-commands.ts` (verified). `runner.ts` and the new `compaction-trigger.ts` live at `packages/agent/src/core/conversation/`. Two adjacent folders, deliberately separate in lace's tree. v4 incorrectly merged them.

There is no migration tool in v4 (see §"Cutover: one-time clear of Ada"). The `sen2/compaction/scripts/migrate-old-compactions.ts` path from v2 was dropped in v3 and stays gone.

There is no separate compaction-lock module (cut in v4 — see §"Concurrency"). The runner's existing `runExclusive` is the only serialization primitive.

The old `context_compacted` event type is removed from the discriminated union entirely. There is no on-disk back-compat: the only session in production with `context_compacted` events on disk is Ada, and we wipe her `events.jsonl` rather than rewriting it. Future sessions never see `context_compacted` at all.

### Writers that produce conversation_summary

Three call sites currently produce `context_compacted`. All three are updated to produce `conversation_summary` in lockstep with this change:

1. **The new in-runner trigger** (this spec's main subject). Hook after `turn_end`. Auto-trigger; on failure writes `compaction_failed{reason: 'global' | 'emergency'}` (whichever reason drove the trigger).
2. **`/compact` slash command** in `conversation/slash-commands.ts` (around line 197 today; verified path — note the file is at `conversation/`, not `core/conversation/`). User-initiated; on failure writes `compaction_failed{reason: 'user_initiated'}` before returning the error string to the user.
3. **`ent/session/compact` RPC handler** in `rpc/handlers/session-operations.ts` (around line 551). Programmatic / sen-core-driven. Post-trigger, sen-core no longer drives compaction, so this RPC becomes user-tooling only (`compaction view`, manual ops console). User-initiated; on failure writes `compaction_failed{reason: 'user_initiated'}` before rethrowing the JSON-RPC error.

All three call sites go through the same `compaction/summarize-strategy.ts:compact()` entry point and produce identically-shaped events. The strategy has no notion of caller intent; every call rebuilds the capsule from canonical events. (In v3 the spec allowed a `mode: 'rolling' | 'rebuild_from_canonical' | 'user_initiated'` parameter; v4 collapses this to a single always-rebuild path. The two user-driven call sites were already passing `'rebuild_from_canonical'` in v3, so they need no behavioral change.)

#### Failure write contract for user-initiated callers (Critical 6 in v5; refined in v6 Critical 2)

`/compact` and `ent/session/compact` wrap their `compact()` call in `try/catch` and write a `compaction_failed` event before surfacing the error. They differ in HOW they write — because v6 verified that `/compact` is NOT inside an outer `runExclusive` scope, while the RPC handler IS:

- **`ent/session/compact` RPC handler.** Runs inside `runExclusive(async () => { ... })` already (`session-operations.ts:468`). Its `try/catch` block writes via direct `appendDurableEvent` + `writeSessionState`, the same path the runner's lifecycle hook uses (see §"Lifecycle hook" and §"Strategy internal event writes (deadlock guard)"). Using `writeAndAdvance` from inside this scope would deadlock.

- **`/compact` slash command.** Lives in `conversation/slash-commands.ts` (the handler is invoked from `rpc/handlers/prompt.ts:169` via `handleSlashCommand(...)`). The call site does NOT wrap the slash-command body in `runExclusive`. The slash command uses the `writeAndAdvance` parameter the caller passes in (which itself wraps each write in `runExclusive`); this is correct because there is no enclosing scope to deadlock against. The new strategy adds one more constraint: the new `compact()` call itself must be made OUTSIDE `writeAndAdvance` (which writes a single event), since `compact()` produces one event itself. The slash command writes the `conversation_summary` (or `compaction_failed`) event via the same `writeAndAdvance` it already uses today for `context_compacted`.

Pseudocode for `ent/session/compact` (raw `appendDurableEvent` path, inside the existing `runExclusive` scope):

```ts
// session-operations.ts ent/session/compact handler — already inside runExclusive
try {
  const result = await compact(events, ctx);
  let sessionState = readSessionState(state.activeSession!.dir);
  const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, result.event);
  writeSessionState(state.activeSession!.dir, nextState);
} catch (err) {
  let sessionState = readSessionState(state.activeSession!.dir);
  const { nextState } = appendDurableEvent(state.activeSession!.dir, sessionState, {
    type: 'compaction_failed',
    data: {
      reason: 'user_initiated',
      errorMessage: err instanceof Error ? err.message : String(err),
    },
  });
  writeSessionState(state.activeSession!.dir, nextState);
  throw err;   // RPC rethrows the JSON-RPC error
}
```

Pseudocode for `/compact` (writeAndAdvance path, no outer scope):

```ts
// slash-commands.ts handleSlashCommand 'compact' branch — NO outer runExclusive
try {
  const result = await compact(events, ctx);
  await writeAndAdvance(result.event);  // writeAndAdvance wraps each write in runExclusive
  return finishTurn(`Context compacted. Capsule attached.`);
} catch (err) {
  await writeAndAdvance({
    type: 'compaction_failed',
    data: {
      reason: 'user_initiated',
      errorMessage: err instanceof Error ? err.message : String(err),
    },
  });
  return finishTurn(`Error during compaction: ${err instanceof Error ? err.message : String(err)}`);
}
```

Note the **inner `data.type` field is OMITTED** in both pseudocode blocks (v6 Minor 2): `event-to-row.ts:37-40` documents that the inner `data.type` is NOT serialized — the wire convention has only the outer `type`. Earlier draft pseudocode that wrote `data: { type: 'compaction_failed', reason: ..., errorMessage: ... }` would have produced a redundant field that callers ignore but JSON readers (recall, harness, debug tooling) would see as confusingly duplicated.

Backoff interaction: `compaction_failed{reason: 'user_initiated'}` events do **NOT** count toward the auto-trigger's consecutive-failure backoff. The backoff walk (§"Failure backoff") counts only events whose `reason` is `'global'` or `'emergency'` — operator presses of `/compact` shouldn't trip the M=10 persistent-disable. Failing user-initiated compactions still get a durable telemetry record (the operator can see them in `/compact` logs and dashboards), but they don't escalate. If the operator wants to disable the auto-trigger after seeing repeated user-initiated failures, they can do so explicitly via a future ops command (file a kata if that becomes useful).

### Strategy enum on the wire (RPC + slash)

In v2 the `ent/session/compact` RPC accepted a `strategy: 'summarize' | 'trim-tool-results' | 'selective'` parameter. v3 collapsed this and v4 keeps the collapse:

- `'summarize'` — the only accepted value. Default. Invokes the new typed-capsule strategy. The `trim-tool-results` pre-pass runs inside it (see §"Compaction algorithm → trim-tool-results pre-pass") — operators no longer choose it as a separate strategy.
- `'trim-tool-results'` — **REMOVED from the wire enum.** No longer a user-facing choice.
- `'selective'` — **REMOVED from the wire enum.** Was a stub in v2.

The `trim-tool-results-strategy.ts` file is **DELETED** (see Critical 3 in the v5 changelog and the module layout box). Its trim logic is extracted as `trimToolResultLines` in `summarize-strategy.ts` and called internally by the new strategy. The offline `sen2/compaction/` harness imports the same helper directly. Production runtime callers (slash command, RPC handler) only see `summarize`.

### Strategy registry — removed in v6

`compaction/registry.ts` and the `CompactionStrategy[]` registration model are **DELETED** as part of v6. The legacy registry served only `compact-dropped-messages.ts` (which routed `ProviderMessage[]` through the `CompactionStrategy.compact(events: LaceEvent[], context: CompactionContext)` interface). With `compact-dropped-messages.ts` also deleted, no consumer remains. The new top-level `compact()` in `summarize-strategy.ts` is imported by name directly from the lifecycle hook, the `/compact` slash command, and the `ent/session/compact` RPC handler. No registry indirection.

The `CompactionStrategy` interface in `compaction/types.ts` becomes unused. We delete it along with the registry. If a future second compaction strategy is ever added, the typed-capsule path's pattern (a top-level exported `compact()` function with a typed `CompactionContext`) is what to extend; the legacy `LaceEvent[]`-based interface is not the right base.

## Data model

### New durable event types

Two new entries in `storage/event-types.ts`'s `DurableEventData` discriminated union:

```ts
export type ConversationSummaryEventData = {
  type: 'conversation_summary';
  capsule: Capsule;                     // see capsule-types.ts
  generatedAt: string;                  // ISO timestamp
  /**
   * The first canonical eventSeq that is NOT represented by this summary.
   * Every event with eventSeq < recentTailStartsAtEventSeq is folded into
   * the capsule; every event with eventSeq >= it is the verbatim tail.
   * Because every summary is always cumulative from the start of the session,
   * the inclusive range it represents is implicitly [1, recentTailStartsAtEventSeq - 1].
   */
  recentTailStartsAtEventSeq: number;
  generationMode: 'rebuild_from_canonical';   // single-valued enum in v1 (every summary is rebuilt)
  generationCostUsd: number;
  generationTokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
};

export type CompactionFailedEventData = {
  type: 'compaction_failed';
  reason: 'global' | 'emergency' | 'user_initiated';
  errorMessage: string;                 // single canonical field name
};
```

The old `context_compacted` event type is **REMOVED** from the discriminated union. We do not maintain backwards compatibility (per CLAUDE.md — pre-release v1, no legacy code). The Ada cutover (§"Cutover: one-time clear of Ada") wipes the only on-disk source of `context_compacted` events. Any session that for whatever reason still has `context_compacted` on disk fails loudly at message-builder time with a pointer at the cutover playbook.

Note on `generationMode`: v3 carried `'rolling' | 'rebuild_from_canonical' | 'user_initiated'`. v4 collapses to a single value (`'rebuild_from_canonical'`) because rolling is gone and the user-initiated callers always rebuild. The enum is retained (not removed) so that a future second mode — if one is ever justified — can extend it without a schema break.

Note on `CompactionFailedEventData.reason`: `'user_initiated'` stays on the reason union even though it's gone from `generationMode`. A `/compact` invocation can still fail, and the failure event needs to record that it was operator-driven, not auto-triggered.

Note on the failure event's `consecutiveFailures` counter (present in v3): **dropped in v4.** The count is recoverable from the event log itself by counting `compaction_failed` events since the most recent successful `conversation_summary`. The backoff helper (§"Failure backoff") derives the count at decision time.

### Capsule schema

In `compaction/capsule-types.ts`. Mirrors §6 of `docs/research/working-memory-compaction.md`'s **per-section** sub-schemas. The envelope-level provenance fields all moved up to the wrapping `ConversationSummaryEventData` shown above; the capsule itself is a pure content type.

All 13 capsule sections, zod-validated:

```ts
export const CapsuleSchema = z.object({
  currentLiveSituation: CurrentLiveSituationSchema,
  participants: z.array(ParticipantStateSchema),
  agentSelfContinuity: AgentSelfContinuitySchema,
  commitmentsAndObligations: z.array(CommitmentStateSchema),
  decisionsAndResolvedPoints: z.array(DecisionStateSchema),
  openQuestionsAndUncertainties: z.array(OpenQuestionStateSchema),
  userCorrections: z.array(UserCorrectionStateSchema),
  emotionalAndRelationshipContext: EmotionalAndRelationshipContextSchema,
  importantChronology: z.array(ChronologyItemSchema),
  exactLanguageToPreserve: z.array(ExactSnippetSchema),
  toolState: z.array(ToolResultRefSchema),     // empty array in v1
  doNotInfer: z.array(DoNotInferRuleSchema),
});

export type Capsule = z.infer<typeof CapsuleSchema>;
```

Sub-schemas mirror §6 of the research report's content fields exactly (envelope fields moved up to the event wrapper, as noted).

### Markdown rendering

`renderCapsuleAsMarkdown(capsule: Capsule): string` is a top-level function in `summarize-strategy.ts` (folded in v4 from the previous standalone `capsule-markdown.ts`). Output structure follows §11 of the research report — labeled sections with bullet lists, easy for the model to read. The markdown is what the model sees as the conversation prefix; the JSON is for storage, validation, and diff.

Renderer requirements:
- Skip sections whose array is empty (don't emit empty headers).
- Wrap exact quotes (`exactLanguageToPreserve`) in `> quoted text` blocks with attribution.

## Trigger and lifecycle hook

### Trigger signal

The existing `turn_end.usage.{inputTokens, cacheCreationInputTokens, cacheReadInputTokens}` fields are **sums across every API call within the turn** (verified against `lace/packages/agent/src/core/conversation/runner.ts:598-608`: each tool-use iteration calls the provider, response.usage gets added into `totalInputTokens` etc.). Treating that sum as "on-the-wire context size" would over-count by a factor of N (number of tool-use iterations in the turn) and fire the trigger spuriously.

The trigger reads a new field, `usage.lastCallInputContextTokens` (single integer, populated by `runner.ts` from the LAST provider response of the turn — same scope as the existing `cacheMissReason` field). This is added by a precondition kata (see Preconditions §3). The field represents:

```
lastCallInputContextTokens
  = (lastResponse.usage.promptTokens ?? 0)
  + (lastResponse.usage.cacheCreationInputTokens ?? 0)
  + (lastResponse.usage.cacheReadInputTokens ?? 0)
```

**Field-name precision (refined in v6 Important 7).** Two distinct concerns live in this area; v5 conflated them. The **WRITER** of the durable field (the precondition kata that lands in `runner.ts`) reads `response.usage.promptTokens` from the in-memory `ProviderResponse.usage` shape (`packages/agent/src/providers/base-provider.ts:64-85`, where the uncached-input integer is named `promptTokens`), computes the sum with the `?? 0` defaults shown above, and stores it as the single integer `lastCallInputContextTokens` on `turn_end.usage` (a new field on the durable `TurnEndEventData.usage` shape at `packages/agent/src/storage/event-types.ts:62-82`). The translation site that the precondition kata edits is `runner.ts:598-625` (where each tool-use iteration reads `response.usage.promptTokens` and accumulates) plus `runner.ts:986-1000` (where the accumulators are written into the durable `usage` block); the kata adds one more line in the read block that captures the LAST iteration's three fields, and one more line in the write block that emits the sum. The **READER** of the durable field — the trigger evaluator — only ever reads the on-disk integer `latestTurnEnd.data.usage.lastCallInputContextTokens`, never the in-memory provider response. There is no `promptTokens` access on the reader side. The in-memory-vs-durable shape mismatch is fully encapsulated inside the writer.

For Anthropic: all three fields are populated; the sum IS the on-the-wire prefix size (uncached input + new cache writes + cache reads).

For non-Anthropic providers (OpenAI, Gemini, LMStudio, Ollama, OpenRouter): cache fields are absent (those providers don't have a prompt cache concept on the wire). The `?? 0` defaults reduce the formula to `promptTokens + 0 + 0 = promptTokens`, which is correct: those providers send the full conversation as fresh input on every call, so `promptTokens` IS the full prefix size. (R4 → provider-compat, not back-compat.)

### Provider compatibility

Field names below refer to the **in-memory** `ProviderResponse.usage` shape (the one the formula reads). The durable on-disk `TurnEndEventData.usage` shape uses `inputTokens` instead of `promptTokens` for the same integer; the two are translated by the runner.

| Provider                | promptTokens | cacheCreationInputTokens | cacheReadInputTokens | Trigger arithmetic                                  |
|-------------------------|--------------|--------------------------|----------------------|------------------------------------------------------|
| Anthropic (post-PRI-1817) | y            | y                        | y                    | Sum is the full prefix size on the wire. Correct.   |
| Anthropic (pre-PRI-1817)  | y            | (missing)                | (missing)            | Sum reduces to `promptTokens` (uncached only). Under-counts the prefix → under-fires the trigger. Acceptable degradation; sessions self-heal after the next turn writes cache fields. |
| OpenAI / Gemini / LMStudio / Ollama / OpenRouter | y | (n/a)                | (n/a)                | Sum reduces to `promptTokens`. **Correct** — those providers don't cache and `promptTokens` is the full prefix every call. |

The `?? 0` defaults make the formula work on every provider with no special-casing. **PRI-1817 remains a precondition for Anthropic accuracy**, but the lace build starts on any session regardless of whether PRI-1817 has been applied yet.

### Trigger evaluator

`core/conversation/compaction-trigger.ts` exports:

```ts
export type TriggerConfig = {
  globalThresholdPct: number;            // tuned globally (default 0.60); not per-session-overridable
  emergencyThresholdPct: number;         // tuned globally (default 0.90); not per-session-overridable
};

export type TriggerDecision =
  | { fire: false; reason: 'disabled' | 'below_threshold' | 'no_signal' | 'wrong_stop_reason' | 'backoff' }
  | { fire: true; reason: 'global' | 'emergency' };

export function evaluateTrigger(
  latestTurnEnd: TypedDurableEvent & { data: TurnEndEventData },
  sessionEvents: TypedDurableEvent[],
  modelMaxContext: number,
  config: TriggerConfig,
  isSubagentSession: boolean,
): TriggerDecision;
```

**Performance note (Minor 3):** Callers MAY pass a tail-slice of `sessionEvents` (e.g. the last 100 events) for efficiency on long sessions. The function only inspects (a) `latestTurnEnd.data` for stop-reason + usage, and (b) the trailing run of `compaction_failed` events for backoff. Both inspections are end-of-log only; a slice that covers the last few `compaction_failed` events plus the latest non-failure event is sufficient. v1 implementations can pass the full array; this note is for future optimization.

**Plumbing `isSubagentSession` (Important 9).** `RunnerDependencies` (current shape at `core/conversation/types.ts:58-145`) has no `isSubagentSession` field. The runner needs one added:

```ts
// Addition to RunnerDependencies in core/conversation/types.ts
isSubagentSession: boolean;
```

Derivation at runner construction time (in the call site that builds the `RunnerDependencies` object — `server.ts` is the primary one): `isSubagentSession: Boolean(sessionMeta.parent)`. `SessionMeta.parent?` is the existing optional field at `session-store.ts:45`; truthy iff the session was created as a subagent. No new state, no new RPC, just a derived boolean passed at construction.

Note: `modelMaxContext` is `number` (not `number | null`). See gating rule §4 below for why.

Note: there is no `enabled` flag on `TriggerConfig`. Disabling subagent compaction is computed from the session-meta input (`isSubagentSession` parameter — see §"Subagent sessions"). The failure-backoff path also produces `fire: false, reason: 'disabled'` when the M=10 consecutive-failure cap is hit; that disablement persists via the failure-backoff state, not via this config struct.

Note: there is no `mode` in `TriggerDecision`. Every fire is a full rebuild. Whether to rebuild and how to rebuild is no longer a decision — there is only the rebuild path.

Gating rules (all must pass for `fire: true`):

1. **Not a disabled subagent.** `isSubagentSession === false` (or, if true, the per-session subagent-compaction toggle is on; not exposed in v4 — see §"Subagent sessions").
2. **Successful turn.** `latestTurnEnd.data.stopReason` is in the "ran to natural completion" whitelist: `['end_turn', 'stop_sequence', 'max_turns']`.
   - `end_turn` — model finished a normal response.
   - `stop_sequence` — model hit a configured stop sequence (clean termination by configuration).
   - `max_turns` — runner hit the per-turn tool-use cap; the conversation IS in a stable state, just one the agent didn't naturally finish. Compacting here is safe.
   - **NOT in the whitelist** and rejected — full enumeration (Important 11):
     - `tool_use` — mid-turn; the runner consumes this stop reason inside its agentic loop (`runner.ts:773-795`) and never writes it to a durable `turn_end` event. Listed here for completeness; in practice the trigger never sees a `turn_end` with `stopReason === 'tool_use'`.
     - `pause_turn` — pause-mid-turn; mid-thought.
     - `max_output_tokens` / `incomplete` — response was truncated; the conversation state is mid-thought.
     - `refusal` / `context_window_exceeded` — error paths; conversation may be recoverable but compacting locks in possibly-bad context.
     - `cancelled` / `permission_cancelled` — user-initiated abort paths; not a clean termination.
     - `failed` / `budget_exceeded` — provider failure / runner budget gate; same logic as the error paths.
     - PRI-1818 crash-recovery / defense-in-depth: `process_died` (`event-types.ts:92`) and `prompt_handler_caught` (`event-types.ts:101`) — synthesized turn_ends written after a SIGKILL/OOM or a thrown unhandled error. The process didn't reach a clean turn boundary.
     - PRI-1818 runner-derived error stop reasons (`core/conversation/types.ts:250-256`) — `provider_error_overloaded`, `provider_error_invalid`, `provider_error_network`, `provider_error_other`, `tool_error_throw`, `tool_error_timeout`, `internal_error`. These are written by the runner's finally block when the agentic loop threw mid-turn; the conversation state may be inconsistent. All seven are explicitly rejected. The trigger's stop-reason whitelist remains strict — anything outside `{end_turn, stop_sequence, max_turns}` returns `fire: false, reason: 'wrong_stop_reason'`.

3. **Signal present.** `latestTurnEnd.data.usage?.lastCallInputContextTokens` is a finite positive number. Older transcripts written before the precondition kata lack this field. If missing, log warning + skip (don't compact a session we can't measure). Cache fields are NOT required here — the `?? 0` defaults make `lastCallInputContextTokens` itself the only required input.

4. **Model bound known.** `modelMaxContext` is taken to always be a finite positive number — `base-provider.ts:481-488`'s `getModelContextWindow` ALWAYS returns a number (`catalogModel?.context_window || fallback` with a 200K default fallback). There is no null path. The evaluator's caller passes the result of `getModelContextWindow` directly; the result is always defined. **Visibility change (Critical 7):** `getModelContextWindow` is currently declared `protected` at `base-provider.ts:481`. Change it to `public` so the runner's lifecycle hook can call it directly off `this.provider` without going through a derived class. One-line change in source; documented here so the spec audit catches it. No new wrapper method is needed.

5. **Not in failure backoff.** §"Failure backoff" reads the most recent run of consecutive `compaction_failed` events; if the window says skip, returns `fire: false, reason: 'backoff'`.

If gates 1–5 pass:
- `pct = lastCallInputContextTokens / modelMaxContext`
- If `pct >= emergencyThresholdPct` → `fire: true, reason: 'emergency'`.
- Else if `pct >= globalThresholdPct` → `fire: true, reason: 'global'`.
- Else → `fire: false, reason: 'below_threshold'`.

Thresholds are pure percentages of model max context. No absolute fallback — self-tunes across models (1M-context model fires at 600K for global; 200K-context model fires at 120K). Constants are tuned globally for the whole fleet; per-session overrides are not exposed in v4 (file a kata if anyone needs it).

### Defaults rationale

The headroom arithmetic at the v4 defaults:

- `globalThresholdPct: 0.60` — trigger fires when last-call context hits 60% of model max.
- `emergencyThresholdPct: 0.90` — emergency rebuild at 90%.
- `targetCapsuleTokensPct: 0.10` of model max — capsule budget is 10% of context. For 1M-context Sonnet, capsule budget is 100K tokens.
- `recentHumanPromptsTokenBudgetPct: 0.10` of model max — tail budget is 10% of context. For 1M-context Sonnet, tail budget is 100K tokens.
- Post-compaction state: capsule (10%) + tail (10%) = **20% of context**.
- Headroom before the next trigger fires: **60% – 20% = 40% of context** ≈ **400K tokens at 1M context**.
- Under Ada-like load (~70K tokens/turn growth), 400K headroom buys ~6–10 turns between compactions instead of every-turn churn. The next post-compaction trigger fires when the conversation has actually grown enough to need re-compaction; cache-creation cost (which dominates per-compaction cost) is paid weekly at most under Ada-like load, monthly+ under lighter load.

Subagent default stays compaction-off — see §"Subagent sessions".

Note: v3 included a `rebuildEveryNCompactions: 10` knob and a `SessionState.compactionsSinceLastRebuild` counter so the rolling path could periodically rebuild. v4 dropped both: every compaction is already a full rebuild. There is no counter to maintain.

### Lifecycle hook

In `runner.run()`, immediately after the successful `turn_end` write (the post-PRI-1818-#1 path that always writes turn_end), evaluate the trigger and — if it fires — run compaction inside the runner's existing serialization primitive. The pseudocode shows where every value comes from; v6 fixes v5's reference to non-existent `RunnerDependencies` fields by sourcing `modelId` from `this.config` (verified at `runner.ts:337`), `connectionId` from the same `getEffectiveConfig` channel the RPC handler uses, `modelMaxContext` from `this.provider.getModelContextWindow(modelId)` (after the Critical 7 visibility change), `tailConfig` from the registered defaults, and `createProviderForTurn` imported directly from `providers/turn-factory.ts:16` (NOT from `this.deps`).

```ts
// Imports (added to runner.ts)
import { createProviderForTurn } from '@lace/agent/providers/turn-factory';
import { compact, SUMMARIZER_SYSTEM_PROMPT } from '@lace/agent/compaction/summarize-strategy';
import { evaluateTrigger, DEFAULT_TRIGGER_CONFIG } from '@lace/agent/core/conversation/compaction-trigger';
import { DEFAULT_TAIL_CONFIG } from '@lace/agent/compaction/tail-policy';

// Inside runner.run(), after the successful turn_end write:
const { modelId, sessionDir } = this.config;
const modelMaxContext = this.provider.getModelContextWindow(modelId);
const triggerConfig = DEFAULT_TRIGGER_CONFIG;
const tailConfig = DEFAULT_TAIL_CONFIG;
const targetCapsuleTokensPct = 0.10;

const decision = evaluateTrigger(
  turnEndEvent,
  sessionEvents,
  modelMaxContext,
  triggerConfig,
  this.deps.isSubagentSession,
);
if (decision.fire) {
  // Serialize against the runner's own durable writes using its existing
  // runExclusive primitive. This serves two purposes:
  //   1. Prevents the compaction write from racing the runner's normal
  //      writeAndAdvance calls (same as runner.ts:393-404).
  //   2. Acts as the in-process compaction mutex — re-entrant trigger
  //      evaluation on the same runner naturally serializes.
  // There is no separate compaction-lock module and no file-based flock
  // in v4/v5/v6. See §"Concurrency".
  await this.deps.runExclusive(async () => {
    try {
      // Source connectionId the same way RPC handlers do: via the
      // session-config plumbing. `getEffectiveConfig(state.config,
      // session.state.config)` is the pattern at session-operations.ts:475-476
      // and slash-commands.ts:160. The runner's equivalent reads the session
      // state directly because the runner doesn't have AgentServerState in
      // scope — we read state.json at hook time, then call
      // getEffectiveConfig with a session-config-shaped projection.
      const sessionStateForConfig = readSessionState(sessionDir);
      const effectiveConfig = getEffectiveConfig(
        /* state.config */ undefined,
        sessionStateForConfig.config,
      );

      // Build a FRESH provider for the summarizer call. Do NOT mutate
      // this.provider — its system prompt must remain the agent's persona
      // for subsequent turns. Mirrors the existing /compact RPC handler
      // pattern at session-operations.ts:507-511. `createProviderForTurn`
      // is a top-level export from providers/turn-factory.ts:16 — NOT a
      // method on RunnerDependencies (v5 incorrectly referenced
      // `this.deps.createProviderForTurn`, which does not exist).
      const summarizerProvider = await createProviderForTurn({
        connectionId: effectiveConfig.connectionId,
        modelId,
      });
      summarizerProvider.setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT);

      const result = await compact(sessionEvents, {
        sessionDir,
        summarizer: summarizerProvider,
        modelMaxContext,
        targetTokens: Math.floor(modelMaxContext * targetCapsuleTokensPct),
        tailConfig,
      });

      // Persist the conversation_summary event via direct appendDurableEvent
      // (NOT writeAndAdvance) for the deadlock reason in §"Strategy internal
      // event writes (deadlock guard)". We're inside runExclusive already.
      let sessionState = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, sessionState, result.event);
      // Clear backoff state on successful summary — see §"Failure backoff".
      writeSessionState(sessionDir, {
        ...nextState,
        compactionDisabled: undefined,
        nextRetryAtEventSeq: undefined,
      });
    } catch (err) {
      logger.error('compaction failed; conversation continues uncompacted', {
        err, sessionDir,
      });
      // Persist failure event via direct appendDurableEvent (NOT writeAndAdvance)
      // for the same deadlock reason as above. We're inside runExclusive already.
      // Compute backoff state FIRST, then write event + state together so the
      // post-failure SessionState reflects nextRetryAtEventSeq / compactionDisabled.
      let sessionState = readSessionState(sessionDir);
      const { nextState } = appendDurableEvent(sessionDir, sessionState, {
        type: 'compaction_failed',
        data: {
          reason: decision.reason,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      const consecutive = countConsecutiveAutoFailuresAtEndOfLog(sessionDir);
      const backoffPatch = computeBackoffStatePatch(nextState, consecutive);
      writeSessionState(sessionDir, { ...nextState, ...backoffPatch });
      if (backoffPatch.compactionDisabled === true) {
        emitAlarm(sessionDir, 'compaction-disabled', { consecutive });
      }
    }
  });
}
```

Two pseudocode helpers referenced above are defined in `compaction-trigger.ts`: `countConsecutiveAutoFailuresAtEndOfLog(sessionDir): number` (the walk algorithm from §"Failure backoff"), and `computeBackoffStatePatch(state: SessionState, consecutive: number): Partial<SessionState>` (returns `{ nextRetryAtEventSeq?, compactionDisabled? }` per the doubling table). The inner `data.type` field is OMITTED from the failure-event payload (v6 Minor 2 — `event-to-row.ts:37-40` documents the inner `data.type` is not serialized).

#### Strategy internal event writes (deadlock guard — Critical 1)

The runner's `writeAndAdvance` helper (`runner.ts:392-404`) is defined as:

```ts
const writeAndAdvance = async (event) => {
  await this.deps.runExclusive(() => {
    let sessionState = readSessionState(sessionDir);
    const { nextState } = appendDurableEvent(sessionDir, sessionState, ...);
    writeSessionState(sessionDir, nextState);
  });
};
```

It wraps every write in `runExclusive`. The runner's `runExclusive` is the chained-promise mutex from `server.ts:314-328`:

```ts
const runExclusive = async (work) => {
  const previous = state.sessionMutex;
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  state.sessionMutex = previous.then(() => next);
  await previous;
  try { return await work(); } finally { release(); }
};
```

The mutex chain's `release()` only fires after `work()` returns. If the lifecycle hook's outer `runExclusive(work)` calls `compact()`, and `compact()` internally calls `writeAndAdvance()` (which itself calls `runExclusive`), the inner `await previous` waits on the outer scope's chain. The outer scope's `release` never fires (it's waiting for `compact()` to return) — **the runner deadlocks permanently.**

The fix is structural: `compact()` MUST do its internal `conversation_summary` event append via direct `appendDurableEvent` + `writeSessionState` calls, not through `writeAndAdvance`. The outer `runExclusive` from the lifecycle hook is what provides serialization; the inner write is already protected by it. The `CompactionContext.sessionDir` parameter is what the strategy uses to call `appendDurableEvent(sessionDir, readSessionState(sessionDir), event)` directly.

This MUST be tested:
- **`compaction-hook-deadlock.test.ts`** — synthetic test where `compact()` is stubbed to call `deps.writeAndAdvance(...)` instead of the correct direct path. Test must time out (or assert via a small timeout wrapper) — and the production strategy must pass the same harness with the correct direct-write path.
- **`compaction-hook-success.test.ts`** — drives a real `compact()` call inside the outer `runExclusive`, asserts the `conversation_summary` event lands in the JSONL file, asserts the runner can do its next normal `writeAndAdvance` without hanging.

The same rule applies to **`ent/session/compact`** — its handler at `session-operations.ts:468` runs inside `runExclusive`, so its `compact()` call and the surrounding event writes use the raw `appendDurableEvent` + `writeSessionState` path. **`/compact` is different (v6 Critical 2):** the slash-command handler is invoked from `rpc/handlers/prompt.ts:169` via `handleSlashCommand(...)` with NO enclosing `runExclusive` scope. The slash command uses the `writeAndAdvance` parameter the caller passes in (which internally wraps each write in its own `runExclusive`), and that path is safe — there's nothing outside to deadlock against.

The contract is therefore two-pronged:
- **Inside an outer `runExclusive` scope** (lifecycle hook, `ent/session/compact` handler): write durably via `appendDurableEvent` + `writeSessionState` directly, never via `writeAndAdvance`.
- **Outside any outer `runExclusive` scope** (`/compact` slash command body): use the `writeAndAdvance` helper, which provides its own `runExclusive` per write.

The wrong combination — `writeAndAdvance` inside an outer `runExclusive` — is what deadlocks. The right combination on each side is enumerated above.

Key contract notes:
- **Method name is `compact`, not `runCompaction`** (Important 6). The existing strategy interface (`compaction/types.ts` — `CompactionStrategy.compact(events, ctx)`) names this method `compact`; the new typed-capsule strategy keeps that name for consistency. The runner's lifecycle hook calls `compact(events, ctx)`, not `runCompaction(events, ctx)`. All spec references below use `compact`.
- **Direct `summarizer: Provider` parameter to `compact`** (v4 simplification carried). v3 used a `providerFactory: () => Promise<Provider>` indirection so future hierarchical-rebuild paths could spin up fresh providers per call. With rolling and bounded-rebuild gone, the strategy calls the summarizer exactly once per fire; the caller builds the provider directly and hands it in.
- **No `ModelPinnedProvider` wrapper.** R6 (carried from v3): `ModelPinnedProvider` doesn't isolate the system prompt at request time — `_createResponseImpl` forwards to `inner._invokeCreateResponseImpl`, and the base provider's `getEffectiveSystemPrompt` reads the inner's state when the inner builds its request payload. The proven pattern, lifted from `session-operations.ts:507-511`, is to create a fresh provider instance via `createProviderForTurn` and call `setSystemPrompt` on it directly. The runner's `this.provider` is a different instance and stays untouched.
- **One `runExclusive` scope wraps both the success and failure writes.** v3 split them across two `runExclusive` calls (one for the summary write, one for the failure write); v4 keeps them inside one scope, which is sufficient since the work between them is sequential and we want them to atomically observe the same SessionState.

Hook runs synchronously inside `runner.run()` so the runner's caller knows compaction completed before the next prompt is accepted. The cost: a brief pause after every trigger fires (in practice ~weekly under Ada-like load).

### Concurrency

In-memory serialization via the runner's existing `runExclusive` is the only concurrency control in v4. Behaviors:

- **Same-process re-entrance.** If the trigger fires while a previous compaction is in flight on the same runner, the second `runExclusive` call awaits the first. Because compaction runs synchronously inside `runner.run()`, this is rare in practice.
- **Cross-process compaction (e.g. a CLI inspector script attached to the same session dir).** v4 does NOT defend against this. v3 specified a file-based `flock` to handle it. Rationale for the cut: no production caller does this today; the inspector tools we ship read events, they don't compact; if someone writes a tool that triggers compaction from another process, file a kata then. The signal-cleanup / NFS-locking complexity of `flock` isn't worth carrying for a hypothetical caller.
- **Subagent compaction.** Subagents have their own session directories and their own runners. They don't contend with the parent runner's mutex. (Most subagent sessions have compaction off by default — see §"Subagent sessions".)
- **`context_injected` priority='immediate' lands during compaction.** The injection write goes through `appendDurableEvent` independently. Because the runner's `runExclusive` is the same serialization primitive used by both writers, an in-flight compaction will block an immediate-priority injection until the compaction finishes. Then the next post-compaction turn picks up the injection via `readImmediateInjectsSince`. No special handling.
- **User abort RPC during compaction.** Compaction is opaque to the existing abort plumbing. The abort signal cancels the next turn's prompt, not the in-flight compaction. Compaction runs to completion (or fails), the `conversation_summary` (or `compaction_failed`) event is written, then the runner returns and the abort takes effect. This is the simplest behavior; if compaction-abort becomes important, file a follow-up kata.
- **Concurrent compaction from `/compact` slash or `ent/session/compact` RPC.** Same `runExclusive`. The first caller wins; the second awaits and runs against the freshly-compacted state (so it sees the just-written summary as the latest one and rebuilds again from canonical — operator can re-invoke if needed).

### Subagent sessions

Default: compaction OFF for subagent sessions. Rationale:

- Subagent sessions are typically short-lived and finish well below the 60% global threshold.
- Subagent context is reconstructed every time the parent re-delegates; a compacted subagent prefix can confuse the parent's view of what the subagent "saw".
- Cost-wise, paying for a summarizer call on every subagent that hits 60% would multiply the per-session cost by every active subagent.

The trigger reads `isSubagentSession` from `this.deps` (sourced from session meta at runner construction time). No per-session config knob in v4 — if a long-running subagent does need compaction, file a kata and we'll thread it through. The default is computed; not exposed.

### Failure backoff

`compaction_failed` events accumulate session-scoped consecutive-failure pressure. The count is derived at decision time by walking the event log **from end-of-log backward** (Important 7 — walk start is end-of-log, NOT latest `turn_end`; failure events are written AFTER the turn_end in the lifecycle hook, so a turn_end-anchored walk would miss them).

**Walk semantics (v6 Critical 1 + Important 6).** The lifecycle hook fires AFTER `turn_end`, so consecutive `compaction_failed` events from different turns are SEPARATED by the next turn's `prompt`, `turn_start`, and `turn_end` events. v5's walk terminated on the very first `turn_end` it saw, which meant the count could never exceed 1 and the N=3 / N=10 escalations were unreachable. v6 fixes this:

- The walk **SKIPS** (transparently steps past) every event whose type is on a "non-strategic" allowlist: `turn_end`, `turn_start`, `prompt`, `context_injected`, `message`, `tool_use`, `system_prompt_set`, `job_started`, `job_finished`, `job_update`, `job_session_assigned`, `permission_requested`, `permission_decided`, `permission_cancelled`, `checkpoint_created`, `files_rewound`. These events are normal turn machinery — they do not reset the count and do not increment it. The walk continues past them.
- The walk **INCREMENTS** the count on `compaction_failed` events whose `reason` is `'global'` or `'emergency'`.
- The walk **SKIPS** (transparently steps past, does not increment, does not reset) `compaction_failed` events whose `reason` is `'user_initiated'` — operator presses are transparent to the auto-trigger backoff (v6 Important 6 resolution).
- The walk **RESETS** the count to 0 and TERMINATES on the first `conversation_summary` event. A successful summary clears the backoff regardless of how many failures preceded it.
- The walk terminates when it runs out of events (start-of-log).

In plain words: walk backward, count every `global`/`emergency` failure event you see, ignore everything else, stop the first time you see a successful summary or reach the start of the log.

The count is NOT stored as a field on the failure event (recoverable from the log; see §"Data model"). The walk-test fixture must reflect the realistic on-disk shape — `..., turn_end_N, compaction_failed_N, prompt_{N+1}, turn_start_{N+1}, message_{N+1}, turn_end_{N+1}, compaction_failed_{N+1}, ...` — NOT back-to-back compaction_failed events (which the lifecycle hook cannot produce).

#### Explicit retry-state field (Important 1)

To make the doubling-window behavior explicit, `SessionState` carries a `nextRetryAtEventSeq: number | undefined` field (in addition to the `compactionDisabled?: boolean` field for M=10 persistent disable). The retry-at field is set on every backoff-relevant failure write and read on every trigger evaluation. v4's prior wording "Backoff window doubles each subsequent skip" was underspecified: there was no state field to anchor the doubling against.

State update on failure (computed in the lifecycle hook's catch block AFTER appending the `compaction_failed` event, then written in the SAME `writeSessionState` call that persists the post-append `nextEventSeq` — v6 Critical 6 makes the persistence explicit; see the lifecycle-hook pseudocode for the exact call shape). The helper `computeBackoffStatePatch` is pure:

```ts
// In compaction-trigger.ts
export function computeBackoffStatePatch(
  state: SessionState,
  consecutive: number,
): Partial<SessionState> {
  if (consecutive >= 10) {
    return { compactionDisabled: true, nextRetryAtEventSeq: undefined };
  }
  if (consecutive >= 3) {
    // Doubling table: 3 → skip 1 turn, 4 → skip 2, 5 → skip 4, 6 → skip 8, 7+ → cap at 16.
    const skipTurns = Math.min(16, 1 << (consecutive - 3));
    const currentEventSeq = state.nextEventSeq - 1;
    return { nextRetryAtEventSeq: currentEventSeq + skipTurns * EVENTS_PER_TURN_APPROX };
  }
  // <3 consecutive: no backoff state change. Return empty patch.
  return {};
}
```

The caller then merges and persists:

```ts
const backoffPatch = computeBackoffStatePatch(nextState, consecutive);
writeSessionState(sessionDir, { ...nextState, ...backoffPatch });
```

**Persistence is load-bearing (v6 Critical 6).** v5's pseudocode declared `nextRetryAtEventSeq` as a local variable and never called `writeSessionState`, which meant the field never reached disk and the gate-check (which reads via `readSessionState`) always saw `undefined`. v6 fixes this: every failure path explicitly merges the backoff patch into the post-append SessionState and calls `writeSessionState` in the same block. The lifecycle-hook pseudocode in §"Lifecycle hook" shows the exact call shape, including the M=10 alarm emit. The required test asserts that BOTH `nextRetryAtEventSeq` and `compactionDisabled` survive a process restart (write fields, simulate restart, re-read via `readSessionState`, gate check sees the persisted values).

Trigger gate check (in `evaluateTrigger`, as part of gating rule 5):

```ts
const state = readSessionState(sessionDir);
if (state.nextRetryAtEventSeq !== undefined &&
    latestTurnEnd.eventSeq < state.nextRetryAtEventSeq) {
  return { fire: false, reason: 'backoff' };
}
if (state.compactionDisabled === true) {
  return { fire: false, reason: 'disabled' };
}
```

On successful `conversation_summary` write, clear `nextRetryAtEventSeq` AND `compactionDisabled` in the same `writeSessionState` call (see the success branch of the lifecycle-hook pseudocode). Now the next trigger evaluation reads both fields as `undefined` and the backoff gate falls through.

The `SessionState` whitelist parser in `readSessionState` (Critical 4) gets BOTH new fields added at the same time.

**`EVENTS_PER_TURN_APPROX` (v6 Minor 5 — rationale corrected).** Set to a value that **under-estimates** the doubling-window cost would be wrong because we'd retry MORE OFTEN than nominal, not less often. Real Ada-like load runs ~12.5 events/turn (per the cost-audit pattern note in memory). v6 sets `EVENTS_PER_TURN_APPROX = 12` so the formula `currentEventSeq + skipTurns * 12` approximates the nominal "X turns from now" target on Ada-like load. Tool-using turns occasionally exceed 12 events, so we may wait slightly LONGER than nominal on those — safe direction. Lighter sessions (chat-only, ~4 events/turn) wait roughly 3x nominal — also safe direction; the backoff tier scaling (1→2→4→8→16) has plenty of headroom for over-waiting. If the over-wait turns out to bite on light sessions in practice, switch to counting `turn_end` events directly (a second walk per evaluation; deferred).

Behavior summary:

- **<3 consecutive failures.** No backoff; next trigger evaluation runs normally. Failure event still durably written for observability. `nextRetryAtEventSeq` and `compactionDisabled` are NOT written (the empty-patch case).
- **N=3 consecutive failures (default).** `nextRetryAtEventSeq` set to ~1 turn out (`currentEventSeq + 12`). Next trigger evaluation returns `fire: false, reason: 'backoff'`. Backoff window doubles each subsequent skip (1, 2, 4, 8, …) up to a cap of 16 turns.
- **M=10 consecutive failures (default).** `compactionDisabled` flag set to `true` on `SessionState`, `nextRetryAtEventSeq` cleared, and an `alarm` emitted (existing PRI-1744 alarm channel). Operator must explicitly re-enable. The trigger reports `fire: false, reason: 'disabled'` from then on.

A successful `conversation_summary` write resets BOTH the persistent-disable flag and the `nextRetryAtEventSeq` field (and, implicitly, the derived consecutive-failure count by virtue of the conversation_summary event terminating the walk).

This 4-tier backoff is retained from v3 (Jesse's call) as defense against transient API floods.

#### Persistent disable round-trip (Critical 4 + Important 5)

`readSessionState` at `session-store.ts:143-166` is an explicit whitelist parser (v6 Minor 1 — the function body spans 143-166; the parser body itself is lines 147-162). Type-only additions to the `SessionState` TS type are silently DROPPED on read — they round-trip-clear every time a session is loaded. Adding `compactionDisabled?: boolean` and `nextRetryAtEventSeq?: number` to the type without also updating the whitelist parser would mean the M=10 disable would re-engage as soon as the runner restarted, defeating the entire mechanism.

**Required source change** (implementation-order step 5):

```ts
// readSessionState in session-store.ts, with new fields whitelisted
return {
  nextEventSeq: typeof parsed.nextEventSeq === 'number' ? parsed.nextEventSeq : 1,
  nextStreamSeq: typeof parsed.nextStreamSeq === 'number' ? parsed.nextStreamSeq : 1,
  sessionCostUsd: typeof parsed.sessionCostUsd === 'number' ? parsed.sessionCostUsd : undefined,
  tokenUsage: /* unchanged */,
  config: /* unchanged */,
  // NEW:
  compactionDisabled: typeof parsed.compactionDisabled === 'boolean' ? parsed.compactionDisabled : undefined,
  nextRetryAtEventSeq: typeof parsed.nextRetryAtEventSeq === 'number' ? parsed.nextRetryAtEventSeq : undefined,
};
```

No zod `SessionStateSchema` exists in lace today (verified: no `SessionStateSchema` exports anywhere under `packages/agent/src/`). The TS type and the whitelist parser are the only two definitions; both get updated.

Required test (in `storage/__tests__/session-store.test.ts`):

```ts
test('readSessionState preserves compactionDisabled across round-trip', () => {
  const sessionDir = makeTempSessionDir();
  writeSessionState(sessionDir, { nextEventSeq: 1, nextStreamSeq: 1, compactionDisabled: true });
  const roundTripped = readSessionState(sessionDir);
  expect(roundTripped.compactionDisabled).toBe(true);
});
```

Round-trip through `loadSession` (Important 5): `loadSession` reads the state via `readSessionState`, then `repairOrphanTurnStarts` may write a synthesized turn_end via `appendDurableEvent` which returns `{ ...state, nextEventSeq: written.eventSeq + 1 }`. That spread preserves every field on `state`, so `compactionDisabled` (and `nextRetryAtEventSeq`) survive the repair path automatically — once `readSessionState` correctly hydrates them. The test for this case writes a state with `compactionDisabled: true`, runs `loadSession` with `repairOrphanTurnStarts: true` (after seeding an orphan turn_start), and asserts the post-load `state.compactionDisabled` is still `true`.

### Failure modes → rebuild exceeds summarizer context

If the canonical event prefix being summarized exceeds the summarizer's own context window, the summarizer call fails with a context-window error. The strategy catches the error and emits `compaction_failed` with the reason that drove the trigger (`'global'` or `'emergency'`). Operator notices via the existing PRI-1744 alarm channel.

This is the expected behavior in v4. v3 had a bounded-rebuild + mini-rebuild fallback chain to handle this case in-band; v4 cuts the chain. Rationale:

- The trigger fires at 60% (global) / 90% (emergency) of the **main agent's** context. In v1 the summarizer is the same model as the agent, so the canonical prefix being summarized is bounded by the model's own window minus the tail (~10%). Hitting "rebuild input exceeds summarizer context" is extremely unlikely under normal operation.
- If it happens, the alarm + a `compaction_failed` event in the transcript is enough signal for the operator to investigate (probably the session has accumulated something pathological).
- Carrying a full bounded-rebuild path — including a separately-named summarizer-budget constant and an "orphan oversized session" escape hatch — buys defense against a scenario that the trigger thresholds make rare.

If real production data shows this failure firing more than rarely, file a kata at that point to add a hierarchical rebuild.

## Tail policy

`compaction/tail-policy.ts`:

```ts
export type TailConfig = {
  recentTurns: number;                        // default 10
  recentHumanPromptsTokenBudgetPct: number;   // default 0.10
};

export type TailSelection = {
  tailStartEventSeq: number;       // first event seq that stays verbatim
  preservedHumanPromptSeqs: number[];  // for telemetry / debugging
};

export function selectTail(
  events: TypedDurableEvent[],
  modelMaxContext: number,
  config: TailConfig,
): TailSelection;
```

Algorithm — **single backward walk**, tracking both turn-boundary and human-prompt-token criteria simultaneously. Stop at whichever boundary is met first; if both are still in progress at the end of the list, the walk stops naturally at event 1.

1. Walk events from the end of `events` backward. Maintain three running variables: `closedTurnsSeen`, `humanPromptTokenEstimate`, and `oldestVisitedSeq`.

2. For each event visited:
   - If the event is a `turn_start`, increment `closedTurnsSeen`.
   - If the event is a `prompt` from a human channel (default matcher: text-block content begins with one of `<messages channel="D"`, `<messages channel="C"`, `<messages channel="G"` — these are Slack channel-ID prefixes for DMs / public channels / private channels respectively, verified against `sen-core-v2/src/slack/envelope.ts` and tests; v6 Important 8 removed `im` as it's not a Slack channel-ID prefix), record its seq in `preservedHumanPromptSeqs` and add `(bytesOfPromptBody / 3.5)` to `humanPromptTokenEstimate`.
   - Update `oldestVisitedSeq = event.eventSeq`.

3. Termination check after each step:
   - **Turn-window boundary.** If `closedTurnsSeen >= recentTurns`, the proposed `tailStartEventSeq` is `oldestVisitedSeq` (we've consumed enough recent turns).
   - **Token-budget boundary.** If `humanPromptTokenEstimate >= recentHumanPromptsTokenBudgetPct * modelMaxContext`, the proposed `tailStartEventSeq` is `oldestVisitedSeq` (we've used the tail's token budget).
   - Stop at whichever boundary fires first.

4. If neither boundary fires before the walk runs out of events, `tailStartEventSeq = 1` (whole session is tail; the summarizer has nothing to summarize). **Short-circuit handling (Critical 5):** the strategy caller (lifecycle hook + the two user-initiated paths) MUST check `tailStartEventSeq === 1` (or, equivalently, `events.length < tailStartEventSeq`) BEFORE invoking `compact()`. When the check is true the strategy is not called, no `conversation_summary` event is written, and no `compaction_failed` event is written either (this is not a failure — there is simply nothing to compact). The trigger evaluator returns `fire: false, reason: 'below_threshold'` in normal operation when there isn't enough content to trigger; the rare case where the trigger fires but the tail policy decides the whole session is tail is a logically-no-op operation and silently skipped. `'no-op'` is NOT added to the `CompactionFailedEventData.reason` union (Critical 5 resolution).

5. **In-flight tool-use guard — single AND parallel-call clusters (Important 3).** `tool_use` is **one event** that carries both `input` and `result` (`event-types.ts:28-35` — `ToolUseEventData` has both fields on a single event). The boundary risk is: if a `tool_use` event has `result === undefined` (tool hasn't completed yet), the next turn will mutate the event in place to add the result. The summarizer would see "tool call with no result"; the rebuilt tail would later mutate to add it. If the parent turn issued multiple parallel tool calls, several consecutive `tool_use` events may all be in-flight at once. v4's "walk left by one event" handled only the single-call case — for clusters, the second-and-onward in-flight events would still cross the boundary and be summarized.

   Correct guard: **walk left as long as the event at `tailStartEventSeq` is a `tool_use` with `result === undefined`.** Loop until the boundary lands on either (a) a non-`tool_use` event, or (b) a `tool_use` event with `result !== undefined` (the parallel-call cluster's first completed call is fine to leave at the boundary because every later in-flight tool_use will be inside the tail).

   **v6 Important 4 — O(N·K) → O(N+K).** v5's pseudocode used `events.find(e => e.eventSeq === tailStartEventSeq)` inside the while loop, which is O(N) per iteration. For a long session with K in-flight tool_use events at the boundary the cost is O(N·K). v6 uses a backward index cursor (decrement the array index, not the eventSeq) and a single up-front index→event lookup, so the walk is O(N+K):

   ```ts
   // Find the array index corresponding to tailStartEventSeq once (O(N) up front).
   // After the initial walk in steps 1-4, the boundary already sits on a known
   // index — capture it as `tailIdx` rather than scanning by eventSeq each time.
   let tailIdx = /* index in events[] of the event whose eventSeq === tailStartEventSeq */;
   while (tailIdx > 0) {
     const ev = events[tailIdx];
     if (ev?.type === 'tool_use' && (ev.data as ToolUseEventData).result === undefined) {
       tailIdx -= 1;
       continue;
     }
     break;
   }
   tailStartEventSeq = events[tailIdx]!.eventSeq;
   ```

   The same index-cursor pattern applies to step 6 (mid-turn split guard), which has the same shape. Both guards together stay O(N+K).

   Test fixture: three back-to-back `tool_use` events all with `result === undefined`, immediately preceded by a `message`. Proposed boundary lands on the middle tool_use; assertion is that the boundary walks left past ALL THREE in-flight tool_uses (and ideally settles on the `message` event before them). Existing single-call fixture also remains. NOTE: this is not addressing message-builder orphan-tool-block issues; for those, see §"Message-builder behavior → dropOrphanedToolBlocks".

6. **Mid-turn split guard (Important 10).** The token-budget cap and turn-count cap can both fire while walking through a turn's middle events, leaving a tail whose first event has no preceding `turn_start`. After the boundary lands per steps 3–5, walk left further until the boundary either (a) lands on a `turn_start` event, or (b) sits at `eventSeq === 1`. This guarantees the rebuilt tail begins on a turn boundary, which the message-builder relies on for correct prompt/response sequencing.

   Algorithm extension applied after step 5 — same index-cursor pattern as step 5 (v6 Important 4):

   ```ts
   while (tailIdx > 0) {
     const ev = events[tailIdx];
     if (ev?.type === 'turn_start') break;
     tailIdx -= 1;
   }
   tailStartEventSeq = events[tailIdx]!.eventSeq;
   ```

   Test: chat-heavy session where the token-budget cap fires mid-turn (between `message` and `tool_use` in the same turn); assertion is that the final `tailStartEventSeq` lands on the enclosing `turn_start`, not on the `tool_use` or `message`.

7. Return `tailStartEventSeq` and the list of human prompt seqs that drove the policy.

The compactor sees: events with `eventSeq < tailStartEventSeq` → fed to summarizer. Events with `eventSeq >= tailStartEventSeq` → passed through verbatim to the message-builder.

### Defaults rationale

- `recentTurns: 10` — unchanged.
- `recentHumanPromptsTokenBudgetPct: 0.10` — combined with capsule budget (`targetCapsuleTokensPct: 0.10`), post-compaction state is ~20% of context, leaving 40% headroom below the 60% global trigger.

Note: v3 also exposed `recentHumanPrompts: number` (a count cap, default 12) and `humanChannelMatcher?: (event) => boolean` (a per-session override knob). v4 drops both. The token-budget cap alone is what matters for context safety; the count cap added zero protection that 0.10-of-context didn't already provide. The default channel matcher is the only one we use; if non-Slack ingress arrives, widen the matcher in source.

## Compaction algorithm

`compaction/summarize-strategy.ts` exports:

```ts
export type CompactionContext = {
  sessionDir: string;
  summarizer: Provider;          // already pinned to SUMMARIZER_SYSTEM_PROMPT by caller
  modelMaxContext: number;
  targetTokens: number;
  tailConfig: TailConfig;
};

export type CompactionResult = {
  event: TypedDurableEvent;      // the new conversation_summary event — always present (Important 8)
  metrics: {
    eventsCompacted: number;
    capsuleTokens: number;
    generationCostUsd: number;
  };
};

export async function compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactionResult>;
```

`event` is required (not optional), tied to the Critical 5 resolution: callers short-circuit before invoking `compact()` when `tailStartEventSeq === 1`, so the strategy is never called in the "nothing to compact" case. Every successful `compact()` call produces exactly one `conversation_summary` event. If the summarizer call itself fails the strategy throws (caught by the caller's try/catch, which writes a `compaction_failed` event).

### `compact()` is not a `CompactionStrategy.compact()` implementation (v6 Critical 4)

The new top-level `compact()` exported from `summarize-strategy.ts` shares ONLY the method name with the existing `CompactionStrategy.compact()` interface at `compaction/types.ts:49-61`. The signatures are different in every parameter:

| Aspect | Legacy `CompactionStrategy.compact()` | New top-level `compact()` |
|---|---|---|
| First arg | `LaceEvent[]` (from `@lace/agent/threads/types`) | `TypedDurableEvent[]` (from `@lace/agent/storage/event-types`) |
| Second arg | `CompactionContext = { threadId, provider?, agent?, toolExecutor? }` | `CompactionContext = { sessionDir, summarizer, modelMaxContext, targetTokens, tailConfig }` |
| Return | `CompactionResult = { compactionEvent, compactedEvents }` | `CompactionResult = { event, metrics }` |

The shared name is preserved because the verb still matches the verb in domain terms, but the strategy registry path (which depends on the legacy interface shape) is GONE in v6 (see §"Strategy registry — removed in v6"). The new `compact()` is imported as a top-level function from `summarize-strategy.ts` by name. No registry, no adapter, no shim. `compact-dropped-messages.ts` and its `compactDroppedMessagesWithCore(...)` wrapper are deleted alongside the registry.

v5's wording "matches the existing `CompactionStrategy.compact()` interface" was incorrect. v6 replaces it with this explicit clarification. All spec references to the strategy entry point use `compact` (v5 Important 6 carried).

### trim-tool-results pre-pass (Critical 3 — extracted helper, old strategy deleted)

Before sending events to the summarizer, the strategy applies a `trimToolResultLines` helper to a COPY of the events. The existing `TrimToolResultsStrategy` class operates on `LaceEvent[]` from `@lace/agent/threads/types` (verified at `trim-tool-results-strategy.ts:4-64`); it cannot be invoked as-is on `TypedDurableEvent[]` without rewriting. Rather than maintain both shapes, v5 extracts the trim logic as a top-level function in `summarize-strategy.ts` that operates directly on `TypedDurableEvent[]`, and DELETES the legacy `trim-tool-results-strategy.ts` file entirely.

```ts
// Top-level in compaction/summarize-strategy.ts
export function trimToolResultLines(
  events: TypedDurableEvent[],
  lineCap: number = 3,
): TypedDurableEvent[] {
  return events.map((ev) => {
    if (ev.type !== 'tool_use') return ev;
    const data = ev.data as ToolUseEventData;
    if (!data.result?.content) return ev;
    // Defensive copy of the event and its result so the original on-disk shape
    // is never mutated; only the summarizer-bound list shrinks.
    const trimmedContent = data.result.content.map((block) => {
      if (block.type !== 'text' || typeof block.text !== 'string') return block;
      const lines = block.text.split('\n');
      if (lines.length <= lineCap) return block;
      return {
        ...block,
        text: [...lines.slice(0, lineCap), '[results truncated to save space.]'].join('\n'),
      };
    });
    return { ...ev, data: { ...data, result: { ...data.result, content: trimmedContent } } };
  });
}
```

Strategy usage:

```ts
const trimmedForSummarizer = trimToolResultLines(eventsBelowTail);
// trimmedForSummarizer has shrunken tool_use.result fields; original events unchanged.
const capsule = await summarizeWithBudget({ /* uses trimmedForSummarizer */ });
```

Key invariants:
- **Pre-pass operates ONLY on the events feeding the summarizer.** The tail (events with `eventSeq >= tailStartEventSeq`) keeps its original, un-trimmed `tool_use.result` payloads. The message-builder renders the tail as-is on the next turn.
- **No event mutation.** The helper returns a new list with defensively-copied events and results; the on-disk JSONL is unchanged.
- **`trim-tool-results-strategy.ts` is DELETED.** No `LaceEvent[]` codepath remains. In v6 the strategy registry (`compaction/registry.ts`) and `compact-dropped-messages.ts` are ALSO deleted (see §"Strategy registry — removed in v6" and the module-layout box) — the typed-capsule path bypasses the registry entirely. The legacy `LaceEvent[]` shape is no longer referenced by the new code at all.
- **Harness measurement.** The standalone-trim-tool-results-measurement use case (offline `sen2/compaction/` harness measuring trim in isolation against fixtures) is folded into the same `trimToolResultLines` helper. The harness imports the helper directly and runs it against its `TypedDurableEvent[]`-shaped fixtures. (Fixture format may need a one-time conversion if it was saved as `LaceEvent[]`; file a kata if so.)

### Single rebuild path

Every compaction reads canonical events up to `tailStartEventSeq - 1`, runs the trim-tool-results pre-pass on them, runs the summarizer once, and emits one `conversation_summary` event:

1. Compute tail boundary: `tailStartEventSeq = selectTail(events, ctx.modelMaxContext, ctx.tailConfig).tailStartEventSeq`.
2. Build `summarizerInput` = trim-tool-results pre-pass over events with `eventSeq < tailStartEventSeq`, skipping any prior `conversation_summary` events but keeping the original prompts/messages they replaced.
3. Run the summarizer (via the budget-retry helper — top-level function inside `summarize-strategy.ts`) with prompt: all non-summary trimmed events → `capsule`.
4. Emit `conversation_summary` with `generationMode: 'rebuild_from_canonical'`, `recentTailStartsAtEventSeq`, `generatedAt`, cost, and token usage.

The strategy has no "rolling" path, no "bounded-rebuild" path, no "previous capsule" parameter, no delta computation. v3 split logic across §"Rolling mode" + §"Rebuild mode" + §"Bounded rebuild" + an empty-delta fallback; v4 has one path.

If the summarizer call itself fails because the input exceeds the summarizer's own context window, the strategy lets the error propagate so the caller's catch block emits `compaction_failed`. See §"Failure modes → rebuild exceeds summarizer context".

### Model

Same provider+model as the main agent's conversation. Per the research report: "global compact: same tier as main model." Different tiers can be evaluated in follow-up work; v1 uses the main model. Cost is recorded in `generationCostUsd` (using PRI-1817's pricing).

### targetTokens default

Defaults to `floor(modelMaxContext * targetCapsuleTokensPct)` — see R5. For 1M-context Sonnet, targetTokens defaults to **100K**. The capsule itself is expected to be a small fraction of that bound in practice; the budget is a ceiling for the renderer.

## Budget enforcement

`summarizeWithBudget` is a top-level helper inside `summarize-strategy.ts` (folded in v4 from the previous standalone `budget-retry.ts`):

```ts
export async function summarizeWithBudget(args: {
  summarizer: Provider;
  prompt: string;
  schema: typeof CapsuleSchema;
  targetTokens: number;
  renderForMeasurement: (capsule: Capsule) => string;  // see step 2
  maxRetries?: number;          // default 2
}): Promise<{ capsule: Capsule }>;
```

1. Call summarizer with normal prompt. Parse + validate result against `CapsuleSchema`.
2. **Token measurement.** Compute approximate token size of what the **agent will actually see**, not the JSON storage form:
   `approxTokens = renderForMeasurement(capsule).length / 3.5`
   Callers pass `renderCapsuleAsMarkdown` as `renderForMeasurement`. The 3.5 chars/token ratio is calibrated for Anthropic markdown.
3. If `tokens <= targetTokens` → return `{ capsule }`.
4. Else: re-call with prefix `"Your prior output was X tokens; the target is Y. Compress further. Do not drop must-preserve fields: commitments, user corrections, do_not_infer, exact_language_to_preserve."`. Up to `maxRetries` re-runs.
5. After max retries: accept the smallest version produced across all retries.

The must-preserve fields list is hard-coded; if a future bug shows the model dropping them under pressure, add a critic pass (deferred kata).

Note on dropped diagnostics: v3 returned `{ capsule, budgetOverrunBy, retries }` and the wrapping event surfaced both as event fields. v4 returns just `{ capsule }` — `budgetOverrunBy` and `retries` had no readers and were diagnostic-only. If we ever want them, logging at WARN level inside this function is enough.

## Cache invariance

The new strategy creates a new prefix every time it fires. The first API call after a compaction WILL pay `cache_creation` on the new capsule+tail boundary, because:
1. The conversation prefix sent to Anthropic changes structurally (old events replaced by capsule markdown).
2. Anthropic's prompt cache is keyed on the byte-prefix; any change at the start invalidates the cache.

This is accepted, not fought. Mitigation:
- The `cache_control` breakpoint that PRI-1799 places on the messages[] tail will warm immediately on the first post-compaction call.
- Trigger thresholds are set conservatively (60% / 90%) so compaction fires at most weekly under Ada-like load. Per-fire cost spike is bounded.
- The `conversation_summary` event's `generationCostUsd + (next turn's cache_creation)` together are the real cost of a compaction. PRI-1817's per-turn cache fields make this measurable.

A follow-up kata (referenced from this spec, filed later) can investigate whether the message-builder can produce byte-prefix-stable output across compactions; v1 doesn't try.

## Message-builder behavior

Four changes to `message-building/message-builder.ts`:

1. **Render `conversation_summary` as the conversation prefix — TWO-PASS algorithm (v6 Critical 5).** v5's single-pass description was incoherent: it said "reset `messages.length = 0` upon encountering `conversation_summary`" AND "events with `eventSeq >= latestSummary.recentTailStartsAtEventSeq` are processed normally." Under in-order iteration these are incompatible. Tail events sit at seqs `[recentTailStartsAtEventSeq, summary_seq - 1]` — they precede the summary in seq order. The reset on the summary throws them away after they've been processed. v6 rewrites the algorithm as two explicit passes:

   **Pass 0 — pre-scan for the latest summary.**
   ```ts
   let latestSummary: { event: TypedDurableEvent, data: ConversationSummaryEventData } | null = null;
   for (const ev of parsedEvents) {
     if (ev.type === 'conversation_summary') {
       latestSummary = { event: ev, data: ev.data as ConversationSummaryEventData };
     }
   }
   ```

   **Pass 1 — build messages, knowing the latest summary in advance.**
   ```ts
   for (const ev of parsedEvents) {
     // If there's a latest summary, skip every event that's strictly summarized.
     if (latestSummary !== null) {
       // Events strictly summarized: eventSeq < latestSummary.data.recentTailStartsAtEventSeq.
       // (These are the events the capsule replaces; the summary itself sits at
       //  summary.event.eventSeq, somewhere AFTER recentTailStartsAtEventSeq.)
       if (ev.eventSeq < latestSummary.data.recentTailStartsAtEventSeq) continue;

       // When the iteration reaches the latestSummary event itself, push the
       // capsule render as the FIRST entry in messages. Do NOT reset
       // messages.length — that would discard the tail events already
       // processed in seq order between recentTailStartsAtEventSeq and
       // summary_seq. Instead, unshift to make the capsule the prefix.
       if (ev === latestSummary.event) {
         messages.unshift({
           role: 'user',
           content: renderCapsuleAsMarkdown(latestSummary.data.capsule),
         });
         continue;
       }

       // EARLIER conversation_summary events (those before latestSummary) are
       // skipped — they're stale and the latestSummary's cumulative-from-1
       // contract makes them redundant. The check is `latestSummary !== null
       // && ev.type === 'conversation_summary' && ev !== latestSummary.event`.
       if (ev.type === 'conversation_summary') continue;
     }
     // ...all other event types processed by the existing per-type handlers...
   }
   ```

   The key invariant: under in-order iteration, when we process a tail event at seq `T` (where `recentTailStartsAtEventSeq <= T < summary_seq`), the summary has NOT yet been reached. We process the tail event normally, appending to `messages`. When iteration reaches `summary_seq`, we `unshift` the capsule render — putting it at position 0 — and continue. By the end of pass 1, `messages[0]` is the capsule and `messages[1..]` is the tail in seq order. Events after `summary_seq` (post-summary turns) continue to append at the end.

   The "Only the LATEST `conversation_summary` event is rendered" rule is preserved: earlier summaries are skipped in pass 1, and the `unshift` only fires for `latestSummary.event` specifically.

   **Tests for the two-pass case (new):**
   - Tail events between `recentTailStartsAtEventSeq` and `summary_seq` survive into the rebuilt messages.
   - Fixture: 5 events at seqs 1-5; `conversation_summary` event at seq 8 with `recentTailStartsAtEventSeq = 4`; 2 events at seqs 6-7 (the tail); 3 events at seqs 9-11 (post-summary). Assertion: `messages[0]` is the capsule render; `messages[1..]` contain the events at seqs 4-7 (tail; events 1-3 summarized) followed by events 9-11.
   - Fixture: two summaries — one at seq 8 (`recentTailStartsAtEventSeq=4`), another at seq 16 (`recentTailStartsAtEventSeq=12`). Assertion: only the seq-16 summary is rendered; events 1-11 are skipped; events 12-15 (tail of latest summary, which includes the earlier summary at seq 8) are processed but the seq-8 summary is skipped by the `ev !== latestSummary.event && ev.type === 'conversation_summary'` rule.

2. **Skip `compaction_failed` events.** They're telemetry; they don't affect prefix rendering. Explicitly skip (don't fall through to "unknown type").

3. **Reject unknown event types loudly.** Any event whose `type` is not in the known allowlist throws. Allowlist (enumerated explicitly so anything not on this list throws on the next turn — we cannot silently drop new event types we forgot to teach the builder about):

   ```
   prompt, message, tool_use, turn_start, turn_end, context_injected,
   system_prompt_set, job_started, job_finished, job_update, job_session_assigned,
   permission_requested, permission_decided, permission_cancelled,
   checkpoint_created, files_rewound,
   conversation_summary,          // NEW — rendered as prefix
   compaction_failed              // NEW — skipped (no-op)
   ```

   The current builder uses a for-loop with conditional handlers (`if (type === X) { ... continue; }` chain, verified at `message-builder.ts:257-369`), currently no-op for unhandled types (the loop iteration ends naturally after the last `if` without doing anything). v3 closed that to an explicit allowlist plus a throw and v4/v5 keeps it (Minor 1). Add an `else { throw new Error('unknown event type: ' + type); }` at the end of the loop body for any type not in the allowlist. The explicit no-op set above MUST be the same list as the current implicit-no-op set (turn_start, turn_end, job_*, permission_*, checkpoint_created, files_rewound, system_prompt_set after pass-1) so the behavior change is purely "newly unknown types now throw rather than silently doing nothing."

   `context_compacted` is **not** on this list. After the Ada cutover, no live session has `context_compacted` on disk; any sub-session that somehow does fails loudly with a pointer at the cutover playbook.

4. **Always run `dropOrphanedToolBlocks` against the rebuilt messages.** Currently the function is called only inside the `context_compacted` branch (`message-builder.ts:319`). Move the call out of that branch and run it ONCE at the end of pass-2 (after all events have been folded into `messages`), regardless of whether a `conversation_summary` event was present. Rationale: PRI-1818's crash-recovery path writes a synthesized `turn_end(stopReason='process_died')` after a SIGKILL/OOM; if the process died mid-tool-call, the `tool_use` event was already written with `result === undefined`, and the runner's repair path may produce a message stream where an `assistant.toolCalls[]` block has no matching `user.toolResults[]` follower. PRI-1820's `dropOrphanedToolBlocks` exists to defuse exactly this case (function body at `message-builder.ts:114-189` — v6 Minor 3 corrects the v5 citation `:152-189` which only covered Pass B; Pass A starts at line 114). With v3's removal of `context_compacted`, that defense currently has no caller. Running it unconditionally as a post-pass costs one O(n) scan of messages and protects against the crash-recovery orphan source.

   The pass remains a defensive bottom-pass — if the rebuilt prefix is clean it's a no-op. Logging still emits a WARN on every dropped block so we can spot regressions that produce orphans in the first place.

## Recall (FTS) integration

`storage/recall/event-to-row.ts` currently has a `case 'context_compacted':` (line 80) that returns a `system`-kind row whose content is the summary text. **Both events change behavior in v3/v4:**

1. **Remove the `case 'context_compacted':` branch.** That event type no longer exists.
2. **`conversation_summary` is NOT indexed.** The switch in `eventToRow` returns `null` (the default-case behavior for unknown / non-user-facing types) for `conversation_summary`. The summary is a rewrite for the model's working memory, not a search target. Recall already indexes the canonical events the summary was built from — `prompt`, `message`, `tool_use`, `context_injected` — so the search surface remains complete. Indexing the summary would surface paraphrased / lossy text alongside the original, inflate FTS row size (capsule markdown can be ~10K tokens), and confuse `/recall` results with two hits for the same conversational moment.
3. **`compaction_failed` is NOT indexed.** Telemetry, not memory. Same null return.

This removes the entire "Migration FTS cleanup" section from v2 — there is no migration, and the FTS index never gains rows for the summary events that need cleaning. The existing FTS rows for the canonical events covered by a summary stay in place (recall already indexed them when they were written; the summary doesn't change that), so search hits for "what did Jesse say last Tuesday" still resolve against the original prompt/message text.

```ts
// Final shape of the switch:
case 'prompt': /* unchanged */
case 'message': /* unchanged */
case 'tool_use': /* unchanged */
case 'context_injected': /* unchanged */
// 'context_compacted' REMOVED
// 'conversation_summary' NOT added → falls through to default → null
// 'compaction_failed' NOT added → falls through to default → null
default:
  return null;
```

## Cutover: one-time clear of Ada

v2 specified a per-session migration tool that read every `context_compacted` event, summarized them through a fresh model call, and rewrote each transcript JSONL in place with a single new `conversation_summary` event. That section is **DELETED in v3** and stays deleted in v4.

Instead: Ada is the only live agent with `context_compacted` events on disk. We zero her transcript at cutover.

### Procedure

1. **Stop Ada's container** so no further events get written.
2. **Snapshot her LACE_DIR** to a timestamped backup (`<laceDir>.pre-cutover-<ISO>`). This is the rollback artifact.
3. **Find every events.jsonl under her LACE_DIR.** For each:
   - Replace with empty file (`truncate -s 0`), OR delete and let lace recreate on startup — whichever matches the runtime's existing "missing transcript" behavior. Inspect `transcript-paths.ts` and `event-log.ts` before picking.
4. **Drop her FTS rows.** `DELETE FROM events WHERE session_id = '<ada-full-session-id>'` against the SQLite recall index. The `session_id` column stores the exact session id (verified — `event-to-row.ts:44-46` writes `session_id: ctx.sessionId` and the `event_id` is `${ctx.sessionId}:${eventSeq}`); equality is correct and prefix-matching with `LIKE %` is unnecessary. Faster than per-session repair; she has one active session.
5. **Leave her persona, system_prompt_set state, configuration, and any non-event durable artifacts in place.** The cutover wipes conversation history, not identity.
6. **Restart her container on the new lace build** (which has the typed-capsule strategy + the `context_compacted` removal from the union).
7. **Verify she boots cleanly.** No `context_compacted` events on disk → no message-builder loud-throw. Her conversation starts at turn zero.
8. **Post-cutover smoke:** ping her in `#bot-debugging` (Ada Slack channel reference); confirm she responds normally; confirm the first compaction fires at ~60% of context after enough conversation accumulates.

### Cost

**Zero summarizer cost** at cutover. No model calls. (v2's migration was ~$8–10 for Ada because it ran a fresh-prefix summarizer over her 1M-token canonical history; v3/v4 simply discards that history.)

### What Ada loses

Her existing conversation context: pending commitments, ongoing tasks, prior corrections, the chronology of her week. She wakes up not remembering any of it.

The trade-off vs migration:
- **Migration cost (v2 plan):** ~$10, plus the integration risk of a tool that rewrites her JSONL in place (file-system race, eventSeq preservation, FTS staleness, summarizer hallucination on a 1M-token prefix).
- **Clear cost (v3+ plan):** ~$0, but Ada starts fresh.

The cutover is intentional reset, not data loss in the catastrophic sense — Jesse (the operator) chose to take the hit rather than pay the migration risk for a single session. Future agents post-cutover never have `context_compacted` events on disk and never need either path.

### Future agents

Agents created on the new lace build never see `context_compacted`. When their context grows, the trigger fires and they accumulate `conversation_summary` events instead. No migration is ever required again.

### Other sessions

If any non-Ada session somehow has `context_compacted` events on disk (e.g. a stale fixture, a forgotten dev sandbox), the same clear procedure applies. The cutover playbook documents it as "zero out events.jsonl, drop FTS rows, restart."

## Build / repo plumbing

The `sen2/compaction/` repo declares `@lace/agent` as a `file:../lace/packages/agent` workspace dependency. This means:

- The lace package must be built before the compaction repo can `tsx` against it. `compaction`'s test/harness scripts assume `cd ../lace && npm run build` has been run.
- Type-import edits in lace propagate to compaction via the `file:` link without a re-install.

## Testing

Full unit-test coverage for every module in the new strategy. Integration testing is the harness-against-Ada-fixture pattern (where "Ada fixture" is the v2 snapshot of her transcript saved to `sen2/compaction/fixtures/ada-main/`, NOT live Ada post-cutover).

### Unit tests

- **`capsule-types.test.ts`**: schema accepts the report's example payload; rejects every malformed shape we can think of (missing required field, wrong type per branch, unknown field if strict mode is on); every sub-schema gets its own test.
- **`capsule-markdown.test.ts`** (covering the markdown renderer that now lives inside `summarize-strategy.ts`): rendering of each of the 13 sections; edge cases (empty arrays don't emit headers; all-optional-fields-absent renders correctly; multi-paragraph snippets preserve formatting; sections with special chars are escaped); quote blocks emit with attribution.
- **`tail-policy.test.ts`**: every branch — short session (all events in tail), normal turn-cut, human-prompt extends tail backward, in-flight `tool_use` (result undefined) at boundary, **in-flight tool_use CLUSTER at boundary: three back-to-back tool_use events all with result=undefined, boundary walks past all three (Important 3)**, no human prompts in session, empty session, session with only one turn, **token-budget cap fires before recentTurns is hit on a chat-heavy session**, **turn-cap fires before token-budget on a long-quiet-then-talky session**, **single-pass walk: visits each event at most once (instrument the matcher)**, **mid-turn split guard: boundary that lands mid-turn walks left to enclosing `turn_start` (Important 10)**.
- **`budget-retry.test.ts`** (covering the budget helper that now lives inside `summarize-strategy.ts`): in-budget first try; over-budget then in-budget on first retry; all retries over-budget accepts smallest; the must-preserve fields preserved in the smallest-accepted output (synthetic summarizer that returns a known capsule); **measurement uses rendered markdown, not JSON bytes**.
- **`compaction-trigger.test.ts`**: every threshold combination at v4 defaults (under 60% → no fire; between 60% and 90% → global; over 90% → emergency); **the `?? 0` cache-field defaults parameterized across `promptTokens`-only, `promptTokens + cacheRead`, `promptTokens + cacheCreation + cacheRead` (one test, three rows; the formula reduces identically)**; **stop-reason whitelist (Important 11): `end_turn`/`stop_sequence`/`max_turns` fire; ALL of `tool_use`/`pause_turn`/`refusal`/`cancelled`/`permission_cancelled`/`failed`/`budget_exceeded`/`incomplete`/`process_died`/`prompt_handler_caught`/`context_window_exceeded`/`max_output_tokens`/`provider_error_overloaded`/`provider_error_invalid`/`provider_error_network`/`provider_error_other`/`tool_error_throw`/`tool_error_timeout`/`internal_error` do NOT fire (one test, table-driven row per reason)**; **gating: `lastCallInputContextTokens` missing → no fire + log**; **gating: subagent session → no fire**; **gating: persistent-disable flag set → `fire: false, reason: 'disabled'`**; **gating: in backoff window (`nextRetryAtEventSeq > current eventSeq`) → `fire: false, reason: 'backoff'`**.
- **`summarize-strategy.test.ts`**: emits one `conversation_summary` event with cumulative coverage (everything from event 1 up to `recentTailStartsAtEventSeq - 1` is represented); **`trimToolResultLines` helper applied to events fed to summarizer (Critical 3)**; **tail events are NOT trimmed**; **`trimToolResultLines` returns defensive copies — original event list is unmutated (assertion via deep-equal of input array before and after)**; prior `conversation_summary` events in the input are skipped (the underlying canonical events are re-summarized); error path lets the summarizer exception propagate so the caller emits `compaction_failed`; cost fields populated; **summarizer Provider parameter is the one the caller passed (no factory indirection)**; **method is `compact` not `runCompaction` (Important 6)**; **`compact()` writes via direct `appendDurableEvent` + `writeSessionState`, never `writeAndAdvance` (Critical 1)** — synthetic test where the strategy is invoked inside an outer `runExclusive` scope and the runner's normal `writeAndAdvance` is called immediately after; the second call must not hang.
- **`message-builder.test.ts`**: session with one `conversation_summary` event rebuilds messages with the rendered markdown as a single role:user prefix; **session with two summaries reads only the latest, drops earlier ones**; session with zero summaries falls through to current pre-summary behavior; **session with `compaction_failed` events: events skipped, prefix unaffected**; **session with unknown event type: throws loudly**; **`dropOrphanedToolBlocks` runs as a post-pass even when no `conversation_summary` event is present (synthetic crash-recovery fixture: turn_end(process_died) + orphan tool_use)**; **two-pass algorithm — tail events between `recentTailStartsAtEventSeq` and `summary_seq` survive into the rebuilt messages (v6 Critical 5)** (fixture: 5 events at seqs 1-5; `conversation_summary` event at seq 8 with `recentTailStartsAtEventSeq=4`; 2 events at seqs 6-7 [the tail]; 3 events at seqs 9-11 [post-summary]; assertion: `messages[0]` is the capsule render and `messages[1..]` contain events 4-7 followed by 9-11); **two-pass algorithm — two summaries case (v6 Critical 5)** (fixture: summary at seq 8 with `recentTailStartsAtEventSeq=4`, second summary at seq 16 with `recentTailStartsAtEventSeq=12`; assertion: only seq-16 summary rendered; events 1-11 skipped; events 12-15 processed as tail with the seq-8 summary itself skipped).
- **`event-to-row.test.ts`**: **`conversation_summary` event returns null (not indexed)**; **`compaction_failed` event returns null (not indexed)**; **no `context_compacted` case remains**.
- **`backoff.test.ts`**: 3 consecutive failures → `nextRetryAtEventSeq` set per doubling table (Important 1); 10 consecutive → persistent-disable flag set on `SessionState.compactionDisabled` + alarm emitted; successful summary clears BOTH `nextRetryAtEventSeq` and `compactionDisabled`; **walk position: walks from end-of-log backward, NOT from latest `turn_end` (Important 7)** — fixture has `turn_end` followed by `compaction_failed` followed by `compaction_failed`; assertion is that the count is 2, not 0; **walk SKIPS over normal turn events between consecutive failures (v6 Critical 1)** — fixture matches the realistic on-disk shape `[message_1, turn_end_1, compaction_failed_1(global), prompt_2, turn_start_2, message_2, turn_end_2, compaction_failed_2(global), prompt_3, turn_start_3, message_3, turn_end_3, compaction_failed_3(global)]`; assertion: walk counts 3, not 1 (v5's `turn_end`-terminates-walk bug would have failed at count=1); **`compaction_failed{reason: 'user_initiated'}` events are SKIPPED by the backoff walk (Critical 6)** — fixture: 3 consecutive user-initiated failures + 0 global/emergency; assertion is no backoff, no disable; **mixed sequence: 2 global + 1 user_initiated + 1 global** → count is 3 (the user-initiated event doesn't reset the count but doesn't increment it either; spec says walk skips it transparently — assert this behavior explicitly); **persistence round-trip (v6 Critical 6)** — write `nextRetryAtEventSeq` and `compactionDisabled` via the lifecycle-hook's `writeSessionState(... ...backoffPatch)` call, simulate restart by closing-and-reopening the session, re-read via `readSessionState`, assert both fields survive and the gate-check in `evaluateTrigger` returns `fire: false, reason: 'backoff'` (or `'disabled'`); **`EVENTS_PER_TURN_APPROX = 12` (v6 Minor 5)** — fixture asserts the doubling-table math uses 12, not 4: for `consecutive=3`, `nextRetryAtEventSeq === currentEventSeq + 12` (`skipTurns=1` × EPTA=12).

All unit tests use pure synthetic data — no LLM call. No mocking the API; pure-function logic only.

### Integration / E2E: the harness against Ada-fixture

The `sen2/compaction/` harness is the e2e bed (runs against the saved Ada-fixture, not live Ada):

1. Register the new strategy as a `compaction` repo strategy module (alongside `noop`). Strategy module wraps `compact` from lace's `SummarizeCompactionStrategy`, importing through the `@lace/agent` workspace dep.
2. `compaction harness new-summarize fixtures/ada-main --out scratch/runs/<date>` runs the real strategy against the saved 2,036-event session snapshot with a real Anthropic API summarizer call.
3. Outputs: `events.jsonl` (post-compaction event sequence), `metrics.json` (size reduction, generation cost, capsule shape stats), `after.html` (rendered conversation prefix from the message-builder).
4. Acceptance criteria (manual, iterative — driven by reading the harness output):
   - `events.jsonl` contains a `conversation_summary` event with valid capsule per zod schema.
   - The new event covers events 1 through `recentTailStartsAtEventSeq - 1` (cumulative coverage; derived from the field, not stored as a range).
   - Token reduction > 50% on the pre-compaction window.
   - `after.html` renders a readable conversation prefix that preserves the fixture's known commitments, corrections, and recent human comms.
   - Generation cost < $15 per run.
5. Iterate on the summarizer prompt, capsule schema completeness, tail policy thresholds by re-running and diffing scratch/runs/ outputs over time.

Harness runs are on-demand (not in CI) — they cost real Anthropic dollars. CI runs only the unit tests. Per Jesse's CLAUDE.md: "we always use real data and real APIs" — the harness IS the real-API path.

## Open questions

Not blocking. Capture as follow-ups during implementation:

- What's a sensible default channel matcher for non-Slack ingress? Today we have Slack DMs + channels. Email, web UI, etc. would need different matchers. (v4 dropped the per-session matcher override knob; widening the matcher is now a source-edit.)
- Should the capsule include a version of itself in the prompt to the summarizer, or only natural-language framing? (Prompt design decision; A/B in the harness.)
- The summarizer's `do not drop must-preserve fields` retry instruction: does it work in practice? If not, the critic pass from research Phase 2 becomes necessary.
- Compaction-abort: should an in-flight compaction be cancellable via the abort RPC? Today's behavior is "runs to completion then abort takes effect."
- Does `rebuild exceeds summarizer context` ever fire in production? If yes more than rarely, file a kata for a hierarchical-rebuild fallback (the case v3's bounded-rebuild was guarding against).

## Implementation order (informs the plan, not the spec)

0. **Precondition kata: `usage.lastCallInputContextTokens` on `turn_end`.** Tiny lace PR. File as PRI-XXXX. Must land + ship before any code below.
1. Module scaffolding + `capsule-types.ts` (no behavior; just the schema)
2. `tail-policy.ts` (pure function on events + modelMaxContext; single-pass walk; testable in isolation)
3. `summarize-strategy.ts` — includes the markdown renderer, the summarizer prompt builder, and the budget-retry helper as top-level functions in this file. Pure-function unit tests with synthetic Provider. Single rebuild path. Trim-tool-results pre-pass.
4. `compaction-trigger.ts` (pure function on turn_end event + session events; tests cover all gating including stop-reason whitelist, parameterized `?? 0` cache-field defaults, subagent gate, persistent-disable gate, backoff gate)
5. `event-types.ts` (add new types `ConversationSummaryEventData` + `CompactionFailedEventData`; remove `context_compacted` from `DurableEventData` discriminated union and delete `ContextCompactedEventData` type) + `session-store.ts` modifications: add `compactionDisabled?: boolean` and `nextRetryAtEventSeq?: number` to the `SessionState` type AND update `readSessionState`'s whitelist parser to hydrate both new fields (Critical 4; without the whitelist update they round-trip-clear on every read) + `providers/base-provider.ts`: change `getModelContextWindow` from `protected` to `public` (Critical 7) + `message-builder.ts` modifications: (a) implement the two-pass algorithm from §"Message-builder behavior step 1" (v6 Critical 5), (b) **DELETE the existing `context_compacted` branch at `message-builder.ts:290-322` entirely** (v6 Important 5 — once the type is removed from `DurableEventData` the branch won't compile; the old `preserved[]` rebuild logic is gone with the type), (c) implement the explicit allowlist with throw on unknown types per §"Message-builder behavior step 3", (d) move `dropOrphanedToolBlocks` to run as a post-pass per §"Message-builder behavior step 4". Tests for all of the above (especially `readSessionState` round-trip test for both new fields, `loadSession`-with-orphan-repair round-trip test, and the two-pass message-builder fixtures from §"Message-builder behavior step 1").
6. `event-to-row.ts` modifications (REMOVE `context_compacted` case; `conversation_summary` + `compaction_failed` fall through to null — NOT indexed) + tests
7. Update `/compact` slash command (`conversation/slash-commands.ts`) + `ent/session/compact` RPC handler (`rpc/handlers/session-operations.ts`) to emit `conversation_summary` via the new strategy. Slash command uses the `writeAndAdvance` parameter (no enclosing `runExclusive` scope — v6 Critical 2); RPC handler uses raw `appendDurableEvent` + `writeSessionState` (already inside its own `runExclusive`). Both paths get explicit `try/catch` per §"Failure write contract for user-initiated callers". Remove the `strategy` wire-enum values `'trim-tool-results'` and `'selective'` from the RPC params type. DELETE `compaction/compact-dropped-messages.ts` and `compaction/registry.ts` (v6 Important 1 / Critical 4); both modules are unreferenced after this step and their continued existence creates the temptation to wire the new strategy into a shape that doesn't fit.
8. Runner integration in `runner.ts` (the trigger hook per §"Lifecycle hook"; imports `createProviderForTurn` from `providers/turn-factory.ts` and `compact` from `compaction/summarize-strategy`; sources `modelId` from `this.config` and `connectionId` from `getEffectiveConfig(...)` per v6 C3; single `runExclusive` scope around success+failure writes; raw `appendDurableEvent` + `writeSessionState` for the durable writes per v6 C2; explicit `writeSessionState` calls that persist `nextRetryAtEventSeq` / `compactionDisabled` per v6 C6)
9. Sen-core companion PR: **delete** `sen-core-v2/src/turn-hooks/compaction-trigger.ts` and its wiring. This ships in lockstep with the lace trigger landing; sen-core no longer drives compaction.
10. Register new strategy in `sen2/compaction/` harness as a strategy module
11. First harness run against Ada-fixture; iterate on prompt/schema/thresholds based on output
12. **Cutover playbook** (replaces v2's migration script): document the stop / snapshot / truncate-events / drop-FTS / restart sequence. Write the script as a small shell helper under `sen2/compaction/scripts/cutover-clear.sh` so the exact commands are version-controlled and rerunnable on any future agent that ends up with `context_compacted` on disk.
13. Execute the cutover against Ada on the new lace build.

### Lockstep PRs

| Repo | PR contents |
|---|---|
| lace | precondition kata: `usage.lastCallInputContextTokens` |
| lace | typed-capsule strategy + trigger + message-builder + recall + slash-command + RPC handler + `SessionState.compactionDisabled` all in one PR |
| sen-core-v2 | delete `turn-hooks/compaction-trigger.ts` and its wiring |
| compaction | harness strategy module + cutover-clear.sh playbook |

The lace PR and the sen-core-v2 PR must merge in the same Ada deploy. The compaction-repo PR can land independently any time after the lace PR.

---

## v2 changelog (mapping to round-1 reviewer findings)

Listed in finding-number order. "Addressed" entries describe the change in v2; "verified-still-true" entries note where I confirmed the finding against current source. Some v2 resolutions are superseded by v3 reframes — see the v3 changelog for those.

### Critical findings (round 1)

1. **`context_compacted` writers** — Addressed by §"Writers that produce conversation_summary". `/compact`, `ent/session/compact`, and `event-to-row.ts` updated in lockstep.
2. **Migration range contract** — Addressed in v2 by the cumulative-range contract on every `conversation_summary`. v3: section retained as the runtime contract (the migration sub-clause is deleted because there's no migration). v4: the `replacesEventSeqRange` field itself is gone (the inclusive range is derived from `recentTailStartsAtEventSeq`), but the cumulative-from-1 invariant remains.
3. **`fullContextTokens` formula** — Addressed by §"Preconditions §3" and §"Trigger signal". Per-call sum problem solved by adding `lastCallInputContextTokens` field on `turn_end`.
4. **Rebuild bounded** — Addressed by §"Rebuild mode" in v2/v3. v4: the bounded-rebuild path is gone; rebuilds that exceed summarizer context produce `compaction_failed`. See v4-cut #4.
5. **ModelPinnedProvider** — v2 used the wrapper. Superseded in v3 by R6 — switched to `createProviderForTurn` pattern.
6. **`appendDurableEvent` vs eventSeq preservation** — v2 documented direct JSONL writes for migration. No longer relevant in v3/v4 (no migration); however, the discovery that `appendDurableEvent` derives its own `eventSeq` (verified `event-log.ts:434`) is preserved as context for future migration-style work.
7. **Recall FTS stale + new events un-indexed** — v2 addressed by per-session FTS cleanup. Superseded in v3 by R1 — summaries are not indexed at all, removing the cleanup requirement.
8. **`compaction_failed` builder behavior** — Addressed by §"Message-builder behavior §2". v3 makes the allowlist explicit and exhaustive (B-I4).
9. **Trigger fires NaN on pre-PRI-1817 events** — v2 made PRI-1817 a hard precondition. Superseded in v3 by R4 — `?? 0` defaults make the formula correct across providers without refusing pre-PRI-1817 sessions.

### Important findings (round 1)

10. **Stop-reason gating** — Addressed by §"Trigger evaluator" gating rule §2. v3 broadens the whitelist to `['end_turn', 'stop_sequence', 'max_turns']` (B-C4).
11. **`appendDurableEvent` signature** — Addressed by the code example in §"Lifecycle hook".
12. **Re-entrant compaction** — Addressed by §"Concurrency". v3 added the file-based flock requirement (B-I14); v4 dropped flock — only the in-process `runExclusive` mutex remains.
13. **Subagent sessions** — Addressed by §"Subagent sessions".
14. **Sen-core's existing trigger** — Addressed by §"Implementation order" and §"Lockstep PRs".
15. **Budget heuristic measures wrong thing** — Addressed by §"Budget enforcement §2".
16. **Migration tail-start math** — v2 addressed via single-capsule-per-session. No longer relevant in v3/v4 (no migration).
17. **Tool-use/tool-result walk-left mental model** — Addressed by §"Tail policy §5". v3 further clarifies the boundary between this guard (in-flight tool not yet completed) and `dropOrphanedToolBlocks` (crash-recovery orphans).
18. **`errorMessage` vs `error` field-name** — Addressed by §"New durable event types". Field is consistently `errorMessage` everywhere.
19. **`recentHumanPrompts: 100` blows past 1M context** — Addressed by §"Tail policy" + §"Defaults rationale". v3 tightened the token budget cap to 0.10; v4 dropped the count cap entirely in favor of the token-budget cap alone.
20. **Rolling-mode delta empty/inverted** — Addressed by §"Rolling mode §4" in v3. v4 cut rolling mode, so the empty-delta concern is moot.
21. **Capsule schema drops envelope fields** — Addressed by §"New durable event types" (envelope fields on the wrapping event, capsule stays pure content). v3 narrowed `criticStatus` to a single-valued enum (A-I22) and switched `schemaVersion` to numeric (A-I21); v4 dropped both fields outright (no readers).
22. **No backoff after repeated failures** — Addressed by §"Failure backoff". v4 derives the consecutive-failure count from the event log instead of storing it on the failure event.
23. **Message-builder reset semantics** — Addressed by §"Message-builder behavior §1".
24. **Per-day-per-persona transcript layout** — v2 addressed via `<laceDir>` invocation in migration. No longer relevant in v3/v4 (no migration tool).
25. **`modelMaxContext` undefined → trigger always fires** — v2 added a null gate. Superseded in v3 by B-C6 — the lookup never returns null; the null gate was dead code; removed.
26. **Cross-repo workspace dep** — Addressed by §"Build / repo plumbing".
27. **Migration cost estimate off** — No longer relevant in v3/v4 (no migration; cutover cost is $0).
28. **`humanChannelMatcher` default silently drops new channels** — Addressed by §"Tail policy" in v3; v4 dropped the per-session override knob — widening is a source-edit.

---

## v3 changelog (round-2 findings + reframes)

### Reframes (Jesse's architectural changes)

- **R1 — Summaries are NOT recall-indexed.** §"Recall (FTS) integration" rewritten: `event-to-row.ts` returns null for both `conversation_summary` and `compaction_failed`. Removes the entire FTS-row-size / FTS-cleanup concern.
- **R2 — One-time clear of Ada, not migration.** §"Migration" → §"Cutover: one-time clear of Ada". Deleted: `migrate-old-compactions.ts`, `--dry-run`, `.pre-migration-<ISO>` backups, FTS cleanup, daily-transcript iteration, the `'migration'` `generationMode` value, the cost-of-migration sub-section, the "Other sessions" migration recipe.
- **R3 — `trim-tool-results` becomes a pre-pass.** §"Compaction algorithm → trim-tool-results pre-pass". Wire enum on RPC collapsed to `'summarize'` only.
- **R4 — `?? 0` defaults make it 100% provider-compat.** §"Preconditions §1" rewritten: PRI-1817 is precondition for Anthropic accuracy but lace starts on any session.
- **R5 — Trigger rebalance for real headroom.** §"Trigger evaluator" + §"Defaults rationale" updated.
- **R6 — `createProviderForTurn` pattern, not `ModelPinnedProvider`.** §"Lifecycle hook" rewritten.
- **R7 — Bounded-rebuild uses summarizer's own budget.** Superseded in v4 — bounded-rebuild is gone.

### Round-2 critical findings (status in v3 retained unless noted)

- B-C3 `runExclusive` around the failure write (v4 keeps it; collapses both writes into one scope).
- B-C4 Stop-reason whitelist (carried).
- B-C6 Dead `modelMaxContext === null` gating rule removed (carried).
- B-C7 `dropOrphanedToolBlocks` runs unconditionally (carried).
- B-C8 Empty-delta fallback goes through bounded-rebuild — superseded in v4 (no rolling mode means no empty delta).

### Round-2 important findings (status in v3 retained unless noted)

- B-I3 / A-I8 Sen-core's existing trigger removal (carried).
- B-I4 Explicit allowlist of event types in message-builder (carried).
- B-I9 Migration timestamp / eventSeq ordering — dropped from v3.
- B-I12 `rebuildEveryNCompactions` counter location — superseded in v4 (no counter; no rebuildEveryN).
- B-I14 Multi-process compaction lock — superseded in v4 (flock dropped).
- B-I15 / B-I16 Migration-related deletes — dropped from v3.
- A-I20 `errorMessage` vs `error` field name (carried).
- A-I21 `schemaVersion` numeric vs string literal — superseded in v4 (`schemaVersion` field cut).
- A-I22 `criticStatus` enum — superseded in v4 (`criticStatus` field cut).

### Findings disproved on re-verification (v3)

- A-C4 refuse-to-start on pre-PRI-1817 sessions (carried).
- A-C6 FTS-row-size blowup for capsule contents (carried).
- B-C6 stricter reading: `modelMaxContext === null` gating rule (carried).
- B-C7 stricter reading: tool-use boundary guard vs orphan-block source (carried).

### Findings I did not fully resolve and am surfacing to Jesse (v3)

- Subagent default OFF — carried.
- `SUMMARIZER_OVERHEAD_TOKENS = 20,000` — superseded in v4 (constant cut along with bounded-rebuild).
- `compactionsSinceLastRebuild` and PRI-1819 SessionState shape — superseded in v4 (`compactionsSinceLastRebuild` cut; only `compactionDisabled` added).
- `trim-tool-results-strategy.ts` registration — carried (still registered; harness comparator + internal pre-pass caller).

---

## v4 changelog (round-3 YAGNI/DRY cuts)

This round had no new "findings" — it was Jesse's reduction pass on v3's surface area. Each numbered cut from the briefing is accounted for below.

### Architectural cuts

- **Cut 1 — `CompactionContext.providerFactory` indirection.** Replaced by `summarizer: Provider` direct parameter. The lifecycle hook does `await createProviderForTurn(...)` + `setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT)` and passes the resulting Provider into `compact` (v5 corrected name; v4 said `runCompaction`). The "providerFactory invoked exactly once" test is replaced by a "summarizer param is the caller-supplied Provider" assertion (§"Unit tests → summarize-strategy.test.ts"). v3's §"CompactionContext refactor (R6)" section is deleted; `CompactionContext` definition moved inline into §"Compaction algorithm".
- **Cut 2 — File-based `flock` cross-process lock.** §"Concurrency" rewritten. The runner's existing in-process `runExclusive` is the only mutex. `compaction/compaction-lock.ts` is removed from the module layout. The cross-process flock test is removed. The discussion of NFS / signal cleanup is gone. The "Cross-process compaction" bullet documents the deliberate non-defense.
- **Cut 3 — `rolling` compaction mode.** Removed everywhere. `generationMode` is now a single-valued enum (`'rebuild_from_canonical'`). `rebuildEveryNCompactions` is gone. `SessionState.compactionsSinceLastRebuild` is gone. `TriggerDecision.mode` is gone (replaced with no field). The "10th compaction triggers rebuild" test is gone. §"Rolling mode" content is gone. The `previousCapsule` parameter to the summarizer prompt is gone. Any rolling-vs-rebuild trade-off discussion is gone. The compaction algorithm is now a single rebuild path documented in §"Compaction algorithm → Single rebuild path".
- **Cut 4 — `bounded-rebuild` + `mini-rebuild` fallback chain.** §"Rebuild mode → Bounded rebuild" deleted. `summarizerBudget` constant + calculation deleted. `SUMMARIZER_OVERHEAD_TOKENS = 20_000` constant deleted. Mini-rebuild references gone. Empty-delta fallback gone (rolling is gone; empty delta can't happen). The orphan-oversized-session escape hatch and follow-up kata gone. Replaced by §"Failure modes → rebuild exceeds summarizer context": the summarizer call fails, the strategy emits `compaction_failed` with `reason: 'global'` or `'emergency'`, operator notices via alarm.

### Envelope field cuts (from `ConversationSummaryEventData`)

- **Cut 5 — `sourceStartEventId`.** Removed. It duplicated `replacesEventSeqRange.fromInclusive` which is the constant `1`.
- **Cut 6 — `sourceEndEventId`.** Removed. It duplicated `replacesEventSeqRange.toInclusive` which is also removed (Cut 14).
- **Cut 7 — `purpose`.** Removed. Written exactly once with `'bounded_rebuild'`, which is gone.
- **Cut 8 — `criticStatus`.** Removed. Single-valued enum (`'unchecked'`) with no critic in v1; nothing reads it.
- **Cut 9 — `budgetOverrunBy`.** Removed. Diagnostic field; no consumers. If we need it later, WARN-log inside `summarizeWithBudget`.
- **Cut 10 — `retries`.** Removed. Same rationale as Cut 9.
- **Cut 11 — `schemaVersion`.** Removed. The spec explicitly says no migration after the one-time clear; there is no migration story to version.
- **Cut 12 — `'user_initiated'` value from `generationMode` enum.** Removed. `generationMode` is now single-valued (`'rebuild_from_canonical'`). NOTE: `'user_initiated'` stays on the `CompactionFailedEventData.reason` union — `/compact` invocations can still fail and need to mark themselves as operator-driven.

### Other field cuts

- **Cut 13 — `consecutiveFailures` on `CompactionFailedEventData`.** Removed. The count is recoverable by walking the event log backward from the latest `turn_end` and counting `compaction_failed` events with no intervening `conversation_summary`. §"Failure backoff" now derives the count at decision time.

### Boundary deduplication

- **Cut 14 — `replacesEventSeqRange.toInclusive`.** Removed. With `fromInclusive` (Cut 6 side-effect) and `toInclusive` both removed, and `sourceStartEventId` / `sourceEndEventId` also removed (Cuts 5, 6), the `replacesEventSeqRange` field as a whole became a degenerate `{ fromInclusive: 1 }` constant. v4 drops the field entirely; the inclusive range is derived from `recentTailStartsAtEventSeq` (range = `[1, recentTailStartsAtEventSeq - 1]`). The two spots that need the upper bound (message-builder rebuild, harness acceptance check) compute it inline.

### Tail policy cuts

- **Cut 15 — `recentHumanPrompts` count cap.** Removed. The token-budget cap (`recentHumanPromptsTokenBudgetPct`) is what matters for context safety; the count cap was redundant.
- **Cut 16 — Single-pass tail walk.** §"Tail policy → Algorithm" rewritten: one backward walk tracking turn-boundary AND human-prompt-token-budget criteria simultaneously, stopping at whichever boundary fires first. v3's algorithm walked twice; v4 walks once. New unit-test row asserts each event is visited at most once.

### Module collapse

- **Cut 17 — Fold `summarizer-prompt.ts`, `budget-retry.ts`, `capsule-markdown.ts` into `summarize-strategy.ts` as top-level functions.** Module layout box updated; only `capsule-types.ts`, `tail-policy.ts`, and `compaction-trigger.ts` remain as separate files. The implementation-order steps updated accordingly. The test names retained their previous granularity (still talk about a "capsule-markdown" test, a "summarizer-prompt" test, a "budget-retry" test) but they all sit alongside `summarize-strategy.test.ts` testing top-level exports from one file.

### Config knob cuts

- **Cut 18 — `humanChannelMatcher` per-session config knob.** Removed from `TailConfig`. The default match logic is inline in §"Tail policy → Algorithm" step 2; widening it is a source edit. Open question retained as a kata-trigger for non-Slack ingress.
- **Cut 19 — Per-session config overrides for `globalThresholdPct` / `emergencyThresholdPct`.** Documented as globally-tuned constants in §"Trigger evaluator". The note about "Configurable per session via existing session-config plumbing" from v3 is removed. File a kata if per-session ever becomes necessary.
- **Cut 20 — Subagent `enabled: false` per-session override knob.** The `enabled` field is gone from `TriggerConfig` entirely. Subagent suppression now flows through an `isSubagentSession: boolean` parameter to `evaluateTrigger`, computed from session meta at runner construction time. The persistent-disable mechanism for the M=10 backoff cap is a separate `SessionState.compactionDisabled` flag (not a config knob) — see §"Failure backoff".

### Confidence rendering cut

- **Cut 21 — "Mark items with `confidence < 0.5` with `(uncertain)`" rule.** Removed from §"Markdown rendering" requirements list and from the `capsule-markdown.test.ts` test inventory. No downstream consumer reads the confidence value or the marker. The `confidence` field stays in the schema (the research report wants it captured), just not surfaced in the renderer.

### Test cuts

- **Cut 22 — "tail-policy under v3 0.10 default" test.** Removed from §"Unit tests → tail-policy.test.ts" inventory. The remaining tail-policy tests assert behavior under specified inputs without pinning a default value.
- **Cut 23 — Three-way provider table tests.** Collapsed into ONE parametric test in §"Unit tests → compaction-trigger.test.ts" that asserts the `?? 0` formula across the three cache-field shapes (input-only, input+cacheRead, input+cacheCreation+cacheRead). The test runs the same arithmetic with three input rows.

### Preserved per Jesse's call (round-3 keeps)

- **All 13 capsule sections** — preserved as-is, confirmed in §"Capsule schema". `emotionalAndRelationshipContext`, `participants`, and `doNotInfer` remain in the union.
- **4-tier failure backoff (1→2→4→8→16 turn skip + N=10 disable)** — preserved as-is, confirmed in §"Failure backoff". Defense against transient API floods.
- **`compaction_failed` event type** — preserved as-is, confirmed in §"New durable event types". Durable telemetry > logs for observability dashboards.

### Open-question consistency check

The round-3 briefing asked: what was rolling mode used for in `/compact` and `ent/session/compact`? Verified against v3 §"Writers that produce conversation_summary" §§2-3: both user-initiated callers were already routed through `mode: 'rebuild_from_canonical'`. Removing rolling mode is invisible to them. The only stale rolling reference in either call site's v3 wording was the `'user_initiated'` `generationMode` value, which Cut 12 removes. v4 §"Writers that produce conversation_summary" §§2-3 now describe both as "user-initiated, no mode parameter, always rebuild" with no behavioral change.

---

## v5 changelog (round-4 correctness fixes)

Round 4 was a correctness adversarial review. Each numbered finding is accounted for. "Addressed how" entries describe the v5 change; "verified-as-bug" entries note where I confirmed the finding against current lace `main`.

### Critical findings

- **Critical 1 — `runExclusive` non-reentrant; lifecycle hook using `writeAndAdvance` would deadlock.** Verified-as-bug. `server.ts:314-328` is a chained-promise mutex; `runner.ts:392-404` `writeAndAdvance` wraps every write in `runExclusive`; calling it from inside an outer `runExclusive` blocks forever. Addressed by adding a new §"Strategy internal event writes (deadlock guard)" subsection under §"Lifecycle hook" that makes the rule explicit: the strategy's internal `conversation_summary` write goes through direct `appendDurableEvent` + `writeSessionState` calls using `ctx.sessionDir`, NEVER through the runner's `writeAndAdvance`. The same rule applies to the `/compact` and `ent/session/compact` callers (they also run inside `runExclusive` scopes). Two new tests added to `summarize-strategy.test.ts` (the deadlock-detection harness and the post-compaction `writeAndAdvance`-doesn't-hang assertion). Lifecycle-hook pseudocode comment updated to make the rule load-bearing.

- **Critical 2 — `lastCallInputContextTokens` formula used wrong field name.** Verified-as-bug. In-memory `ProviderResponse.usage` (`base-provider.ts:64-85`) uses `promptTokens`; durable on-disk `TurnEndEventData.usage` (`event-types.ts:62-82`) uses `inputTokens`. v4 spec said `lastResponse.usage.inputTokens` which is `undefined`. Addressed by changing the formula to `lastResponse.usage.promptTokens` AND adding an explicit field-name precision note explaining the in-memory-vs-durable shape difference. Provider-compatibility table column header updated from `inputTokens` to `promptTokens`.

- **Critical 3 — `trim-tool-results` pre-pass cascade: existing strategy reads `LaceEvent[]`, new code passes `TypedDurableEvent[]`.** Verified-as-bug. `trim-tool-results-strategy.ts:4-64` imports `LaceEvent` and `ToolResult` from `@lace/agent/threads/types` and `@lace/agent/tools/types` — it's a different event shape than the new typed-capsule code uses. Addressed by extracting the trim logic as a new top-level function `trimToolResultLines(events: TypedDurableEvent[], lineCap: number = 3): TypedDurableEvent[]` in `summarize-strategy.ts`, and DELETING the legacy `trim-tool-results-strategy.ts` file entirely. The registry (`compaction/registry.ts:9`) drops the strategy registration. `compact-dropped-messages.ts`'s `strategyId === 'trim-tool-results'` branch becomes dead and is removed. The harness's standalone-measurement use case folds into the same helper. Spec module layout updated; implementation-order section now lists the file as DELETED.

- **Critical 4 — `SessionState.compactionDisabled` silently dropped by `readSessionState` whitelist parser.** Verified-as-bug. `session-store.ts:147-162` is an explicit per-field whitelist; type-only additions are dropped on read. Addressed by adding a new §"Persistent disable round-trip (Critical 4 + Important 5)" subsection that documents the required parser change (whitelist `compactionDisabled` AND `nextRetryAtEventSeq`); implementation-order step 5 updated to call out the `session-store.ts` change; required round-trip test added. Note: no `SessionStateSchema` zod exists today (verified) — only the TS type and the whitelist parser need updating, NOT a non-existent schema.

- **Critical 5 — `'no-op'` reason value referenced but not in enum.** Verified-as-bug. v4 §"Tail policy step 4" said "emit `compaction_failed` with reason='no-op'" but the type's union is `'global' | 'emergency' | 'user_initiated'`. Addressed per the recommended resolution: rewrote tail-policy step 4 to short-circuit BEFORE invoking `compact()` when `tailStartEventSeq === 1`. The strategy is not called, no event is written, the trigger evaluator returns `'below_threshold'` in normal cases. `'no-op'` is NOT added to the reason union. This is also the resolution path for Important 8.

- **Critical 6 — `'user_initiated'` reason value has no specified writer.** Verified-as-bug. v4 listed the value on the enum but neither `/compact` nor `ent/session/compact` was spec'd to write `compaction_failed` on catch. Addressed by adding a new §"Failure write contract for user-initiated callers (Critical 6)" subsection that gives both callers explicit try/catch pseudocode writing `compaction_failed{reason: 'user_initiated', errorMessage: ...}` before surfacing the error. Backoff-counter algorithm updated: user-initiated failure events are SKIPPED by the auto-trigger backoff walk (operator presses shouldn't trip M=10). Documented and tested.

- **Critical 7 — `getModelContextWindow` is `protected`.** Verified-as-bug. `base-provider.ts:481` declares it `protected`. Addressed by specifying the visibility change — `protected` → `public` — as a one-line source edit in §"Trigger evaluator → gating rule 4" and in the module layout box (`providers/base-provider.ts` MODIFIED). No wrapper method; just the visibility change.

### Important findings

- **Important 1 — Failure-backoff doubling semantics underspecified.** Resolution: option (a) (explicit `nextRetryAtEventSeq: number | undefined` field on `SessionState`). Documented in the rewritten §"Failure backoff" with explicit state-update and gate-check pseudocode. The doubling table is now formulaic (`Math.min(16, 1 << (consecutive - 3))`) and the gate compares the current `eventSeq` against the stored field. Field is whitelisted in `readSessionState` per Critical 4.

- **Important 2 — `/compact` and `ent/session/compact` user-initiated failures.** Same fix as Critical 6.

- **Important 3 — Tail-policy in-flight tool_use guard handles single but not clusters.** Addressed in §"Tail policy step 5" by changing the guard from "walk left by one event" to a `while`-loop that walks left as long as the boundary lands on a `tool_use` with `result === undefined`. New test fixture: three back-to-back in-flight tool_use events; boundary walks past all three.

- **Important 4 — Stale path: `core/conversation/slash-commands.ts`.** Verified-as-bug. The file is at `packages/agent/src/conversation/slash-commands.ts` (no `core/` prefix). Addressed by correcting every path reference and adding an explicit "Note on the `conversation/` vs `core/conversation/` split" paragraph at the end of the module layout box.

- **Important 5 — `SessionState.compactionDisabled` lifecycle across `loadSession` round-trip.** Addressed in §"Persistent disable round-trip" subsection: `loadSession` reads via `readSessionState` (so Critical 4 fix propagates), then `repairOrphanTurnStarts` writes via `appendDurableEvent` which spreads `state` and only overwrites `nextEventSeq`. All other fields (including `compactionDisabled` and `nextRetryAtEventSeq`) survive automatically. Required test added.

- **Important 6 — `runCompaction` vs `compact` naming.** Addressed by replacing every `runCompaction` reference in the spec with `compact`. The existing `CompactionStrategy.compact()` interface name is preserved. Lifecycle-hook pseudocode, contract notes, test names all updated.

- **Important 7 — `evaluateTrigger` walk-position ambiguous.** Addressed in the rewritten §"Failure backoff" first paragraph: the walk starts at end-of-log and counts backward until a non-failure event (specifically excluding `compaction_failed{reason: 'user_initiated'}` from the count, per Critical 6). Test added: fixture with `turn_end` + 2× `compaction_failed` asserts count is 2.

- **Important 8 — `CompactionResult.event` optional vs required.** Resolution tied to Critical 5: the short-circuit happens at the CALLER before `compact()` is invoked, so the strategy is never called in the no-op case. `event` stays REQUIRED on `CompactionResult`. Documented inline in §"Compaction algorithm".

- **Important 9 — `isSubagentSession` not plumbed through `RunnerDependencies`.** Verified-as-bug. `RunnerDependencies` at `core/conversation/types.ts:58-145` has no such field. Addressed by adding an explicit "Plumbing `isSubagentSession`" subsection under §"Trigger evaluator" that documents the field addition AND the derivation: `isSubagentSession: Boolean(sessionMeta.parent)` (where `meta.parent?` is the existing optional field at `session-store.ts:45`).

- **Important 10 — Tail-policy single-pass walk can split mid-turn.** Addressed in §"Tail policy step 6" (new step) that walks left after step 5 until the boundary lands on a `turn_start` event. Test added.

- **Important 11 — Stop-reason list omits PRI-1818 error-shaped values.** Verified-as-bug. `core/conversation/types.ts:250-256` defines the seven `provider_error_*` / `tool_error_*` / `internal_error` values; v4 spec didn't list them. Addressed in §"Trigger evaluator → gating rule 2" by enumerating every rejected stop reason explicitly, including all PRI-1818 values (the seven runner-derived errors PLUS the two synthesized labels `process_died` and `prompt_handler_caught`). `compaction-trigger.test.ts` test row also expanded to cover all rejected stop reasons.

### Minor findings

- **Minor 1 — Message-builder is `if`-chain, not `switch`.** Verified-as-bug. `message-builder.ts:257-369` is a for-loop with conditional `if (type === X) { ... continue; }` blocks. Addressed in §"Message-builder behavior step 3" by updating the description and the "add a throw at the end" guidance to match the actual loop structure.

- **Minor 2 — Ada-cutover SQL uses `LIKE %`.** Verified-as-bug. `event-to-row.ts:44-46` stores `session_id` as the exact session id. Addressed in §"Cutover → Procedure step 4" by replacing the `LIKE '<prefix>%'` SQL with `session_id = '<full ada session id>'`.

- **Minor 3 — `evaluateTrigger` receives full sessionEvents on every turn.** Documented in §"Trigger evaluator" performance note: callers MAY pass a tail-slice; v1 callers can pass the full array. Optimization deferred.

- **Minor 4 — `tool_use` as `turn_end` stopReason misleading note.** Verified-as-bug. `runner.ts:773-795` shows `tool_use` is consumed inside the agentic loop and never written to `turn_end`. Addressed in the §"Trigger evaluator → gating rule 2" rejected-stopReasons list: the `tool_use` parenthetical now says "the runner consumes this stop reason inside its agentic loop and never writes it to a durable turn_end event. Listed here for completeness; in practice the trigger never sees a turn_end with stopReason === 'tool_use'."

### Findings I am surfacing to Jesse (v5)

No unresolvable tensions surfaced. Two minor decision points to flag:

1. **Backoff EVENTS_PER_TURN_APPROX = 4.** The `nextRetryAtEventSeq` field stores an event-seq target derived from `currentEventSeq + skipTurns * EVENTS_PER_TURN_APPROX`. I picked 4 as a floor (prompt + turn_start + message + turn_end) which over-counts the "turns elapsed" for tool-using turns (those have more events), meaning we wait LONGER than nominal in backoff. Safe direction — the alternative (counting actual `turn_end` events instead of events-since) would be more accurate but require a second walk on every evaluation. If the over-wait is a problem in practice, file a kata.

2. **User-initiated failure backoff semantics.** I went with "user-initiated failures are TRANSPARENT to the auto-trigger backoff walk" (skipped by the walk; don't increment or reset the count). The alternative was "separate counter for user-initiated failures." The transparent-skip path is simpler and matches the intent: the auto-trigger backoff is about transient API floods, not operator decisions; if the operator wants to spam `/compact` during an outage that's their choice. If repeated user-initiated failures should trip a separate kind of disable, file a kata.

### Findings I did not change (per spec instruction to surface tensions, not assume)

None — every round-4 finding was source-verified and applied.

---

## v6 changelog (round-5 correctness fixes)

Round 5 was a second-level correctness adversarial review of v5. Each numbered finding is accounted for. "Addressed how" entries describe the v6 change; "verified-as-bug" entries note the source verification.

### Critical findings

- **C1 — Backoff walk terminates on `turn_end`, so N=3 / N=10 escalations are unreachable.** Verified-as-bug. The lifecycle hook fires AFTER `turn_end` (lifecycle-hook pseudocode in §"Lifecycle hook"); so the on-disk shape between two consecutive failures is `..., turn_end_N, compaction_failed_N, prompt_{N+1}, turn_start_{N+1}, message_{N+1}, turn_end_{N+1}, compaction_failed_{N+1}, ...`. v5's walk terminated on the first `turn_end`, capping the count at 1. Addressed in the rewritten §"Failure backoff" → "Walk semantics (v6 Critical 1 + Important 6)": the walk now SKIPS over `turn_end`, `prompt`, `turn_start`, and the other non-strategic event types listed in the message-builder allowlist, only TERMINATING on a `conversation_summary` event or start-of-log, and only INCREMENTING on `compaction_failed{reason: 'global'|'emergency'}`. Test fixture updated to reflect the realistic on-disk shape (no back-to-back compaction_failed events).

- **C2 — `/compact` slash command is NOT inside an outer `runExclusive` scope.** Verified-as-bug. `prompt.ts:169` invokes `handleSlashCommand(...)` with no enclosing `runExclusive`; only the `ent/session/compact` RPC handler at `session-operations.ts:468` wraps in `runExclusive`. v5 incorrectly claimed both ran inside `runExclusive`. Addressed in §"Failure write contract for user-initiated callers" (now refined per v6 Critical 2): two explicit pseudocode blocks — one for the RPC handler (raw `appendDurableEvent`, inside the existing outer scope) and one for the slash command (`writeAndAdvance`, no enclosing scope). The deadlock-guard contract in §"Strategy internal event writes (deadlock guard)" is also reworded as a two-pronged rule: inside an outer scope → raw appendDurableEvent; outside → writeAndAdvance.

- **C3 — Lifecycle-hook pseudocode references nonexistent `RunnerDependencies.createProviderForTurn` / `connectionId` / `modelId`.** Verified-as-bug. `RunnerDependencies` at `core/conversation/types.ts:58-184` has `createProvider()` (no args), no `connectionId`, no `modelId`. `createProviderForTurn` is a top-level export at `providers/turn-factory.ts:16`. `modelId` lives on `this.config` (`runner.ts:337`). `connectionId` is sourced via `getEffectiveConfig(state.config, session.state.config)` at the RPC handler site (`session-operations.ts:475-476`). Addressed by rewriting the lifecycle-hook pseudocode in §"Lifecycle hook" to: import `createProviderForTurn` directly from `providers/turn-factory.ts`; destructure `modelId` and `sessionDir` from `this.config`; read `sessionStateForConfig` via `readSessionState(sessionDir)` then call `getEffectiveConfig` with `(undefined, sessionStateForConfig.config)` shape; pass `connectionId: effectiveConfig.connectionId` and `modelId` to `createProviderForTurn`. No new `RunnerDependencies` fields added — v6 picks option (b) from the briefing.

- **C4 — `compact()` signature is NOT compatible with `CompactionStrategy.compact()`.** Verified-as-bug. Legacy interface at `compaction/types.ts:49-61`: `compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult>` with `CompactionResult = {compactionEvent, compactedEvents}`. New function: `compact(events: TypedDurableEvent[], ctx: {sessionDir, summarizer, modelMaxContext, targetTokens, tailConfig}): Promise<{event, metrics}>`. Different on every parameter. Addressed by adding a new §"`compact()` is not a `CompactionStrategy.compact()` implementation (v6 Critical 4)" subsection with a comparison table; the strategy registry (`registry.ts`) and `compact-dropped-messages.ts` are DELETED in v6 (see §"Strategy registry — removed in v6" and the module layout box) — the new strategy is imported by name as a top-level function. No adapter, no shim. The `CompactionStrategy` interface in `compaction/types.ts` becomes unused and is deleted with the registry.

- **C5 — Message-builder iterate-and-reset paradox.** Verified-as-bug. v5 said "reset `messages.length = 0` upon encountering the summary" AND "events with eventSeq ≥ `recentTailStartsAtEventSeq` are processed normally" — under in-order iteration these are incompatible (the tail events sit at seqs `[recentTailStartsAtEventSeq, summary_seq - 1]`, before the summary, so the reset throws them away). Addressed by rewriting §"Message-builder behavior step 1" as a two-pass algorithm: Pass 0 pre-scans for the latest `conversation_summary`; Pass 1 iterates in seq order, skipping events strictly summarized (`eventSeq < latestSummary.recentTailStartsAtEventSeq`), processing tail events normally, and when iteration reaches the `latestSummary.event` itself, calling `messages.unshift(...)` to PREPEND the capsule render (NOT `messages.length = 0` followed by push, which would discard the tail). Tests added for "tail events between recentTailStartsAtEventSeq and summary" and "two summaries — only the latest is rendered".

- **C6 — `nextRetryAtEventSeq` and `compactionDisabled` pseudocode never persist to disk.** Verified-as-bug. v5's failure-backoff pseudocode declared the values as local variables and never called `writeSessionState`. Addressed by (a) extracting `computeBackoffStatePatch(state, consecutive): Partial<SessionState>` as a pure helper in `compaction-trigger.ts`, (b) showing the caller-side `writeSessionState(sessionDir, { ...nextState, ...backoffPatch })` call explicitly in the lifecycle-hook pseudocode in §"Lifecycle hook" (catch branch), and (c) showing the symmetric clear-on-success pattern in the success branch (`writeSessionState(sessionDir, { ...nextState, compactionDisabled: undefined, nextRetryAtEventSeq: undefined })`). Required test added: write the fields, simulate restart, re-read via `readSessionState`, assert the persisted values survive.

### Important findings

- **I1 — `compact-dropped-messages.ts` shim contradicts new signature.** Verified-as-bug. Same fix as C4 — the file is DELETED in v6 (module layout box and implementation-order step 7 updated). No adapter remains.

- **I2 — `compact()` method-name claim doesn't preserve interface compatibility.** Same fix as C4. Wording updated everywhere.

- **I3 — Lifecycle-hook pseudocode references undeclared `modelMaxContext` and `tailConfig` locals.** Addressed by the new lifecycle-hook pseudocode preamble in §"Lifecycle hook": `modelMaxContext = this.provider.getModelContextWindow(modelId)` (after Critical 7 visibility change); `tailConfig = DEFAULT_TAIL_CONFIG` imported from `compaction/tail-policy`; `triggerConfig = DEFAULT_TRIGGER_CONFIG` imported from `core/conversation/compaction-trigger`.

- **I4 — In-flight tool_use cluster walk is O(N×K).** Verified-as-bug. v5 used `events.find(e => e.eventSeq === tailStartEventSeq)` inside a while loop. Addressed in §"Tail policy step 5" by switching to a backward index cursor (`tailIdx`) — single O(N) up-front to locate the boundary, then O(1) per decrement. Same pattern applied to step 6 (mid-turn split guard).

- **I5 — `context_compacted` branch in message-builder not in step 5's deletion list.** Verified-as-bug. The branch at `message-builder.ts:290-322` references `ContextCompactedData`, which is gone once the type is removed from the union — won't compile. Addressed in implementation-order step 5: now explicitly says "DELETE the existing `context_compacted` branch at `message-builder.ts:290-322` entirely".

- **I6 — Walk semantics for `user_initiated` are contradictory.** Verified-as-bug. v5 said "counts contiguous" AND "SKIPS user_initiated events" — mutually exclusive on a strict-contiguous walk. Addressed in §"Failure backoff" → "Walk semantics" (carrying the Critical 1 fix): the walk SKIPS over user_initiated failure events transparently (does not increment, does not reset). The walk continues looking for the next event. Test fixture covers this: mixed sequence 2 global + 1 user_initiated + 1 global → count is 3.

- **I7 — Field-name precision note muddles writer vs reader.** Addressed by rewriting the "Field-name precision" paragraph in §"Trigger signal": now explicitly identifies WRITER (the precondition kata in `runner.ts`, which reads `response.usage.promptTokens` from the in-memory shape and emits the single integer to the durable shape) vs READER (the trigger evaluator, which only ever reads `latestTurnEnd.data.usage.lastCallInputContextTokens` from the durable event). Citations updated: writer reads at `runner.ts:598-625`, writer writes at `runner.ts:986-1000`. No `promptTokens` access on the reader side.

- **I8 — Channel matcher includes a dead `"im"` entry.** Verified-as-bug. Slack channel IDs use `D` (DM), `C` (public channel), `G` (private channel). `im` is not a Slack channel-ID prefix; verified against `sen-core-v2/src/slack/envelope.ts` and its tests. Addressed in §"Tail policy step 2": dropped `<messages channel="im"`; matcher list is now `D` / `C` / `G` only, with the new "Slack channel-ID prefix" framing documented inline.

### Minor findings

- **M1 — `session-store.ts:147-162` citation off.** Verified-as-bug. The `readSessionState` function spans `:143-166`; the whitelist body itself is `:147-162`. Addressed in two places: the module-layout box (updated to `session-store.ts:143-166` with the parser-body sub-range called out) and the §"Persistent disable round-trip" subsection.

- **M2 — Pseudocode duplicates `type` inside `data`.** Verified-as-bug. `event-to-row.ts:37-40` documents that the inner `data.type` is NOT serialized — wire convention has only the outer `type`. Addressed by removing the inner `data.type` from every pseudocode block in v6 (the `appendDurableEvent` calls in the lifecycle hook + the user-initiated failure-write blocks). Inline comment added in §"Failure write contract for user-initiated callers".

- **M3 — `dropOrphanedToolBlocks` citation off.** Verified-as-bug. Function body is `message-builder.ts:114-189` (Pass A starts at 114, Pass B at 152). v5 said `:152-189` (Pass B only). Addressed in §"Message-builder behavior step 4": updated to `:114-189`.

- **M4 — Runner translation citation off.** Verified-as-bug. The in-memory `promptTokens` → accumulator translation happens at `runner.ts:600` (read); the accumulator → durable `inputTokens` write happens at `runner.ts:986-1000`. v5 said `runner.ts:986-1000` for the translation. Addressed in the rewritten field-name-precision paragraph: writer reads at `:598-625`, writer writes at `:986-1000`. Both sites named explicitly.

- **M5 — `EVENTS_PER_TURN_APPROX = 4` rationale is inverted.** Verified-as-bug. Real Ada-like load is ~12.5 events/turn; setting EPTA=4 means the formula reaches the target faster than nominal turns elapse, so we wait SHORTER than nominal, not longer. Addressed in §"Failure backoff": EPTA is now `12` (matches Ada-like load); rationale rewritten to be honest about over-waiting on light sessions (acceptable; safe direction; doubling-tier scaling has headroom). The "switch to walking turn_end events directly if over-wait bites" fallback is named as a deferred kata.

### Findings disproved on re-verification (v6)

None — every round-5 finding source-verified.

### Findings I am surfacing to Jesse (v6)

- **`compact-dropped-messages.ts` and `registry.ts` deletion.** I picked the cleaner path (delete both, import the new `compact()` by name from `summarize-strategy.ts`) over the adapter-shim path. The shim would have meant maintaining two `CompactionContext` shapes and two `CompactionResult` shapes for no current benefit. If a future user wants to provide a second strategy, the typed-capsule pattern (top-level exported `compact()` function with a typed `CompactionContext`) is what to extend; the legacy `LaceEvent[]`-based interface was not the right base. Surfacing because the briefing said "Pick one and document both paths" — I picked one and didn't document the rejected alternative beyond this note.

- **`getEffectiveConfig` call shape in the lifecycle hook.** The RPC handler has `state.config` (AgentServerState) in scope; the runner does not. I wrote the hook as `getEffectiveConfig(undefined, sessionStateForConfig.config)` — passing `undefined` for the AgentServerState-level config. This works IF `getEffectiveConfig` tolerates an undefined first arg (most do — they fall back to session-level config). If it throws on undefined, the runner needs to receive a snapshot of `state.config` via `RunnerDependencies` (one new optional field). I did NOT add that field in this revision because adding a new dep field for a fallback case I haven't verified felt premature. If the implementer hits a throw, file a kata or thread one extra field.

- **`EVENTS_PER_TURN_APPROX = 12`.** Set based on the cost-audit-pattern note that Ada runs ~12.5 events/turn. Lighter sessions wait longer; heavier sessions wait shorter. If the choice between "12 (Ada-tuned)" and "switch to counting turn_end events directly (accurate everywhere)" turns out to matter, the latter is the right answer but costs an extra walk per evaluation. Deferred per the briefing's "Acceptable because the backoff-tier scaling has plenty of headroom" framing.
