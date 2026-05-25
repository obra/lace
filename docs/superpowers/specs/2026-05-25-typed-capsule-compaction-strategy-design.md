# Typed-Capsule Compaction Strategy — Design (v3)

Date: 2026-05-25 (v1) / revised 2026-05-25 (v2) / revised 2026-05-25 (v3)
Author: Jesse + Bot

> v3 applies Jesse's architectural reframes (R1–R7) and addresses the round-2 adversarial findings (B-C3 through B-I16). The reframes collapse several v2 sections — most notably the migration tool and the FTS-cleanup machinery — by making summaries non-recall-indexed and replacing the per-session migration with a one-time clear of Ada. See the "v3 changelog" at the bottom for per-finding traceability and disprove-on-re-verification notes; the "v2 changelog" still lists the round-1 finding resolutions.

## Purpose

Replace lace's current `summarize` compaction strategy with a new implementation that emits a structured, typed conversation-state capsule into a dedicated durable event. The current strategy synthesizes a `[Earlier in our conversation: …]` USER_MESSAGE that is opaque, drifts across compactions ([PRI-1828](https://linear.app/prime-radiant/issue/PRI-1828)), and silently misses its token budget ([PRI-1827](https://linear.app/prime-radiant/issue/PRI-1827)). Lace currently also defaults to a near-no-op strategy ([PRI-1824](https://linear.app/prime-radiant/issue/PRI-1824)) and triggers compaction from sen-core rather than from lace itself.

This spec defines a single new strategy that supersedes `summarize`, plus the trigger logic that fires it from inside lace's runner. It is the load-bearing tier of the larger working-memory architecture sketched in `compaction/docs/research/working-memory-compaction.md`. Out-of-scope items from that research (compact critic, tool-result clearing as a separate primitive, micro-checkpoints, eval harness, drift detection, multi-user attribution as a first-class concern) are deferred to follow-up katas filed from this spec.

## Non-goals

- The compact critic (research report Phase 2). Adds an extra Anthropic call per compaction.
- Semantic micro-checkpoints + agent-facing checkpoint-request tool (Phase 4).
- Tool-result clearing as a distinct primitive (Phase 3). The capsule has a `toolState` field for future use but stays empty in v1. (Note: `trim-tool-results` is repurposed in v3 as a pre-pass inside the summarize strategy — see §"Compaction algorithm → trim-tool-results pre-pass".)
- Behavioral-equivalence eval harness (Phase 5). Future kata.
- Periodic rebuild drift-detection (Phase 6 — we do rebuild, just don't measure drift).
- Multi-user attribution beyond what the report's `participants` schema already encodes.
- Per-API-call cache-position persistence (related: [PRI-1819](https://linear.app/prime-radiant/issue/PRI-1819) follow-up [PRI-1821](https://linear.app/prime-radiant/issue/PRI-1821) — handled separately).
- Indexing capsule contents in recall/FTS. Recall reads canonical events only; the summary is for the model's working memory, not for search. See §"Recall (FTS) integration".

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
│   ├── registry.ts                     (existing — keeps trim-tool-results registered)
│   ├── trim-tool-results-strategy.ts   (existing — kept; now ALSO invoked internally as a pre-pass; see "trim-tool-results pre-pass")
│   ├── summarize-strategy.ts           REWRITTEN — emits typed capsule
│   ├── compact-dropped-messages.ts     (existing — its ModelPinnedProvider wrapper is NOT reused; see R6 / "Lifecycle hook")
│   ├── capsule-types.ts                NEW — capsule schema (zod)
│   ├── capsule-markdown.ts             NEW — JSON capsule → markdown prefix
│   ├── summarizer-prompt.ts            NEW — structured-output prompt
│   ├── tail-policy.ts                  NEW — last N turns + last K human prompts
│   ├── budget-retry.ts                 NEW — bounded-retry over-budget capsules
│   ├── compaction-lock.ts              NEW — session-level mutex (in-memory + file-based flock); see "Concurrency"
│   └── __tests__/
├── core/conversation/
│   ├── runner.ts                       MODIFIED — hook after turn_end + new last-call usage field
│   ├── compaction-trigger.ts           NEW — hybrid signal evaluator
│   ├── slash-commands.ts               MODIFIED — /compact now emits conversation_summary via the new strategy
│   └── __tests__/
├── rpc/handlers/
│   └── session-operations.ts           MODIFIED — ent/session/compact emits conversation_summary via the new strategy; legacy 'trim-tool-results' wire option removed
├── storage/
│   ├── event-types.ts                  MODIFIED — add conversation_summary + compaction_failed; REMOVE context_compacted; remove `strategy` enum value 'trim-tool-results' from RPC params
│   └── recall/
│       └── event-to-row.ts             MODIFIED — REMOVE context_compacted case; conversation_summary returns null (NOT indexed)
└── message-building/
    └── message-builder.ts              MODIFIED — render conversation_summary as prefix; reject unknown types; skip compaction_failed; ALWAYS run dropOrphanedToolBlocks regardless of whether a summary was rendered
```

There is no migration tool in v3 (see §"Cutover: one-time clear of Ada"). The `sen2/compaction/scripts/migrate-old-compactions.ts` path from v2 is dropped.

The old `context_compacted` event type is removed from the discriminated union entirely. There is no on-disk back-compat: the only session in production with `context_compacted` events on disk is Ada, and we wipe her `events.jsonl` rather than rewriting it. Future sessions never see `context_compacted` at all.

### Writers that produce conversation_summary

Three call sites currently produce `context_compacted`. All three are updated to produce `conversation_summary` in lockstep with this change:

1. **The new in-runner trigger** (this spec's main subject). Hook after `turn_end`. Mode `rolling | rebuild_from_canonical`.
2. **`/compact` slash command** in `conversation/slash-commands.ts` (around line 197). User-initiated. Mode `rebuild_from_canonical` (user invoked it explicitly; give them a fresh capsule).
3. **`ent/session/compact` RPC handler** in `rpc/handlers/session-operations.ts` (around line 551). Programmatic / sen-core-driven. Mode `rebuild_from_canonical` for the same reason — and because the post-trigger world means sen-core no longer drives compaction, this RPC becomes user-tooling only (`compaction view`, manual ops console).

All three call sites go through the same `compaction/summarize-strategy.ts:compact()` entry point and produce identically-shaped events. The strategy itself has no knowledge of which caller invoked it; the caller passes the mode.

### Strategy enum on the wire (RPC + slash)

In v2 the `ent/session/compact` RPC accepted a `strategy: 'summarize' | 'trim-tool-results' | 'selective'` parameter. v3 collapses this:

- `'summarize'` — the only accepted value. Default. Invokes the new typed-capsule strategy. The `trim-tool-results` pre-pass runs inside it (see §"Compaction algorithm → trim-tool-results pre-pass") — operators no longer choose it as a separate strategy.
- `'trim-tool-results'` — **REMOVED from the wire enum.** No longer a user-facing choice.
- `'selective'` — **REMOVED from the wire enum.** Was a stub in v2.

The `trim-tool-results-strategy.ts` file stays in the codebase: still registered in the strategy registry so that the new summarize strategy can call it internally as a pre-pass via the existing strategy interface, AND so that the offline `sen2/compaction/` harness can still run it as a standalone strategy for measurement. Production runtime callers (slash command, RPC handler) only see `summarize`.

## Data model

### New durable event types

Two new entries in `storage/event-types.ts`'s `DurableEventData` discriminated union:

```ts
export type ConversationSummaryEventData = {
  type: 'conversation_summary';
  capsule: Capsule;                     // see capsule-types.ts
  generatedAt: string;                  // ISO timestamp
  /**
   * Inclusive range of canonical eventSeqs that this summary represents.
   * Always cumulative from the start of the session: every emitted summary
   * has `fromInclusive = 1`. The message-builder reads only the latest
   * conversation_summary event.
   */
  replacesEventSeqRange: { fromInclusive: number; toInclusive: number };
  recentTailStartsAtEventSeq: number;
  schemaVersion: 1;                     // numeric (per A-I21); NOT a string literal
  generationMode: 'rolling' | 'rebuild_from_canonical' | 'user_initiated';
  generationCostUsd: number;
  generationTokens: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  budgetOverrunBy: number;              // 0 if capsule fit; positive if smallest-accepted
  retries: number;                      // budget-retry count
  // Metadata-only echoes of the research report §6 capsule envelope. Cheap to
  // carry; useful for diagnostics / future drift detection. The strategy
  // populates these from the summarizer's structured output if present, else
  // sets sensible defaults.
  purpose: string;                      // free-text label, e.g. "session_handoff", "bounded_rebuild"
  criticStatus: 'unchecked';            // single-valued enum in v1 (no critic implemented)
  sourceStartEventId: number;           // == replacesEventSeqRange.fromInclusive
  sourceEndEventId: number;             // == replacesEventSeqRange.toInclusive
};

export type CompactionFailedEventData = {
  type: 'compaction_failed';
  reason: 'global' | 'emergency' | 'user_initiated';
  errorMessage: string;                 // single canonical field name (per A-I20)
  consecutiveFailures: number;          // see "Failure backoff"
};
```

The old `context_compacted` event type is **REMOVED** from the discriminated union. We do not maintain backwards compatibility (per CLAUDE.md — pre-release v1, no legacy code). The Ada cutover (§"Cutover: one-time clear of Ada") wipes the only on-disk source of `context_compacted` events. Any session that for whatever reason still has `context_compacted` on disk fails loudly at message-builder time with a pointer at the cutover playbook.

Note on `generationMode`: v2 had a `'migration'` value. **Removed in v3** — there is no migration. The remaining three values cover every code path that writes a summary.

Note on `criticStatus`: kept as an enum (not a boolean) so a future critic implementation can extend it (`'critic_skipped' | 'critic_passed' | 'critic_revised' | 'critic_rejected'`) without a schema break. In v1 it is single-valued (`'unchecked'`); the union is intentionally narrow now.

### Capsule schema

In `compaction/capsule-types.ts`. Mirrors §6 of `docs/research/working-memory-compaction.md`'s **per-section** sub-schemas. The envelope-level fields (`purpose`, `criticStatus`, `sourceStartEventId`, `sourceEndEventId`) live on the wrapping `ConversationSummaryEventData` shown above, **not** inside the Capsule itself, to keep the Capsule a pure content type and the storage envelope responsible for provenance.

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

`compaction/capsule-markdown.ts` exports `renderCapsuleAsMarkdown(capsule: Capsule): string`. Output structure follows §11 of the research report — labeled sections with bullet lists, easy for the model to read. The markdown is what the model sees as the conversation prefix; the JSON is for storage, validation, and diff.

Renderer requirements:
- Skip sections whose array is empty (don't emit empty headers).
- Wrap exact quotes (`exactLanguageToPreserve`) in `> quoted text` blocks with attribution.
- Mark items with `confidence < 0.5` (where the schema has a confidence field) with a parenthetical `(uncertain)`.

## Trigger and lifecycle hook

### Trigger signal

The existing `turn_end.usage.{inputTokens, cacheCreationInputTokens, cacheReadInputTokens}` fields are **sums across every API call within the turn** (verified against `lace/packages/agent/src/core/conversation/runner.ts:598-608`: each tool-use iteration calls the provider, response.usage gets added into `totalInputTokens` etc.). Treating that sum as "on-the-wire context size" would over-count by a factor of N (number of tool-use iterations in the turn) and fire the trigger spuriously.

The trigger reads a new field, `usage.lastCallInputContextTokens` (single integer, populated by `runner.ts` from the LAST provider response of the turn — same scope as the existing `cacheMissReason` field). This is added by a precondition kata (see Preconditions §3). The field represents:

```
lastCallInputContextTokens
  = (lastResponse.usage.inputTokens ?? 0)
  + (lastResponse.usage.cacheCreationInputTokens ?? 0)
  + (lastResponse.usage.cacheReadInputTokens ?? 0)
```

For Anthropic: all three fields are populated; the sum IS the on-the-wire prefix size (uncached input + new cache writes + cache reads).

For non-Anthropic providers (OpenAI, Gemini, LMStudio, Ollama, OpenRouter): cache fields are absent (those providers don't have a prompt cache concept on the wire). The `?? 0` defaults reduce the formula to `inputTokens + 0 + 0 = inputTokens`, which is correct: those providers send the full conversation as fresh input on every call, so `inputTokens` IS the full prefix size. (R4 → provider-compat, not back-compat.)

### Provider compatibility

| Provider                | inputTokens | cacheCreation | cacheRead | Trigger arithmetic                                  |
|-------------------------|-------------|---------------|-----------|------------------------------------------------------|
| Anthropic (post-PRI-1817) | ✓           | ✓             | ✓         | Sum is the full prefix size on the wire. Correct.   |
| Anthropic (pre-PRI-1817)  | ✓           | (missing)     | (missing) | Sum reduces to `inputTokens` (uncached only). Under-counts the prefix → under-fires the trigger. Acceptable degradation; sessions self-heal after the next turn writes cache fields. |
| OpenAI / Gemini / LMStudio / Ollama / OpenRouter | ✓ | (n/a)     | (n/a)     | Sum reduces to `inputTokens`. **Correct** — those providers don't cache and `inputTokens` is the full prefix every call. |

The `?? 0` defaults make the formula work on every provider with no special-casing. **PRI-1817 remains a precondition for Anthropic accuracy**, but the lace build starts on any session regardless of whether PRI-1817 has been applied yet.

### Trigger evaluator

`core/conversation/compaction-trigger.ts` exports:

```ts
export type TriggerConfig = {
  globalThresholdPct: number;            // default 0.60 (was 0.40 in v2 — see "Defaults rationale")
  emergencyThresholdPct: number;         // default 0.90 (was 0.85 in v2)
  rebuildEveryNCompactions: number;      // default 10
  enabled: boolean;                      // default true; subagent sessions set to false
};

export type TriggerDecision =
  | { fire: false; reason: 'disabled' | 'below_threshold' | 'no_signal' | 'wrong_stop_reason' | 'backoff' }
  | { fire: true; reason: 'global' | 'emergency'; mode: 'rolling' | 'rebuild_from_canonical' };

export function evaluateTrigger(
  latestTurnEnd: TypedDurableEvent & { data: TurnEndEventData },
  sessionEvents: TypedDurableEvent[],
  modelMaxContext: number,
  config: TriggerConfig,
): TriggerDecision;
```

Note: `modelMaxContext` is `number` (not `number | null`). See gating rule §4 below for why.

Gating rules (all must pass for `fire: true`):

1. **Enabled.** `config.enabled === true`. Subagent sessions opt out by default; see §"Subagent sessions" below.
2. **Successful turn.** `latestTurnEnd.data.stopReason` is in the "ran to natural completion" whitelist: `['end_turn', 'stop_sequence', 'max_turns']`.
   - `end_turn` — model finished a normal response.
   - `stop_sequence` — model hit a configured stop sequence (clean termination by configuration).
   - `max_turns` — runner hit the per-turn tool-use cap; the conversation IS in a stable state, just one the agent didn't naturally finish. Compacting here is safe.
   - **NOT in the whitelist** and rejected: `tool_use` (mid-turn — runner is still iterating, turn not actually done from a conversation-state perspective; appears as a non-terminal `turn_end` only on certain provider paths), `max_output_tokens` / `pause_turn` / `incomplete` (response was truncated; the conversation state is mid-thought), `refusal` / `context_window_exceeded` / `cancelled` / `permission_cancelled` / `failed` / `budget_exceeded` (error / abort paths; conversation may be recoverable but compacting locks in possibly-bad context). PRI-1818's defense-in-depth `process_died` and `prompt_handler_caught` stop reasons (`event-types.ts:92, 101`) also fail this gate — they indicate the process didn't reach a clean turn boundary; the runner restart will rebuild messages and may produce orphan tool blocks, which §"Message-builder behavior" handles separately.

3. **Signal present.** `latestTurnEnd.data.usage?.lastCallInputContextTokens` is a finite positive number. Older transcripts written before the precondition kata lack this field. If missing, log warning + skip (don't compact a session we can't measure). Cache fields are NOT required here — the `?? 0` defaults make `lastCallInputContextTokens` itself the only required input.

4. **Model bound known.** `modelMaxContext` is taken to always be a finite positive number — `base-provider.ts:481-488`'s `getModelContextWindow` ALWAYS returns a number (`catalogModel?.context_window || fallback` with a 200K default fallback). There is no null path. (B-C6: v2 had a dead `if null then skip` rule; removed in v3. The evaluator's caller passes the result of `getModelContextWindow` directly; the result is always defined.)

If gates 1–3 pass and `modelMaxContext` is in hand:
- `pct = lastCallInputContextTokens / modelMaxContext`
- If `pct >= emergencyThresholdPct` → `fire: true, reason: 'emergency', mode: 'rebuild_from_canonical'`. Emergency always rebuilds because if a rolling compaction produced a stuck capsule we need a fresh anchor.
- Else if `pct >= globalThresholdPct` → `fire: true, reason: 'global', mode`. Mode is `rolling` unless `sessionState.compactionsSinceLastRebuild >= rebuildEveryNCompactions`, in which case `rebuild_from_canonical`. (See §"Periodic-rebuild counter" for where this counter lives.)
- Else → `fire: false, reason: 'below_threshold'`.

Thresholds are pure percentages of model max context. No absolute fallback — self-tunes across models (1M-context model fires at 600K for global; 200K-context model fires at 120K). Config is per-session-overridable through existing session-config plumbing.

### Defaults rationale

The headroom arithmetic at the new defaults:

- `globalThresholdPct: 0.60` — trigger fires when last-call context hits 60% of model max.
- `emergencyThresholdPct: 0.90` — emergency rebuild at 90% (was 0.85 in v2 — bumped because the global threshold moved up).
- `targetCapsuleTokensPct: 0.10` of model max — capsule budget is 10% of context (was implicit ~20% in v2). For 1M-context Sonnet, capsule budget is 100K tokens.
- `recentHumanPromptsTokenBudgetPct: 0.10` of model max — tail budget is 10% of context (was 0.20 in v2). For 1M-context Sonnet, tail budget is 100K tokens.
- Post-compaction state: capsule (10%) + tail (10%) = **20% of context**.
- Headroom before the next trigger fires: **60% – 20% = 40% of context** ≈ **400K tokens at 1M context**.
- Under Ada-like load (~70K tokens/turn growth), 400K headroom buys ~6–10 turns between compactions instead of every-turn churn. The next post-compaction trigger fires when the conversation has actually grown enough to need re-compaction; cache-creation cost (which dominates per-compaction cost) is paid weekly at most under Ada-like load, monthly+ under lighter load.

Subagent default stays `enabled: false` — see §"Subagent sessions".

### Periodic-rebuild counter

The trigger needs to know how many rolling compactions have happened since the last rebuild. v3 specifies (B-I12) that this counter lives on `SessionState`:

```ts
// In storage/session-store.ts SessionState (extension):
compactionsSinceLastRebuild?: number;   // optional; defaults to 0 if absent
```

- On a successful `conversation_summary` write with `generationMode === 'rolling'`: incremented by 1.
- On a successful `conversation_summary` write with `generationMode === 'rebuild_from_canonical'`: reset to 0.
- On `compaction_failed` write: unchanged (failures don't count as either).

The trigger reads this counter from `sessionState` (already accessible at the hook site because `readSessionState(sessionDir)` is called inside `runExclusive` for the failure path). The counter persists across process restarts because it lives in `state.json` alongside `nextEventSeq`.

### Lifecycle hook

In `runner.run()`, immediately after the successful `turn_end` write (the post-PRI-1818-#1 path that always writes turn_end), evaluate the trigger and — if it fires — run compaction inside the session-level lock. Code shape:

```ts
const decision = evaluateTrigger(turnEndEvent, sessionEvents, modelMaxContext, triggerConfig);
if (decision.fire) {
  // Acquire session-level compaction lock; blocks if another compaction is in
  // flight on the same session (subagent or peer). Cross-process via flock.
  // See "Concurrency" below.
  await withCompactionLock(sessionDir, async () => {
    try {
      // Build a FRESH provider for the summarizer call. Do NOT mutate
      // this.provider — its system prompt must remain the agent's persona
      // for subsequent turns. Mirrors the existing /compact RPC handler
      // pattern at session-operations.ts:507-511.
      const summarizerProvider = await this.deps.createProviderForTurn({
        connectionId: this.deps.connectionId,
        modelId: this.deps.modelId,
      });
      summarizerProvider.setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT);

      await runCompaction(sessionEvents, {
        mode: decision.mode,
        sessionDir,
        summarizer: summarizerProvider,
        // ... other context (tailConfig, modelMaxContext, targetTokens, ...)
      });
      resetConsecutiveFailures(sessionDir);
      // Increment / reset periodic-rebuild counter inside the same lock
      // (handled inside runCompaction → see "Periodic-rebuild counter").
    } catch (err) {
      const consecutive = incrementConsecutiveFailures(sessionDir);
      logger.error('compaction failed; conversation continues uncompacted', {
        err, sessionDir, consecutive,
      });
      // Persist failure event via runExclusive to match the runner's existing
      // durable-write pattern at runner.ts:393-404. The failure write is NOT
      // protected by the compaction lock alone — runExclusive serializes ALL
      // event-log writes on the runner's deps, and the failure path must not
      // race with the runner's own writeAndAdvance. (B-C3.)
      await this.deps.runExclusive(() => {
        const state = readSessionState(sessionDir);
        const { nextState } = appendDurableEvent(sessionDir, state, {
          type: 'compaction_failed',
          data: {
            type: 'compaction_failed',
            reason: decision.reason,
            errorMessage: err instanceof Error ? err.message : String(err),
            consecutiveFailures: consecutive,
          },
        });
        writeSessionState(sessionDir, nextState);
      });
      maybeDisableForBackoff(sessionDir, consecutive, triggerConfig);
    }
  });
}
```

Key contract changes from v2:
- **No `ModelPinnedProvider` wrapper.** R6: `ModelPinnedProvider` doesn't isolate the system prompt at request time — `_createResponseImpl` forwards to `inner._invokeCreateResponseImpl`, and the base provider's `getEffectiveSystemPrompt` reads the inner's state when the inner builds its request payload. Wrapping the runner's live provider and calling `setSystemPrompt` on the wrapper would either no-op (system prompt comes from inner) or mutate inner (defeats the isolation goal). The proven pattern, lifted from `session-operations.ts:507-511`, is to create a fresh provider instance via `createProviderForTurn` and call `setSystemPrompt` on it directly. The runner's `this.provider` is a different instance and stays untouched.
- **`runExclusive` around the failure write** (B-C3). The runner's existing durable-write helper at `runner.ts:393-404` uses `await this.deps.runExclusive(() => { … })` to serialize event-log writes; the compaction failure path needs to match that contract. Without it, a `compaction_failed` write can race a runner-internal write and corrupt `state.json`.

Hook runs synchronously inside `runner.run()` so the runner's caller knows compaction completed before the next prompt is accepted. The cost: a brief pause after every Nth turn (in practice ~weekly under Ada-like load).

### CompactionContext refactor (R6)

`compaction/summarize-strategy.ts`'s `CompactionContext` takes a `providerFactory: () => Promise<Provider>` rather than a `summarizer: Provider` directly:

```ts
export type CompactionContext = {
  sessionDir: string;
  providerFactory: () => Promise<Provider>;     // builds a fresh, summarizer-pinned provider
  mode: 'rolling' | 'rebuild_from_canonical' | 'user_initiated';
  modelMaxContext: number;
  targetTokens: number;
  tailConfig: TailConfig;
};
```

Rationale: bounded-rebuild may need to make multiple summarizer calls (e.g. if a future hierarchical-rebuild lands), and each should get a fresh provider rather than reusing a possibly-stateful one. Callers pass a factory that does `createProviderForTurn(...) → setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT)` and returns the provider. v1 strategy calls the factory exactly once.

### Concurrency

A session-level mutex (`compaction/compaction-lock.ts`) serializes compaction within a session. Behaviors:

- **In-memory mutex.** Per-process; serializes re-entrant compactions within one lace process. Cheap.
- **File-based `flock`** on `<sessionDir>/.compaction.lock` (B-I14). Required because multiple lace processes can attach to the same session directory (e.g. a CLI inspector script running while the agent runs). Acquired before in-memory mutex; released after.
- **Re-entrant trigger.** If the trigger fires while a previous compaction is in flight (e.g. the prior turn's compaction is still running when a new turn ends), the second `withCompactionLock` call awaits the first. In practice this is rare because compaction is synchronous within `runner.run()` and the same runner handles both turns.
- **Subagent compaction.** Subagents have their own session directories and their own locks; they don't contend with the parent. (Most subagent sessions have `enabled: false` anyway — see §"Subagent sessions".)
- **`context_injected` priority='immediate' lands during compaction.** The injection write goes through `appendDurableEvent` independently of the lock and lands in the JSONL. The next post-compaction turn picks it up via `readImmediateInjectsSince`. No special handling; the existing PRI-1691 mechanism already covers mid-turn re-reads.
- **User abort RPC during compaction.** Compaction is opaque to the existing abort plumbing. The abort signal cancels the next turn's prompt, not the in-flight compaction. Compaction runs to completion (or fails), the `conversation_summary` (or `compaction_failed`) event is written, then the runner returns and the abort takes effect. This is the simplest behavior; if compaction-abort becomes important, file a follow-up kata.
- **Concurrent compaction from `/compact` slash or `ent/session/compact` RPC.** Same lock. The first caller wins; the second awaits and is a no-op if the first produced a fresh-enough capsule (operator can re-invoke if needed).

### Subagent sessions

Default: `TriggerConfig.enabled = false` for sessions created via the subagent / delegate path. Rationale:

- Subagent sessions are typically short-lived and finish well below the 60% global threshold.
- Subagent context is reconstructed every time the parent re-delegates; a compacted subagent prefix can confuse the parent's view of what the subagent "saw".
- Cost-wise, paying for a summarizer call on every subagent that hits 60% would multiply the per-session cost by every active subagent.

Top-level sessions default to `enabled: true`. Configurable per-session via existing session-config plumbing if a particular subagent does need compaction.

### Failure backoff

`compaction_failed` events accumulate a session-scoped `consecutiveFailures` counter. Behavior:

- **N=3 consecutive failures (default).** Skip the next trigger evaluation; record `fire: false, reason: 'backoff'`. Backoff window doubles each subsequent skip (1 turn, 2 turns, 4 turns, …) up to a cap of 16 turns.
- **M=10 consecutive failures (default).** Set `triggerConfig.enabled = false` for the session and emit an `alarm` (existing PRI-1744 alarm channel). Operator must explicitly re-enable.

A successful `conversation_summary` write resets the counter to 0.

## Tail policy

`compaction/tail-policy.ts`:

```ts
export type TailConfig = {
  recentTurns: number;            // default 10
  recentHumanPrompts: number;     // default 12  (see "Defaults rationale" below)
  recentHumanPromptsTokenBudgetPct: number; // default 0.10 (was 0.20 in v2 — see R5)
  humanChannelMatcher?: (event: TypedDurableEvent) => boolean;
};

export type TailSelection = {
  tailStartEventSeq: number;      // first event seq that stays verbatim
  preservedHumanPromptSeqs: number[];  // for telemetry / debugging
};

export function selectTail(
  events: TypedDurableEvent[],
  modelMaxContext: number,
  config: TailConfig,
): TailSelection;
```

Algorithm:

1. Walk events backward from end, counting closed turns by `turn_start` boundaries. Stop at the `turn_start` whose turn index is `recentTurns` turns ago from the most recent. Record this as `turnWindowStartSeq`.

2. Separately walk backward collecting up to `recentHumanPrompts` `prompt` events from a human channel. While walking, keep a running estimate of bytes-back-from-tail-end → tokens (`bytes / 3.5`). Stop **either** when `recentHumanPrompts` is hit **or** when projected tail-extension cost exceeds `recentHumanPromptsTokenBudgetPct * modelMaxContext`. With the v3 default of 0.10, the tail can never extend past ~10% of the model window.

3. The default `humanChannelMatcher` matches any `prompt` event whose first text-block content begins with one of `<messages channel="D"`, `<messages channel="C"`, `<messages channel="G"`, `<messages channel="im"` (Slack DM / channel / group / IM prefixes). Configurable per session. Filing follow-up kata to widen further as new ingress sources arrive (email, web UI, etc.).

4. If the oldest preserved human prompt has `eventSeq < turnWindowStartSeq`, extend the tail backward to `oldestHumanPromptSeq`. Tail boundary is `min(turnWindowStartSeq, oldestHumanPromptSeq)`.

5. **In-flight tool-use guard.** `tool_use` is **one event** that carries both `input` and `result` (`event-types.ts:28-35` — `ToolUseEventData` has both fields on a single event). The boundary risk is: if the proposed boundary falls on a `tool_use` event whose `result === undefined` (tool hasn't completed yet), the next turn will mutate the event in place to add the result. The summarizer would see "tool call with no result"; the rebuilt tail would later mutate to add it. Guard: if the proposed boundary falls on a `tool_use` event with `result === undefined`, walk left by one event so the in-flight tool-use sits inside the tail (the tail re-reads the live event, so when the tool completes the tail naturally picks up the resolved form). NOTE: this is not addressing message-builder orphan-tool-block issues; for those, see §"Message-builder behavior → dropOrphanedToolBlocks" (B-C7).

6. Return `tailStartEventSeq` (the smallest eventSeq that's in the tail) and the list of human prompt seqs that drove the policy.

The compactor sees: events with `eventSeq < tailStartEventSeq` → fed to summarizer. Events with `eventSeq >= tailStartEventSeq` → passed through verbatim to the message-builder.

### Defaults rationale

- `recentTurns: 10` — unchanged.
- `recentHumanPrompts: 12` — ~24 hours of conversation under Ada-like load.
- `recentHumanPromptsTokenBudgetPct: 0.10` — lowered from v2's 0.20 to match R5's tighter capsule-plus-tail budget. Combined with capsule budget (`targetCapsuleTokensPct: 0.10`), post-compaction state is ~20% of context, leaving 40% headroom below the 60% global trigger.

## Compaction algorithm

`compaction/summarize-strategy.ts` exports:

```ts
export type CompactionResult = {
  event: TypedDurableEvent;      // the new conversation_summary event
  metrics: {
    eventsCompacted: number;
    capsuleTokens: number;
    generationCostUsd: number;
  };
};

export async function compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactionResult>;
```

### trim-tool-results pre-pass (R3)

Before sending events to the summarizer, the strategy applies `TrimToolResultsStrategy` to a COPY of the events:

```
const summarizerInput = TrimToolResultsStrategy.compact(eventsBelowTail, ...);
// summarizerInput has shrunken tool_use.result fields; original events unchanged.
const capsule = await summarize(summarizerInput, ...);
```

Key invariants:
- **Pre-pass operates ONLY on the events feeding the summarizer.** The tail (events with `eventSeq >= tailStartEventSeq`) keeps its original, un-trimmed `tool_use.result` payloads. The message-builder renders the tail as-is on the next turn.
- **No event mutation.** The pre-pass returns a new list; the on-disk JSONL is unchanged.
- **`trim-tool-results-strategy.ts` stays a registered strategy.** The new summarize strategy invokes it via the registry interface (cleaner than a bare function import; preserves the harness's ability to measure trim-tool-results in isolation against fixtures). On the wire, however, the RPC enum no longer exposes it (see §"Strategy enum on the wire").

### Rolling mode

1. Find the latest existing `conversation_summary` event in `events` (the "previous capsule"). If none, behaves like rebuild.
2. Compute tail boundary via `selectTail(events, ctx.modelMaxContext, ctx.tailConfig)`.
3. Identify events between `previousSummary.recentTailStartsAtEventSeq` and `tailStartEventSeq` — the "delta" since last compaction.
4. **Empty/inverted delta guard (B-C8).** If `tailStartEventSeq <= previousSummary.recentTailStartsAtEventSeq` — i.e. the new tail extends back past or to the same point as the previous summary's tail boundary, so there is no new content to fold in — fall back to a mini-rebuild routed through the **bounded-rebuild path** (not a naive full rebuild). The mini-rebuild estimates `prefixTokens` for the segment `previousSummary.replacesEventSeqRange.fromInclusive` through `tailStartEventSeq - 1` and applies the same `summarizerBudget` check as §"Rebuild mode → bounded rebuild" before proceeding. This prevents the v2 empty-delta fallback from blowing past summarizer bounds on a long-running session whose tail drifts backward across compactions.
5. Run trim-tool-results pre-pass on the delta events.
6. Run summarizer (via `budget-retry.ts`) with prompt: `previousCapsule + trimmedDeltaEvents` → `newCapsule`.
7. Emit `conversation_summary` event with `generationMode: 'rolling'`. **`replacesEventSeqRange` is always cumulative from 1**: `{ fromInclusive: 1, toInclusive: tailStartEventSeq - 1 }`.
8. Increment `sessionState.compactionsSinceLastRebuild`.

### Rebuild mode

1. **Rebuild bounds check (R7).** Estimate `prefixTokens` (the sum of every non-summary event's content from session start to `tailStartEventSeq - 1`) via `estimateProviderTokens`. Compare against `summarizerBudget`, NOT against `ctx.modelMaxContext`:

   ```
   summarizerBudget
     = summarizerModelMaxContext
     − SUMMARIZER_OVERHEAD_TOKENS
   ```

   `summarizerModelMaxContext` is the model max of the summarizer model. **In v1 the summarizer model is the same model the main agent uses**, so `summarizerModelMaxContext === ctx.modelMaxContext`. The split exists so that future tier-different summarizers (Haiku-class summarizer for Opus-class agent) keep the check correct.

   `SUMMARIZER_OVERHEAD_TOKENS` reserves room for the summarizer's system prompt, the structured-output schema (zod → JSON schema is ~1–2K tokens at full surface), and the completion itself (the emitted capsule, target ~10% of model max). Pick **20,000 tokens** as the reserved overhead: rough breakdown is ~2K system + ~2K schema + 10K target output + 6K slack. This is a single named constant in `summarize-strategy.ts`; tunable in a follow-up after measurement.

   If `prefixTokens > summarizerBudget` → fall through to "bounded rebuild" below. Otherwise straight rebuild.

2. **Straight rebuild.** Read entire canonical event log up to `tailStartEventSeq`, skipping prior `conversation_summary` events but keeping the original prompts/messages they replaced. Compute tail via `selectTail`. Run trim-tool-results pre-pass. Run summarizer with prompt: all non-summary trimmed events → `freshCapsule`. Emit `conversation_summary` with `generationMode: 'rebuild_from_canonical'`, `replacesEventSeqRange: { fromInclusive: 1, toInclusive: tailStartEventSeq - 1 }`. Reset `sessionState.compactionsSinceLastRebuild = 0`.

3. **Bounded rebuild.** When the canonical event prefix exceeds the summarizer's bounds:
   1. Find the latest `conversation_summary` event ("the anchor capsule").
   2. Read canonical events from `anchor.replacesEventSeqRange.toInclusive + 1` through `tailStartEventSeq - 1` (the post-anchor delta only).
   3. Run trim-tool-results pre-pass on the delta.
   4. Run summarizer with prompt: `anchorCapsule + trimmedDeltaEvents` → `freshCapsule`. (Structurally identical to rolling-mode but reads the underlying canonical events for the delta rather than the post-trim path.)
   5. Emit `conversation_summary` with `generationMode: 'rebuild_from_canonical'`, `purpose: 'bounded_rebuild'`, cumulative range. Reset `sessionState.compactionsSinceLastRebuild = 0`.
   6. If there is NO prior `conversation_summary` event AND the canonical event prefix exceeds summarizer bounds: emit `compaction_failed` with `errorMessage` describing the situation and the operator must intervene (truncation, or manually split the session). File follow-up kata: "hierarchical-from-scratch rebuild for orphan oversized sessions" — not built in v1 because the situation is rare and operator-fixable.

In all rebuild paths the new event is appended via the same `appendDurableEvent` path lace uses today. After it lands, the message-builder picks it up on the next turn.

### Model

Same provider+model as the main agent's conversation. Per the research report: "global compact: same tier as main model." Different tiers can be evaluated in follow-up work; v1 uses the main model. Cost is recorded in `generationCostUsd` (using PRI-1817's pricing).

### targetTokens default

Defaults to `floor(modelMaxContext * targetCapsuleTokensPct)` — see R5. For 1M-context Sonnet, targetTokens defaults to **100K** (vs. ~200K in v2). The capsule itself is expected to be a small fraction of that bound in practice; the budget is a ceiling for the renderer.

## Budget enforcement

`compaction/budget-retry.ts`:

```ts
export async function summarizeWithBudget(args: {
  summarizer: Provider;
  prompt: string;
  schema: typeof CapsuleSchema;
  targetTokens: number;
  renderForMeasurement: (capsule: Capsule) => string;  // see step 2
  maxRetries?: number;          // default 2
}): Promise<{ capsule: Capsule; budgetOverrunBy: number; retries: number }>;
```

1. Call summarizer with normal prompt. Parse + validate result against `CapsuleSchema`.
2. **Token measurement.** Compute approximate token size of what the **agent will actually see**, not the JSON storage form:
   `approxTokens = renderForMeasurement(capsule).length / 3.5`
   Callers pass `renderCapsuleAsMarkdown` as `renderForMeasurement`. The 3.5 chars/token ratio is calibrated for Anthropic markdown.
3. If `tokens <= targetTokens` → return `{capsule, budgetOverrunBy: 0, retries: 0}`.
4. Else: re-call with prefix `"Your prior output was X tokens; the target is Y. Compress further. Do not drop must-preserve fields: commitments, user corrections, do_not_infer, exact_language_to_preserve."`. Up to `maxRetries` re-runs.
5. After max retries: accept the smallest version produced across all retries. Return with `budgetOverrunBy > 0` so the event's metadata can record it.

The must-preserve fields list is hard-coded; if a future bug shows the model dropping them under pressure, add a critic pass (deferred kata).

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

1. **Render `conversation_summary` as the conversation prefix.** When the builder encounters a `conversation_summary` event:
   - Reset `messages.length = 0` (same as today's `context_compacted` path).
   - Render the capsule via `renderCapsuleAsMarkdown(event.data.capsule)`.
   - Push **one** message of shape `{ role: 'user', content: renderedMarkdown }` as the first message in the rebuilt array. The agent reads this as user-provided framing context.
   - **Only the LATEST `conversation_summary` event is rendered.** Earlier ones are skipped. Because `replacesEventSeqRange` is always cumulative from 1, the latest summary fully covers everything before its `recentTailStartsAtEventSeq`; rendering earlier summaries would duplicate content.
   - All canonical events with `eventSeq < latestSummary.recentTailStartsAtEventSeq` are skipped (they're represented inside the capsule).
   - All events with `eventSeq >= latestSummary.recentTailStartsAtEventSeq` are processed normally.

2. **Skip `compaction_failed` events.** They're telemetry; they don't affect prefix rendering. Explicitly skip (don't fall through to "unknown type").

3. **Reject unknown event types loudly.** Any event whose `type` is not in the known allowlist throws. Allowlist (B-I4 — enumerated explicitly, anything not on this list throws on the next turn so we cannot silently drop new event types we forgot to teach the builder about):

   ```
   prompt, message, tool_use, turn_start, turn_end, context_injected,
   system_prompt_set, job_started, job_finished, job_update, job_session_assigned,
   permission_requested, permission_decided, permission_cancelled,
   checkpoint_created, files_rewound,
   conversation_summary,          // NEW — rendered as prefix
   compaction_failed              // NEW — skipped (no-op)
   ```

   The current builder uses an open-switch with implicit fall-through ignoring unknown types; v3 closes that to an explicit allowlist plus a throw. The explicit no-op set above MUST be the same list as the current implicit-no-op set (turn_start, turn_end, job_*, permission_*, checkpoint_created, files_rewound, system_prompt_set after pass-1) so the behavior change is purely "newly unknown types now throw rather than silently doing nothing."

   `context_compacted` is **not** on this list. After the Ada cutover, no live session has `context_compacted` on disk; any sub-session that somehow does fails loudly with a pointer at the cutover playbook.

4. **Always run `dropOrphanedToolBlocks` against the rebuilt messages (B-C7).** Currently the function is called only inside the `context_compacted` branch (`message-builder.ts:319`). Move the call out of that branch and run it ONCE at the end of pass-2 (after all events have been folded into `messages`), regardless of whether a `conversation_summary` event was present. Rationale: PRI-1818's crash-recovery path writes a synthesized `turn_end(stopReason='process_died')` after a SIGKILL/OOM; if the process died mid-tool-call, the `tool_use` event was already written with `result === undefined`, and the runner's repair path may produce a message stream where an `assistant.toolCalls[]` block has no matching `user.toolResults[]` follower. PRI-1820's `dropOrphanedToolBlocks` exists to defuse exactly this case (`message-builder.ts:152-189` was added specifically because Ada hit a tool_use without its result and every subsequent Anthropic call 400'd on the same toolu id). With v3's removal of `context_compacted`, that defense currently has no caller. Running it unconditionally as a post-pass costs one O(n) scan of messages and protects against the crash-recovery orphan source.

   The pass remains a defensive bottom-pass — if the rebuilt prefix is clean it's a no-op. Logging still emits a WARN on every dropped block so we can spot regressions that produce orphans in the first place.

## Recall (FTS) integration (R1)

`storage/recall/event-to-row.ts` currently has a `case 'context_compacted':` (line 80) that returns a `system`-kind row whose content is the summary text. **Both events change behavior in v3:**

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

## Cutover: one-time clear of Ada (R2)

v2 specified a per-session migration tool that read every `context_compacted` event, summarized them through a fresh model call, and rewrote each transcript JSONL in place with a single new `conversation_summary` event. That section is **DELETED in v3**.

Instead: Ada is the only live agent with `context_compacted` events on disk. We zero her transcript at cutover.

### Procedure

1. **Stop Ada's container** so no further events get written.
2. **Snapshot her LACE_DIR** to a timestamped backup (`<laceDir>.pre-cutover-<ISO>`). This is the rollback artifact.
3. **Find every events.jsonl under her LACE_DIR.** For each:
   - Replace with empty file (`truncate -s 0`), OR delete and let lace recreate on startup — whichever matches the runtime's existing "missing transcript" behavior. Inspect `transcript-paths.ts` and `event-log.ts` before picking.
4. **Drop her FTS rows.** `DELETE FROM events WHERE session_id LIKE '<ada-session-prefix>%'` against the SQLite recall index. Faster than per-session repair; she has one active session.
5. **Leave her persona, system_prompt_set state, configuration, and any non-event durable artifacts in place.** The cutover wipes conversation history, not identity.
6. **Restart her container on the new lace build** (which has the typed-capsule strategy + the `context_compacted` removal from the union).
7. **Verify she boots cleanly.** No `context_compacted` events on disk → no message-builder loud-throw. Her conversation starts at turn zero.
8. **Post-cutover smoke:** ping her in `#bot-debugging` (Ada Slack channel reference); confirm she responds normally; confirm the first compaction fires at ~60% of context after enough conversation accumulates.

### Cost

**Zero summarizer cost** at cutover. No model calls. (v2's migration was ~$8–10 for Ada because it ran a fresh-prefix summarizer over her 1M-token canonical history; v3 simply discards that history.)

### What Ada loses

Her existing conversation context: pending commitments, ongoing tasks, prior corrections, the chronology of her week. She wakes up not remembering any of it.

The trade-off vs migration:
- **Migration cost (v2 plan):** ~$10, plus the integration risk of a tool that rewrites her JSONL in place (file-system race, eventSeq preservation, FTS staleness, summarizer hallucination on a 1M-token prefix).
- **Clear cost (v3 plan):** ~$0, but Ada starts fresh.

The cutover is intentional reset, not data loss in the catastrophic sense — Jesse (the operator) chose to take the hit rather than pay the migration risk for a single session. Future agents post-cutover never have `context_compacted` events on disk and never need either path.

### Future agents

Agents created on the new lace build never see `context_compacted`. When their context grows, the trigger fires and they accumulate `conversation_summary` events instead. No migration is ever required again.

### Other sessions

If any non-Ada session somehow has `context_compacted` events on disk (e.g. a stale fixture, a forgotten dev sandbox), the same clear procedure applies. The cutover playbook documents it as "zero out events.jsonl, drop FTS rows, restart."

## Build / repo plumbing

The `sen2/compaction/` repo declares `@lace/agent` as a `file:../lace/packages/agent` workspace dependency (see `compaction/package.json:18`). This means:

- The lace package must be built before the compaction repo can `tsx` against it. `compaction`'s test/harness scripts assume `cd ../lace && npm run build` has been run.
- Type-import edits in lace propagate to compaction via the `file:` link without a re-install.

(v2 also documented the migration script's reliance on this; in v3 there is no migration script, but the harness path still depends on the workspace link for fixtures + strategy module imports.)

## Testing

Full unit-test coverage for every module in the new strategy. Integration testing is the harness-against-Ada-fixture pattern (where "Ada fixture" is the v2 snapshot of her transcript saved to `sen2/compaction/fixtures/ada-main/`, NOT live Ada post-cutover).

### Unit tests

- **`capsule-types.test.ts`**: schema accepts the report's example payload; rejects every malformed shape we can think of (missing required field, wrong type per branch, unknown field if strict mode is on); every sub-schema gets its own test.
- **`capsule-markdown.test.ts`**: rendering of each of the 13 sections; edge cases (empty arrays don't emit headers; all-optional-fields-absent renders correctly; multi-paragraph snippets preserve formatting; sections with special chars are escaped); quote blocks emit with attribution; uncertain items get `(uncertain)` marker.
- **`tail-policy.test.ts`**: every branch — short session (all events in tail), normal turn-cut, human-prompt extends tail backward, in-flight `tool_use` (result undefined) at boundary, no human prompts in session, empty session, session with only one turn, channel matcher with custom regex, **token-budget cap fires before recentHumanPrompts is hit at the v3 0.10 default**.
- **`budget-retry.test.ts`**: in-budget first try; over-budget then in-budget on first retry; all retries over-budget accepts smallest; the must-preserve fields preserved in the smallest-accepted output (synthetic summarizer that returns a known capsule); **measurement uses rendered markdown, not JSON bytes**.
- **`compaction-trigger.test.ts`**: every threshold combination at v3 defaults (under 60% → no fire; between 60% and 90% → global; over 90% → emergency); **the `?? 0` cache-field defaults: Anthropic-with-cache-fields case (full sum), Anthropic-without-cache-fields case (input only), non-Anthropic case (input only)**; mode pick (first 9 compactions rolling, 10th rebuild, then back to rolling — counter sourced from `sessionState.compactionsSinceLastRebuild`); **stop-reason whitelist: `end_turn`/`stop_sequence`/`max_turns` fire; `tool_use`/`refusal`/`cancelled`/`failed`/`process_died`/`prompt_handler_caught`/`context_window_exceeded`/`max_output_tokens` do NOT fire**; **gating: `lastCallInputContextTokens` missing → no fire + log**; **gating: `enabled === false` → no fire**.
- **`summarizer-prompt.test.ts`**: prompt construction for rolling (includes previous capsule) and rebuild (does not); correct field ordering; instruction text matches spec.
- **`summarize-strategy.test.ts`**: rolling mode emits new event with **cumulative** `replacesEventSeqRange`; **trim-tool-results pre-pass is applied to events fed to summarizer**; **tail events are NOT trimmed**; **empty-delta fallback routes through bounded-rebuild check, not a naive full rebuild (B-C8)**; rebuild mode ignores prior summaries; **bounded-rebuild path when prefix exceeds `summarizerBudget = summarizerModelMaxContext − 20K`**; error path emits `compaction_failed` via `runExclusive` and rethrows; cost fields populated; **`CompactionContext.providerFactory` is invoked to create the summarizer provider (no `ModelPinnedProvider` reference)**; **`sessionState.compactionsSinceLastRebuild` increments on rolling, resets on rebuild**.
- **`message-builder.test.ts`**: session with one `conversation_summary` event rebuilds messages with the rendered markdown as a single role:user prefix; **session with two summaries reads only the latest, drops earlier ones**; session with zero summaries falls through to current pre-summary behavior; **session with `compaction_failed` events: events skipped, prefix unaffected**; **session with unknown event type: throws loudly**; **`dropOrphanedToolBlocks` runs as a post-pass even when no `conversation_summary` event is present (synthetic crash-recovery fixture: turn_end(process_died) + orphan tool_use)**.
- **`event-to-row.test.ts`**: **`conversation_summary` event returns null (not indexed)**; **`compaction_failed` event returns null (not indexed)**; **no `context_compacted` case remains**.
- **`compaction-lock.test.ts`**: re-entrant in-process call awaits prior; **two simulated processes contending via flock on `.compaction.lock` — second blocks until first releases**; cross-session calls don't contend; lock released on error.
- **`backoff.test.ts`**: 3 consecutive failures → backoff window doubles; 10 consecutive → session disabled + alarm emitted; successful summary resets counter.

All unit tests use pure synthetic data — no LLM call. No mocking the API; pure-function logic only.

### Integration / E2E: the harness against Ada-fixture

The `sen2/compaction/` harness is the e2e bed (runs against the saved Ada-fixture, not live Ada):

1. Register the new strategy as a `compaction` repo strategy module (alongside `noop`). Strategy module wraps `runCompaction` from lace, importing through the `@lace/agent` workspace dep.
2. `compaction harness new-summarize fixtures/ada-main --out scratch/runs/<date>` runs the real strategy against the saved 2,036-event session snapshot with a real Anthropic API summarizer call.
3. Outputs: `events.jsonl` (post-compaction event sequence), `metrics.json` (size reduction, generation cost, retry count, budget overrun, capsule shape stats), `after.html` (rendered conversation prefix from the message-builder).
4. Acceptance criteria (manual, iterative — driven by reading the harness output):
   - `events.jsonl` contains a `conversation_summary` event with valid capsule per zod schema.
   - `replacesEventSeqRange.fromInclusive === 1` (cumulative range contract).
   - Token reduction > 50% on the pre-compaction window.
   - `after.html` renders a readable conversation prefix that preserves the fixture's known commitments, corrections, and recent human comms.
   - Generation cost < $15 per run.
5. Iterate on the summarizer prompt, capsule schema completeness, tail policy thresholds by re-running and diffing scratch/runs/ outputs over time.

Harness runs are on-demand (not in CI) — they cost real Anthropic dollars. CI runs only the unit tests. Per Jesse's CLAUDE.md: "we always use real data and real APIs" — the harness IS the real-API path.

## Open questions

Not blocking. Capture as follow-ups during implementation:

- What's a sensible default `humanChannelMatcher` for non-Slack ingress? Today we have Slack DMs + channels. Email, web UI, etc. would need different matchers.
- Should the capsule include a version of itself in the prompt to the summarizer, or only natural-language framing? (Prompt design decision; A/B in the harness.)
- The summarizer's `do not drop must-preserve fields` retry instruction: does it work in practice? If not, the critic pass from research Phase 2 becomes necessary.
- Periodic-rebuild interval (`rebuildEveryNCompactions: 10`): tune from real data once we have multiple weeks of post-deploy sessions.
- Compaction-abort: should an in-flight compaction be cancellable via the abort RPC? Today's behavior is "runs to completion then abort takes effect."
- `SUMMARIZER_OVERHEAD_TOKENS = 20_000`: pure estimate; revisit after the harness gives us real numbers on system + schema + completion costs.

## Implementation order (informs the plan, not the spec)

0. **Precondition kata: `usage.lastCallInputContextTokens` on `turn_end`.** Tiny lace PR. File as PRI-XXXX. Must land + ship before any code below.
1. Module scaffolding + `capsule-types.ts` (no behavior; just the schema; includes `schemaVersion: 1` as number)
2. `capsule-markdown.ts` (pure function on Capsule; testable in isolation)
3. `tail-policy.ts` (pure function on events + modelMaxContext; testable in isolation)
4. `summarizer-prompt.ts` (pure function on events + previous capsule; testable in isolation)
5. `budget-retry.ts` (wraps a Provider — testable with a synthetic Provider stub for pure-function unit tests; uses renderForMeasurement for size)
6. `compaction-lock.ts` (session-level mutex; in-memory + flock; pure-function testable with a fake filesystem)
7. `summarize-strategy.ts` (composes the above; pure-function unit tests with synthetic Provider; rolling + rebuild + bounded-rebuild paths; trim-tool-results pre-pass; `providerFactory` interface)
8. `compaction-trigger.ts` (pure function on turn_end event + session events; tests cover all gating including stop-reason whitelist and `?? 0` cache-field defaults; reads `compactionsSinceLastRebuild` from sessionState)
9. `event-types.ts` (add new types, remove `context_compacted`, add `compactionsSinceLastRebuild?: number` to SessionState) + `message-builder.ts` modifications (allowlist + always-run `dropOrphanedToolBlocks`) + tests
10. `event-to-row.ts` modifications (REMOVE `context_compacted` case; `conversation_summary` + `compaction_failed` fall through to null — NOT indexed) + tests
11. Update `/compact` slash command (`conversation/slash-commands.ts`) + `ent/session/compact` RPC handler (`rpc/handlers/session-operations.ts`) to emit `conversation_summary` via the new strategy. Remove the `strategy` wire-enum values `'trim-tool-results'` and `'selective'` from the RPC params type.
12. Runner integration in `runner.ts` (the trigger hook, the `createProviderForTurn` pattern, the `runExclusive`-wrapped failure write, the backoff counter)
13. Sen-core companion PR: **delete** `sen-core-v2/src/turn-hooks/compaction-trigger.ts` and its wiring. This ships in lockstep with the lace trigger landing; sen-core no longer drives compaction.
14. Register new strategy in `sen2/compaction/` harness as a strategy module
15. First harness run against Ada-fixture; iterate on prompt/schema/thresholds based on output
16. **Cutover playbook** (replaces v2's migration script): document the stop / snapshot / truncate-events / drop-FTS / restart sequence. Write the script as a small shell helper under `sen2/compaction/scripts/cutover-clear.sh` so the exact commands are version-controlled and rerunnable on any future agent that ends up with `context_compacted` on disk.
17. Execute the cutover against Ada on the new lace build.

### Lockstep PRs

| Repo | PR contents |
|---|---|
| lace | precondition kata: `usage.lastCallInputContextTokens` |
| lace | typed-capsule strategy + trigger + message-builder + recall + slash-command + RPC handler + `SessionState.compactionsSinceLastRebuild` all in one PR |
| sen-core-v2 | delete `turn-hooks/compaction-trigger.ts` and its wiring |
| compaction | harness strategy module + cutover-clear.sh playbook |

The lace PR and the sen-core-v2 PR must merge in the same Ada deploy. The compaction-repo PR can land independently any time after the lace PR.

---

## v2 changelog (mapping to round-1 reviewer findings)

Listed in finding-number order. "Addressed" entries describe the change in v2; "verified-still-true" entries note where I confirmed the finding against current source. Some v2 resolutions are superseded by v3 reframes — see the v3 changelog for those.

### Critical findings (round 1)

1. **`context_compacted` writers** — Addressed by §"Writers that produce conversation_summary". `/compact`, `ent/session/compact`, and `event-to-row.ts` updated in lockstep.
2. **Migration range contract** — Addressed in v2 by the cumulative-range contract on every `conversation_summary`. v3: section retained as the runtime contract (the migration sub-clause is deleted because there's no migration).
3. **`fullContextTokens` formula** — Addressed by §"Preconditions §3" and §"Trigger signal". Per-call sum problem solved by adding `lastCallInputContextTokens` field on `turn_end`.
4. **Rebuild bounded** — Addressed by §"Rebuild mode". v3 sharpens the budget check (see R7).
5. **ModelPinnedProvider** — v2 used the wrapper. **Superseded in v3 by R6** — switched to `createProviderForTurn` pattern.
6. **`appendDurableEvent` vs eventSeq preservation** — v2 documented direct JSONL writes for migration. **No longer relevant in v3** (no migration); however, the discovery that `appendDurableEvent` derives its own `eventSeq` (verified `event-log.ts:434`) is preserved as context for future migration-style work.
7. **Recall FTS stale + new events un-indexed** — v2 addressed by per-session FTS cleanup. **Superseded in v3 by R1** — summaries are not indexed at all, removing the cleanup requirement.
8. **`compaction_failed` builder behavior** — Addressed by §"Message-builder behavior §2". v3 makes the allowlist explicit and exhaustive (B-I4).
9. **Trigger fires NaN on pre-PRI-1817 events** — v2 made PRI-1817 a hard precondition. **Superseded in v3 by R4** — `?? 0` defaults make the formula correct across providers without refusing pre-PRI-1817 sessions.

### Important findings (round 1)

10. **Stop-reason gating** — Addressed by §"Trigger evaluator" gating rule §2. v3 broadens the whitelist to `['end_turn', 'stop_sequence', 'max_turns']` (B-C4).
11. **`appendDurableEvent` signature** — Addressed by the code example in §"Lifecycle hook".
12. **Re-entrant compaction** — Addressed by §"Concurrency". v3 adds the file-based flock requirement (B-I14).
13. **Subagent sessions** — Addressed by §"Subagent sessions".
14. **Sen-core's existing trigger** — Addressed by §"Implementation order §13" and §"Lockstep PRs".
15. **Budget heuristic measures wrong thing** — Addressed by §"Budget enforcement §2".
16. **Migration tail-start math** — v2 addressed via single-capsule-per-session. **No longer relevant in v3** (no migration).
17. **Tool-use/tool-result walk-left mental model** — Addressed by §"Tail policy §5". v3 further clarifies the boundary between this guard (in-flight tool not yet completed) and `dropOrphanedToolBlocks` (crash-recovery orphans).
18. **`errorMessage` vs `error` field-name** — Addressed by §"New durable event types". Field is consistently `errorMessage` everywhere. (A-I20 reaffirms.)
19. **`recentHumanPrompts: 100` blows past 1M context** — Addressed by §"Tail policy §2" + §"Defaults rationale". v3 further tightens the token budget cap to 0.10 (R5).
20. **Rolling-mode delta empty/inverted** — Addressed by §"Rolling mode §4". v3 routes the fallback through bounded-rebuild (B-C8).
21. **Capsule schema drops envelope fields** — Addressed by §"New durable event types" (envelope fields on the wrapping event, capsule stays pure content). v3 narrows `criticStatus` to a single-valued enum (A-I22) and switches `schemaVersion` to numeric (A-I21).
22. **No backoff after repeated failures** — Addressed by §"Failure backoff".
23. **Message-builder reset semantics** — Addressed by §"Message-builder behavior §1".
24. **Per-day-per-persona transcript layout** — v2 addressed via `<laceDir>` invocation in migration. **No longer relevant in v3** (no migration tool).
25. **`modelMaxContext` undefined → trigger always fires** — v2 added a null gate. **Superseded in v3 by B-C6** — the lookup never returns null; the null gate was dead code; removed.
26. **Cross-repo workspace dep** — Addressed by §"Build / repo plumbing".
27. **Migration cost estimate off** — **No longer relevant in v3** (no migration; cutover cost is $0).
28. **`humanChannelMatcher` default silently drops new channels** — Addressed by §"Tail policy §3".

---

## v3 changelog (round-2 findings + reframes)

### Reframes (Jesse's architectural changes)

- **R1 — Summaries are NOT recall-indexed.** §"Recall (FTS) integration" rewritten: `event-to-row.ts` returns null for both `conversation_summary` and `compaction_failed`. Removes the entire FTS-row-size / FTS-cleanup concern. Removes the `--rebuild-fts` flag (no script exists to need it).
- **R2 — One-time clear of Ada, not migration.** §"Migration" → §"Cutover: one-time clear of Ada". Deleted: `migrate-old-compactions.ts`, `--dry-run`, `.pre-migration-<ISO>` backups, FTS cleanup, daily-transcript iteration, the `'migration'` `generationMode` value, the cost-of-migration sub-section, the "Other sessions" migration recipe. Replaced with: stop → snapshot → truncate `events.jsonl` → DROP FTS rows → restart on new build. Zero summarizer calls.
- **R3 — `trim-tool-results` becomes a pre-pass.** §"Compaction algorithm → trim-tool-results pre-pass". Wire enum on RPC collapsed to `'summarize'` only; `'trim-tool-results'` and `'selective'` removed from the user-facing surface. `trim-tool-results-strategy.ts` stays registered so the new strategy can invoke it internally and the harness can still measure it in isolation. Spec specifies: pre-pass runs against events fed to the summarizer; tail events keep their original (un-trimmed) `tool_use.result`.
- **R4 — `?? 0` defaults make it 100% provider-compat.** §"Preconditions §1" rewritten: PRI-1817 is precondition for Anthropic accuracy but lace starts on any session. §"Trigger signal" rewritten with the per-provider table. The `?? 0` is forward-compat across providers (not legacy back-compat per CLAUDE.md), so it's allowed.
- **R5 — Trigger rebalance for real headroom.** §"Trigger evaluator" + §"Defaults rationale" updated: `globalThresholdPct: 0.60`, `emergencyThresholdPct: 0.90`, `targetCapsuleTokensPct: 0.10`, `recentHumanPromptsTokenBudgetPct: 0.10`. Arithmetic table shows 40% headroom between compactions; ~6–10 turns of growth under Ada-like load.
- **R6 — `createProviderForTurn` pattern, not `ModelPinnedProvider`.** §"Lifecycle hook" rewritten. Verified pattern at `session-operations.ts:507-511`. `CompactionContext` refactored to take a `providerFactory: () => Promise<Provider>`. The runner's `this.provider` is provably untouched because the summarizer uses a wholly different instance.
- **R7 — Bounded-rebuild uses summarizer's own budget.** §"Rebuild mode → Rebuild bounds check" updated. Compares against `summarizerBudget = summarizerModelMaxContext − SUMMARIZER_OVERHEAD_TOKENS` (20K reserve documented). For v1 (summarizer = main model) the formula reduces to the v2 check; for future tier-different summarizers it stays correct.

### Round-2 critical findings

- **B-C3 — `runExclusive` around the failure write.** §"Lifecycle hook" code example wraps the `compaction_failed` `appendDurableEvent` call in `await this.deps.runExclusive(() => { … })`. Mirrors the runner's existing pattern at `runner.ts:393-404` (verified).
- **B-C4 — Stop-reason whitelist.** §"Trigger evaluator" gating rule §2 expanded to `['end_turn', 'stop_sequence', 'max_turns']` with per-reason justification. PRI-1818's `process_died` (`event-types.ts:92`) and `prompt_handler_caught` (`event-types.ts:101`) explicitly excluded. `tool_use` excluded (mid-turn). Error/abort reasons excluded.
- **B-C6 — Dead `modelMaxContext === null` gating rule.** Verified at `base-provider.ts:481-488`: `getModelContextWindow` always returns a number with a 200K fallback. §"Trigger evaluator" gating rule §4 rewritten: `modelMaxContext` is `number`, not `number | null`; the null gate is removed.
- **B-C7 — `dropOrphanedToolBlocks` runs unconditionally.** §"Message-builder behavior §4" added. Moves the call out of the (removed) `context_compacted` branch and runs it as a post-pass over the final `messages` array. Defuses the crash-recovery orphan case (PRI-1818 #3 / PRI-1820). Verified `dropOrphanedToolBlocks` exists at `message-builder.ts:114-189` and currently only fires inside the `context_compacted` case.
- **B-C8 — Empty-delta fallback goes through bounded-rebuild.** §"Rolling mode §4" rewritten. The empty/inverted-delta fallback now applies the same `summarizerBudget` check as the rebuild path before re-summarizing the segment.

### Round-2 important findings

- **B-I3 / A-I8 — Sen-core's existing trigger removal.** Still in §"Implementation order §13" and §"Lockstep PRs". Confirmed present.
- **B-I4 — Explicit allowlist of event types in message-builder.** §"Message-builder behavior §3" enumerates the allowlist exhaustively. The list matches the current implicit-no-op set plus the two new types.
- **B-I9 — Migration timestamp / eventSeq ordering.** **Dropped from v3** — no migration; ordering concern doesn't apply.
- **B-I12 — `rebuildEveryNCompactions` counter location.** §"Periodic-rebuild counter" specifies `SessionState.compactionsSinceLastRebuild?: number`. Increment on rolling, reset on rebuild, unchanged on failure. Persists across process restarts via `state.json`.
- **B-I14 — Multi-process compaction lock.** §"Concurrency" adds file-based `flock` on `<sessionDir>/.compaction.lock` in addition to the in-memory mutex.
- **B-I15 / B-I16 — Migration-related deletes.** Both **dropped from v3** — no migration.
- **A-I20 — `errorMessage` vs `error` field name.** §"New durable event types": `errorMessage` is the single canonical field name on `CompactionFailedEventData`.
- **A-I21 — `schemaVersion` numeric vs string literal.** §"New durable event types": `schemaVersion: 1` (`number`), not `'1'` (`string`). Cleaner for future versioning + zod numeric branches.
- **A-I22 — `criticStatus` enum.** §"New durable event types": `criticStatus: 'unchecked'` (single-valued enum) in v1. Note added explaining the union will widen when the critic ships.

### Findings disproved on re-verification

- **A-C4 (v2 critical: refuse-to-start on pre-PRI-1817 sessions).** v2 prescribed refusing startup. Re-verified against `runner.ts:598-608` and `event-types.ts:62-81`: the per-provider analysis (R4 table) shows `?? 0` defaults produce correct arithmetic for non-Anthropic and acceptably-degraded arithmetic for pre-PRI-1817 Anthropic. The refuse-to-start was over-strict; lace can start on any session. (Disproved by: provider-by-provider arithmetic walk-through.)
- **A-C6 (v2 critical: FTS-row-size blowup for capsule contents).** v2 worried that capsule markdown (~10K tokens) would inflate FTS rows. Re-verified: with R1, the summary is never written to FTS. The concern evaporates. (Disproved by: R1's "summaries not indexed" decision.)
- **B-C6 stricter reading: `modelMaxContext === null` gating rule.** v2 spec had a "if null then skip" gate. Re-verified `base-provider.ts:481-488`: function always returns a number. The gate was dead code. Removed in v3. (Disproved by: direct source read.)
- **B-C7 stricter reading: "tool-use boundary guard solves a problem lace doesn't have."** v2's tail-policy guard treated `tool_use` as if it might be split across events. Re-verified `event-types.ts:28-35`: `ToolUseEventData` is one event with both `input` and optional `result`. The in-flight guard from v2 step 5 is still correct (it handles the unresolved-result case), but the **actual** orphan-tool-block source is crash-recovery, not boundary placement. v3 keeps the in-flight guard AND moves `dropOrphanedToolBlocks` to an unconditional post-pass to handle the real source. (Disproved by: re-reading `event-types.ts` plus understanding PRI-1818's repair path.)

### Findings I did not fully resolve and am surfacing to Jesse

- **Subagent default (still #13).** Defaulting subagent compaction OFF means a long-running subagent will eventually hit context window and die. v3 keeps the v2 trade-off; revisit if a long-running subagent actually OOMs in production.
- **`SUMMARIZER_OVERHEAD_TOKENS = 20,000` is a rough estimate.** Not calibrated against real measurements. Flagged as an open question; should be tuned after the first few harness runs give us real numbers on system + schema + completion size.
- **`compactionsSinceLastRebuild` and PRI-1819 cache-position persistence.** Both extend `SessionState`. There's a non-zero chance the PRI-1821 follow-up reshapes `SessionState` further. If both land near each other, the two PRs need to be cross-referenced so the field additions don't conflict. (Not blocking, but worth noting before either implementation starts.)
- **`trim-tool-results-strategy.ts` registration.** v3 keeps it in the registry so the new strategy can invoke it internally and so the harness can still measure it in isolation. But removing it from the wire-enum while leaving it in the registry is mildly asymmetric — someone reading the registry can still call it via `compactionStrategiesById.get('trim-tool-results').compact(...)` from non-RPC code paths. That's intentional (the new summarize strategy does exactly this), but worth flagging so a future cleanup pass doesn't reflexively delete the registry entry. Alternative: make `trim-tool-results-strategy.ts` a plain non-exported helper inside `summarize-strategy.ts` and stop registering it. **I picked "stays registered" because the harness still needs it as a comparable strategy; happy to flip to non-exported if you'd rather minimize the registry surface.**
