# Stop Reason Harmonization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify stop-reason handling across all five AI provider implementations behind a single canonical `LaceStopReason` enum and `LaceStopDetails` discriminated union, surface signals we currently drop (Anthropic `pause_turn`, refusals on both providers, OpenAI Responses `incomplete_details` and `failed.error`, `model_context_window_exceeded`), make the runner's behavior per-stop-reason explicit, and persist the structured details on `turn_end` events.

**Architecture:** Single source of truth in `packages/agent/src/providers/stop-reason.ts` — pure normalizer functions per provider that produce `{stopReason, stopDetails}` tuples. Provider classes delegate to these; their existing `normalizeStopReason` overrides disappear. Runner.ts gains explicit per-reason dispatch. Refusal/context-exceeded surface partial content but don't execute pending tool calls. Anthropic `pause_turn` triggers transparent auto-resume with a safety counter. HTTP-400 "prompt too long" errors get wrapped into `'context_window_exceeded'` stop reasons before throwing. OpenAI Responses refusal items get captured mid-stream.

**Tech Stack:** TypeScript (strict mode), Zod schemas where applicable, Vitest, existing provider classes in `packages/agent/src/providers/`, the runner at `packages/agent/src/core/conversation/runner.ts`.

**Companion spec:** [2026-05-24-stop-reason-harmonization.md](./2026-05-24-stop-reason-harmonization.md). All design decisions live there; this plan only sequences the implementation.

---

## 1. Summary

Today each provider implements its own `normalizeStopReason()` mapping raw API values to a free-form string. Anthropic collapses `pause_turn` and `refusal` to `'stop'`. OpenAI Chat collapses `content_filter` to `'stop'`. OpenAI Responses collapses `status: 'incomplete'`, `'failed'`, and `'cancelled'` all to `'error'` and ignores `ResponseRefusalDoneEvent` items entirely. The runner has no per-reason logic — it branches only on `'max_tokens'` and "no toolCalls" to exit.

This plan implements the spec in eight chunks (A–H). Chunks A–B are pure refactors that change no observable behavior. Chunks C–F change runner / provider behavior. Chunks G–H are cleanup (persistence + downstream consumers).

Each chunk is independently testable and revertible. After every chunk the test suite stays green.

---

## 2. Current state — code references

- `packages/agent/src/providers/anthropic-provider.ts:443` — `normalizeStopReason`. Maps to `'max_tokens' | 'stop' | 'tool_use'`. Collapses `pause_turn`, `refusal`, anything else to `'stop'`.
- `packages/agent/src/providers/bedrock-provider.ts:345` — identical to Anthropic.
- `packages/agent/src/providers/openai-provider.ts:1363` — Chat path. Maps `'stop' | 'length' | 'tool_calls' | 'content_filter'`. Collapses `content_filter` to `'stop'`.
- `packages/agent/src/providers/openai-provider.ts:582` — Responses path. Just `response.status === 'completed' ? 'stop' : 'error'`. Drops `incomplete_details`, `error.code`, refusal items.
- `packages/agent/src/providers/lmstudio-provider.ts:466` — minimal: `'tool_use' | 'stop'`.
- `packages/agent/src/providers/base-provider.ts:542` — fallback. Returns `'stop'` for anything.
- `packages/agent/src/core/conversation/types.ts:32` — `RunResult.stopReason` union: `'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded' | 'incomplete' | 'permission_cancelled'`.
- `packages/agent/src/core/conversation/runner.ts:432–474` — runner stop-reason dispatch. Only checks `response.stopReason === 'max_tokens'` and `toolCalls.length === 0`. Sets `stopReason = 'end_turn'` as the default.
- `packages/agent/src/core/conversation/runner.ts:491–528` — tool execution loop. Runs unconditionally when `toolCalls.length > 0`.
- `packages/agent/src/core/conversation/runner.ts:559` — `turn_end` event write.
- `packages/agent/src/storage/event-types.ts:37` — `turn_end` event shape: `stopReason: string` (free-form).
- `packages/agent/src/jobs/subagent-job.ts:56` — `mapStopReasonToJobStatus()` (per file comment line 56-ish; verify in implementation).

---

## 3. Target state (chunk mapping)

| Chunk | Surface | Behavior change |
|---|---|---|
| A | `stop-reason.ts` types + normalizers + tests | None — pure additions |
| B | All five providers use shared normalizers; `ProviderResponse` gains `stopDetails` | None observable — outputs identical to today for the values they already mapped; new values flow through but runner ignores |
| C | Runner explicit dispatch for `'refusal'`, `'context_window_exceeded'`, `'max_output_tokens'`, `'stop_sequence'`, `'failed'`; tool-exec gate | Refusals and context-exceeded now exit cleanly with typed reason instead of being collapsed to `'stop'` |
| D | Runner `pause_turn` auto-resume with `MAX_PAUSE_RESUMES` safety | Long-running Anthropic turns now correctly resume instead of being silently truncated |
| E | Provider HTTP error classifier | Pre-beta-endpoint `'prompt is too long'` 400s become `'context_window_exceeded'` stops instead of crashes |
| F | OpenAI Responses refusal-item capture during streaming | Refusal text no longer bleeds into normal assistant output; surfaces as `'refusal'` stop |
| G | `turn_end.data.stopDetails` persistence; `max_tokens` → `max_output_tokens` rename with legacy helper | Telemetry sees structured details; new events use new name |
| H | `subagent-job.ts` + any slash command consumers | Refusal/context-exceeded subagent results map to job `'failed'`; clean propagation up the tree |

---

## 4. Chunk A: Canonical types + normalizers (TDD)

**Files:**

- Create: `packages/agent/src/providers/stop-reason.ts`
- Create: `packages/agent/src/providers/__tests__/stop-reason.test.ts`
- Modify: `packages/agent/src/providers/base-provider.ts` (export `LaceStopReason`, `LaceStopDetails` for downstream consumers)

**Acceptance:** every row in spec §3 tables (3.1–3.6) has a corresponding test that asserts the normalizer's output. Build passes. Existing provider tests still pass (no provider behavior changes yet — these are just exports).

### Tasks

- [ ] **A.1 — Define types.** In `stop-reason.ts`, declare:
  ```ts
  export type LaceStopReason =
    | 'end_turn' | 'tool_use' | 'stop_sequence'
    | 'max_output_tokens' | 'context_window_exceeded' | 'refusal'
    | 'pause_turn'
    | 'cancelled' | 'permission_cancelled'
    | 'max_turns' | 'budget_exceeded' | 'incomplete'
    | 'failed';

  export type LaceStopDetails =
    | { type: 'refusal'; category: string | null; explanation: string | null;
        source: 'anthropic_classifier' | 'openai_chat_content_filter'
              | 'openai_responses_content_filter' | 'openai_responses_refusal_item' }
    | { type: 'context_window_exceeded';
        source: 'anthropic_beta_stop_reason' | 'http_400_prompt_too_long' | 'preflight_token_estimate';
        estimatedExcessTokens?: number }
    | { type: 'max_output_tokens';
        source: 'anthropic_stop_reason' | 'openai_chat_finish_reason' | 'openai_responses_incomplete_details';
        requestedMaxTokens?: number }
    | { type: 'stop_sequence'; sequence: string; source: 'anthropic_stop_sequence' }
    | { type: 'pause_turn'; source: 'anthropic_stop_reason' }
    | { type: 'failed'; code: string; message: string;
        source: 'openai_responses_failed_status' | 'http_error' }
    | { type: 'cancelled'; reason: 'abort_signal' | 'permission_cancelled' };

  export interface NormalizedStop {
    stopReason: LaceStopReason;
    stopDetails: LaceStopDetails | null;
  }
  ```

- [ ] **A.2 — Write tests FIRST for `normalizeAnthropicStop`.** Each row of spec §3.1. Test cases: `end_turn`, `max_tokens`, `tool_use`, `stop_sequence` (with and without `stop_sequence` field), `pause_turn`, `refusal` (with and without `stop_details`), `model_context_window_exceeded`, unknown value (expect WARN log + `'end_turn'`). One test per row. Tests fail (function doesn't exist).

- [ ] **A.3 — Implement `normalizeAnthropicStop`.** Signature: `(stopReason, stopDetails, stopSequence, source: 'anthropic_direct' | 'bedrock') => NormalizedStop`. Source discriminator is informational — both `anthropic_direct` and `bedrock` use the same mapping; the parameter is for future use if we need to distinguish (e.g. omitting `model_context_window_exceeded` paths). Tests pass.

- [ ] **A.4 — Tests + impl for `normalizeOpenAIChatStop`.** Per spec §3.3. Signature: `(finishReason) => NormalizedStop`. Covers all five values + null + unknown.

- [ ] **A.5 — Tests + impl for `normalizeOpenAIResponsesStop`.** Per spec §3.4. Signature: `(status, incompleteDetails, error, refusalEmittedDuringStream, hasFunctionToolCallOutput) => NormalizedStop`. Precedence order is load-bearing — test it: refusal-item wins over completed-status, completed+tool wins over completed-only, incomplete-max-tokens vs incomplete-content-filter, failed-with-code vs unknown-status.

- [ ] **A.6 — Tests + impl for `normalizeLMStudioStop`.** Per spec §3.6. Trivial — three rows.

- [ ] **A.7 — `normalizeLegacyStopReason` helper.** For consumers reading legacy `turn_end` events (`max_tokens` → `max_output_tokens` rewrite at read time). Signature: `(legacyValue: string) => LaceStopReason`. Tests cover the rename + identity for everything else.

- [ ] **A.8 — Build + commit.** `npm run build --workspace @lace/agent` clean. `npx vitest --run src/providers/__tests__/stop-reason.test.ts` all green. Commit message: `feat(providers): add LaceStopReason canonical types + per-provider normalizers (PRI-stop-reasons)`.

---

## 5. Chunk B: Wire normalizers into providers

**Files:**

- Modify: `packages/agent/src/providers/anthropic-provider.ts` (delete `normalizeStopReason`, call `normalizeAnthropicStop`)
- Modify: `packages/agent/src/providers/bedrock-provider.ts` (same)
- Modify: `packages/agent/src/providers/openai-provider.ts` (delete `normalizeStopReason` AND the `_createResponseImpl` inline `'stop' / 'error'` ternary; wire both Chat and Responses paths)
- Modify: `packages/agent/src/providers/lmstudio-provider.ts`
- Modify: `packages/agent/src/providers/base-provider.ts` (DELETE the base `normalizeStopReason` — it's the wrong layer; also add `stopDetails: LaceStopDetails | null` to `ProviderResponse`)
- Update: existing provider tests if they assert on stopReason values

**Acceptance:** all existing provider tests pass. New tests assert that for the values today's providers already mapped, the output is byte-identical. New values (refusal, pause_turn, context_window_exceeded, etc.) flow through to `ProviderResponse.stopReason` but the runner doesn't yet act on them — those tests come in chunks C–F.

### Tasks

- [ ] **B.1 — `ProviderResponse` shape update.** In `base-provider.ts`, add `stopDetails?: LaceStopDetails | null` and tighten `stopReason?: LaceStopReason | undefined`. Existing `stopReason: string | undefined` shape becomes the typed union.

- [ ] **B.2 — Anthropic provider.** Replace `this.normalizeStopReason(response.stop_reason)` at line 267 and line 415 with:
  ```ts
  const { stopReason, stopDetails } = normalizeAnthropicStop(
    response.stop_reason,
    response.stop_details,
    response.stop_sequence,
    'anthropic_direct'
  );
  ```
  Pass `stopReason` and `stopDetails` into the `ProviderResponse`. Delete the per-class `normalizeStopReason` method (line 443).

- [ ] **B.3 — Bedrock provider.** Same as B.2 but with `source: 'bedrock'`. Delete its `normalizeStopReason` (line 345).

- [ ] **B.4 — OpenAI Chat path.** Replace `this.normalizeStopReason(choice.finish_reason)` at lines 745 and 1047 with `normalizeOpenAIChatStop(...)`. Delete the class's `normalizeStopReason` (line 1363) once Chat and Responses both go through their respective shared normalizers.

- [ ] **B.5 — OpenAI Responses path.** Replace the `response.status === 'completed' ? 'stop' : 'error'` ternary at line 582 with `normalizeOpenAIResponsesStop(...)`. The `refusalEmittedDuringStream` argument is `null` at this point — refusal-item capture comes in chunk F. The `hasFunctionToolCallOutput` argument is `toolCalls.length > 0` (already computed locally). Plumb `stopDetails` into the `ProviderResponse`.

- [ ] **B.6 — LMStudio provider.** Replace its inline `'tool_use' | 'stop'` logic with `normalizeLMStudioStop(...)`. Search lmstudio-provider.ts for `stopReason:` assignments (lines 559, 586) — there are two; both get the normalizer.

- [ ] **B.7 — Delete base-provider `normalizeStopReason`.** No callers should remain after B.2–B.6. Verify with `grep -rn normalizeStopReason src/providers`. Remove from `base-provider.ts:542`.

- [ ] **B.8 — Update existing provider tests that assert stopReason strings.** The new values (`'end_turn'` instead of `'stop'`) WILL show up wherever the old normalizer was returning `'stop'` for `end_turn`. Fix the assertions, don't fix the code. Most provider tests today use raw API stubs and check downstream behavior, not the normalized string directly — likely small blast radius.

- [ ] **B.9 — Build + commit.** Full agent suite green. Commit: `refactor(providers): use shared LaceStopReason normalizers across all providers`.

---

## 6. Chunk C: Runner dispatch — terminal cases (TDD)

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts`
- Modify: `packages/agent/src/core/conversation/types.ts` (extend `RunResult.stopReason` union)
- Create: `packages/agent/src/core/conversation/__tests__/runner.refusal.test.ts`
- Create: `packages/agent/src/core/conversation/__tests__/runner.context-exceeded.test.ts`
- Create: `packages/agent/src/core/conversation/__tests__/runner.stop-dispatch.test.ts`

**Acceptance:** for each of `'refusal'`, `'context_window_exceeded'`, `'max_output_tokens'`, `'stop_sequence'`, `'failed'`, there is a test that stubs the provider to return that stop reason and asserts:
- Runner exits with the same `stopReason` in `RunResult`.
- `RunResult.stopDetails` matches the provider's `stopDetails`.
- `RunResult.content` contains the model's partial content (any text emitted before the stop).
- For `'refusal'` and `'context_window_exceeded'`: pending tool_use blocks survive in `RunResult.content` BUT are not executed (no `tool_result` event written, no side effect on the file system).

### Tasks

- [ ] **C.1 — Tests FIRST.** Three test files, one per cluster:
  - `runner.refusal.test.ts` — stub provider with `{stopReason: 'refusal', stopDetails: {type:'refusal', category:'cyber', explanation:'...', source:'anthropic_classifier'}, content: [{type:'text', text:'partial answer...'}, {type:'tool_use', id:'toolu_x', name:'bash', input:{}}]}`. Assert RunResult preserves partial content INCLUDING the tool_use block, asserts `stopReason === 'refusal'`, asserts `stopDetails` round-trips, asserts NO `tool_result` event in durable events.
  - `runner.context-exceeded.test.ts` — analogous for `'context_window_exceeded'`.
  - `runner.stop-dispatch.test.ts` — parametric test over `'max_output_tokens'`, `'stop_sequence'`, `'failed'`. The `'failed'` case asserts the runner throws (not returns), with the stopDetails carried on the thrown error.

  Tests fail because the runner today collapses these to `'end_turn'` or `'stop'`.

- [ ] **C.2 — Widen `RunResult.stopReason` union.** In `types.ts:32`:
  ```ts
  stopReason:
    | 'end_turn' | 'stop_sequence'
    | 'max_output_tokens' | 'context_window_exceeded' | 'refusal'
    | 'max_turns' | 'cancelled' | 'budget_exceeded' | 'incomplete'
    | 'permission_cancelled' | 'failed';
  ```
  Note: `'max_tokens'` removed; rename in chunk G handles the legacy compat. `'tool_use'` excluded (not terminal). `'pause_turn'` excluded per the §12 decision (auto-resumed). Add `stopDetails: LaceStopDetails | null` to RunResult.

- [ ] **C.3 — Implement runner dispatch.** In `runner.ts:432–474`, replace the existing branch logic. Concrete shape:

  ```ts
  const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];

  switch (response.stopReason) {
    case 'tool_use':
      // existing path: execute tools, loop continues
      break;
    case 'end_turn':
      // existing path: empty-text retry heuristic OR end_turn
      stopReason = 'end_turn';
      break;
    case 'max_output_tokens':
    case 'stop_sequence':
    case 'context_window_exceeded':
    case 'refusal':
      stopReason = response.stopReason;
      stopDetails = response.stopDetails ?? null;
      // Do NOT execute pending tool calls (see C.4)
      shouldContinue = false;
      break;
    case 'failed':
      throw {
        code: EntErrorCodes.ProviderError,
        message: response.stopDetails?.type === 'failed' ? response.stopDetails.message : 'Provider request failed',
        data: { category: 'provider', stopDetails: response.stopDetails },
      };
    // 'pause_turn' handled in chunk D
    // 'cancelled', 'permission_cancelled' handled by existing abort path
    default:
      // future stop reasons — exit cleanly
      logger.warn('Unknown provider stopReason', { stopReason: response.stopReason });
      stopReason = 'end_turn';
  }
  ```

- [ ] **C.4 — Gate tool-execution loop on `stopReason === 'tool_use'`.** At `runner.ts:491`, wrap the `for (const toolCall of toolCalls)` with:
  ```ts
  if (response.stopReason === 'tool_use') {
    for (const toolCall of toolCalls) { ... existing body ... }
  }
  ```
  This makes the "don't execute pending tool calls on refusal" rule explicit. Even though the new switch in C.3 sets `shouldContinue = false` and breaks the loop, this gate is a load-bearing safety check: future code paths must not assume "if there are toolCalls, execute them."

- [ ] **C.5 — Preserve partial content.** When `stopReason ∈ {'refusal', 'context_window_exceeded', 'max_output_tokens', 'stop_sequence'}`, the assistant turn's content (including any unexecuted tool_use blocks) is written via `writeAndAdvance` as a `'message'` event (existing path at `runner.ts:429`), with the tool_use blocks NOT followed by tool_result events. This is unusual durable state — a tool_use with no tool_result. The conversation rebuilder must tolerate it. **Verify** in C.6.

- [ ] **C.6 — Test conversation-rebuild tolerance of orphan tool_use.** Add a test in `message-building/__tests__/message-builder.test.ts` (or wherever orphan tool-result handling already lives) that asserts: a durable event sequence ending in `tool_use` with no following `tool_result` rebuilds to an assistant message with the tool_use, followed by NOTHING. This is currently invalid for Anthropic if sent BACK to the model (every tool_use needs a tool_result in the next message), but it's valid as the LAST entry in the conversation. The runner doesn't re-call the model after a refusal — the conversation just ends there until the next user prompt.

  **If the rebuilder doesn't tolerate this:** add a synthetic tool_result with `{outcome: 'cancelled', content: [{type: 'text', text: '<tool not executed: model stopped with stopReason X>'}]}` immediately after the orphan tool_use during rebuild. Document this as a rebuild-only synthesis (not a durable event).

- [ ] **C.7 — Build + run all tests + commit.** Commit: `feat(runner): explicit dispatch for refusal, context-exceeded, max-output-tokens, stop-sequence, failed`.

---

## 7. Chunk D: `pause_turn` auto-resume (TDD)

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts`
- Create: `packages/agent/src/core/conversation/__tests__/runner.pause-turn.test.ts`

**Acceptance:** stubbed provider returns `pause_turn` once then `end_turn`. Runner returns ONE `RunResult` with `stopReason === 'end_turn'`, content concatenated from both calls, `completedTurns === 1` (not 2). Stubbed provider returns `pause_turn` 11 times in a row → runner exits with `stopReason === 'failed'` and `stopDetails.code === 'pause_turn_loop'`.

### Tasks

- [ ] **D.1 — Test cases (write FIRST):**
  - Single pause: `pause_turn` → `end_turn`. Assert `RunResult.stopReason === 'end_turn'`, content from both responses appears, exactly ONE durable `'message'` event (the final concatenated turn).
  - Multiple pauses: `pause_turn` × 3 → `end_turn`. Same expectations.
  - Pause loop: `pause_turn` × 11. Assert `RunResult.stopReason === 'failed'`, `stopDetails.code === 'pause_turn_loop'`.
  - Pause does NOT count against `maxTurns`. Set `maxTurns: 2`, stub 3 logical turns each with `pause_turn` → `end_turn`. Assert runner completes 2 logical turns + early-exit via `max_turns`.

- [ ] **D.2 — Implement auto-resume.** Add a case to the switch from C.3:
  ```ts
  case 'pause_turn': {
    pauseResumeCount++;
    if (pauseResumeCount >= MAX_PAUSE_RESUMES) {
      throw {
        code: EntErrorCodes.ProviderError,
        message: `pause_turn loop: ${MAX_PAUSE_RESUMES} consecutive pauses`,
        data: { category: 'provider', stopDetails: { type: 'failed', code: 'pause_turn_loop', message: '...', source: 'http_error' } },
      };
    }
    // Re-append the partial assistant turn (so the next call sees it as the latest assistant message)
    providerMessages = [
      ...providerMessages,
      { role: 'assistant', content: assistantText, toolCalls: toolCalls.map(tc => ({...tc})) },
    ];
    // Do NOT increment completedTurns
    continue;
  }
  ```
  Where `MAX_PAUSE_RESUMES = 10` (module-level const). Reset `pauseResumeCount` to 0 whenever the response stopReason is NOT `'pause_turn'`.

- [ ] **D.3 — Durable-event accounting on pause.** Today `runner.ts:427-430` writes a `'message'` event with the assistant text. On pause, the text is partial. After auto-resume, the final text is the concatenation. **Don't write the partial as a durable event** — only write the final, concatenated text at logical-turn end. Track `partialAssistantText` in-memory across pauses; write once when the turn ends with a non-pause stopReason.

  Note: tool_use events get written per-tool from `executeToolCall`, not from runner.ts directly. On pause, no tools were executed (the model paused mid-response, before tool execution). So tool durability isn't affected by this chunk.

- [ ] **D.4 — Build + commit.** Commit: `feat(runner): pause_turn auto-resume with MAX_PAUSE_RESUMES safety counter`.

---

## 8. Chunk E: HTTP-400 → `context_window_exceeded` classifier (TDD)

**Files:**

- Create: `packages/agent/src/providers/utils/error-classifier.ts`
- Create: `packages/agent/src/providers/utils/__tests__/error-classifier.test.ts`
- Modify: `packages/agent/src/providers/anthropic-provider.ts` (error-handling wrap in both streaming + non-streaming paths)
- Modify: `packages/agent/src/providers/bedrock-provider.ts` (same)
- Modify: `packages/agent/src/providers/openai-provider.ts` (same, narrower whitelist initially)

**Acceptance:** HTTP 400 from Anthropic with body `{"error":{"type":"invalid_request_error","message":"prompt is too long: N tokens > M maximum"}}` returns a `ProviderResponse` with `stopReason: 'context_window_exceeded'` instead of throwing. Other 400s (e.g. our PRI-1796 `tool_use ids ...` case) continue to throw as today.

### Tasks

- [ ] **E.1 — Test fixtures FIRST.** In the test file, define stub error bodies:
  - Anthropic: `{error: {type: 'invalid_request_error', message: 'prompt is too long: N tokens > M maximum'}}` → should classify.
  - Anthropic: the PRI-1796 body `messages.1298: tool_use ids ...` → should NOT classify, throws normally.
  - Anthropic: random 500 error → not classified, throws normally.
  - Anthropic: 429 rate limit → not classified.
  - OpenAI: `{error: {code: 'context_length_exceeded', message: '...'}}` → should classify.

- [ ] **E.2 — Implement `classifyHttpError(err: unknown): NormalizedStop | null`.** Returns null if not classifiable (caller throws as today). Returns a `NormalizedStop` with `stopReason: 'context_window_exceeded'` and `stopDetails: {type: 'context_window_exceeded', source: 'http_400_prompt_too_long'}` for matching patterns. Whitelist patterns explicitly — no regex catch-all. Initial whitelist:
  - `/prompt is too long/i` (Anthropic)
  - `code === 'context_length_exceeded'` (OpenAI)

  Document the pattern list at the top of the file with a comment block explaining we're being deliberately narrow. Adding a pattern requires a fixture.

- [ ] **E.3 — Wire into Anthropic provider.** In the `catch (providerError)` block at `anthropic-provider.ts:364`, before throwing, call `classifyHttpError(providerError)`. If it returns a `NormalizedStop`, return a synthetic `ProviderResponse`:
  ```ts
  const classified = classifyHttpError(providerError);
  if (classified) {
    return {
      content: '',
      toolCalls: [],
      stopReason: classified.stopReason,
      stopDetails: classified.stopDetails,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
  // existing throw
  ```
  Note the `usage` is zeros because the request never completed. Tests verify this doesn't break downstream cost tracking.

- [ ] **E.4 — Wire into Bedrock + OpenAI.** Same pattern.

- [ ] **E.5 — Build + commit.** Commit: `feat(providers): classify "prompt too long" 400s as context_window_exceeded`.

---

## 9. Chunk F: OpenAI Responses refusal-item capture (TDD)

**Files:**

- Modify: `packages/agent/src/providers/openai-provider.ts` (streaming event handler for the Responses API)
- Create: `packages/agent/src/providers/__tests__/openai-responses-refusal.test.ts`

**Acceptance:** when the OpenAI Responses stream emits a `ResponseRefusalDoneEvent`, the captured `refusal` text is plumbed into `normalizeOpenAIResponsesStop` as the `refusalEmittedDuringStream` argument. Resulting `ProviderResponse.stopReason === 'refusal'`, `stopDetails.explanation === <refusal text>`, `stopDetails.source === 'openai_responses_refusal_item'`. The refusal text does NOT appear in `content` (it's not assistant output; it's a policy refusal).

### Tasks

- [ ] **F.1 — Test FIRST.** Stub the Responses streaming events to emit:
  1. `response.created`
  2. `response.in_progress`
  3. `response.output_item.added` (a `message` item)
  4. `response.refusal.delta` (chunk 1 of refusal)
  5. `response.refusal.delta` (chunk 2 of refusal)
  6. `response.refusal.done` (with `refusal: 'I can't help with that.'`)
  7. `response.completed` (status: 'completed')

  Assert: `ProviderResponse.stopReason === 'refusal'`, `stopDetails.source === 'openai_responses_refusal_item'`, `stopDetails.explanation === "I can't help with that."`, `content === ''`.

- [ ] **F.2 — Implement capture during stream.** In the Responses-API streaming handler (around `openai-provider.ts:879+`), track a `let refusalText: string | null = null;` variable. Accumulate `response.refusal.delta` events into a buffer. On `response.refusal.done`, set `refusalText = doneEvent.refusal`. Reset on each new output item (a single Response can have multiple output items).

- [ ] **F.3 — Pass to normalizer.** When the stream completes, call `normalizeOpenAIResponsesStop(status, incompleteDetails, error, refusalText, hasFunctionToolCallOutput)`. The normalizer's precedence (per spec §3.4) puts refusal-item ahead of status, so completed-with-refusal still yields `'refusal'`.

- [ ] **F.4 — Build + commit.** Commit: `feat(openai-responses): capture refusal items as stopReason='refusal'`.

---

## 10. Chunk G: Persistence + rename

**Files:**

- Modify: `packages/agent/src/storage/event-types.ts` (extend `turn_end` data shape)
- Modify: `packages/agent/src/core/conversation/runner.ts` (write `stopDetails` on turn_end)
- Modify: `packages/agent/src/core/conversation/types.ts` (`RunResult.stopReason` already includes `'max_output_tokens'` from chunk C; just remove `'max_tokens'` if it's still there)
- Modify: Any consumer that compares `stopReason === 'max_tokens'` — use `normalizeLegacyStopReason(...)` first.

**Acceptance:** new `turn_end` events have `stopDetails: LaceStopDetails | null` populated. Existing events read back cleanly (the field is absent → null). Searches for the literal string `'max_tokens'` in code show only the legacy helper.

### Tasks

- [ ] **G.1 — Extend event shape.** In `event-types.ts:37`, the `turn_end` event data:
  ```ts
  type: 'turn_end';
  data: {
    stopReason: LaceStopReason;          // typed now
    stopDetails?: LaceStopDetails | null; // new, optional for back-compat
    // existing fields preserved
  };
  ```
  Note: the field is optional + `| null`. Legacy events with no `stopDetails` field deserialize to `undefined`; consumers normalize to `null`.

- [ ] **G.2 — Write `stopDetails` on turn_end.** In `runner.ts:559`, the `writeAndAdvance({type: 'turn_end', data: {...}})` call. Add `stopDetails`.

- [ ] **G.3 — Find and rewrite `'max_tokens'` consumers.** `grep -rn "'max_tokens'\|\"max_tokens\"" packages/agent/src`. For each hit:
  - If it's reading legacy events: wrap with `normalizeLegacyStopReason(rawValue)` before comparing.
  - If it's writing/asserting current behavior: use the new `'max_output_tokens'` literal.
  - If it's a test fixture for OLD events: leave as-is.

  Expected hits: subagent-job.ts (chunk H deals with), tests in `core/conversation/__tests__`, possibly `rpc/handlers/prompt.ts`.

- [ ] **G.4 — Build + commit.** Commit: `feat(events): persist stopDetails on turn_end; rename max_tokens → max_output_tokens`.

---

## 11. Chunk H: Consumer updates

**Files:**

- Modify: `packages/agent/src/jobs/subagent-job.ts` (or `subagent-job-helpers.ts` — locate `mapStopReasonToJobStatus`)
- Modify: `packages/agent/src/conversation/slash-commands.ts` (if `/compact` or similar wants to react to `'context_window_exceeded'`)
- Modify: any web-UI surface that displays stopReason (probably out of scope for this plan — flag as downstream)

**Acceptance:** subagent jobs return `status: 'failed'` for `'refusal'`, `'context_window_exceeded'`, `'failed'` stopReasons. Existing `'permission_cancelled'` → `'cancelled'` mapping preserved. Slash commands receive the typed `RunResult.stopReason` and `stopDetails` if they want them.

### Tasks

- [ ] **H.1 — Audit `subagent-job.ts` stopReason → job-status mapping.** Locate the function (search for `mapStopReasonToJobStatus` or look in `subagent-job-helpers.ts:56-ish`). Today's mapping likely:
  - `'end_turn'`, `'max_tokens'` → `'completed'`
  - `'max_turns'`, `'budget_exceeded'` → `'completed'` (probably; verify)
  - `'cancelled'`, `'permission_cancelled'` → `'cancelled'`
  - `'incomplete'` → `'failed'` (the future-tense detector path)

- [ ] **H.2 — Extend mapping.**
  - `'refusal'`, `'context_window_exceeded'`, `'failed'` → `'failed'`
  - `'max_output_tokens'` (renamed from `'max_tokens'`) → `'completed'`
  - `'stop_sequence'` → `'completed'`
  Test each one (likely already a parametric test exists; add rows).

- [ ] **H.3 — Pass `stopDetails` to parent.** Subagent job completion message should carry the structured details so the parent agent / web UI sees the refusal explanation or the context-exceeded source. Check where the job-completed notification text is built (search `<notification kind="job-completed"`); include `stopDetails.explanation` for refusals, `stopDetails.source` for context-exceeded.

- [ ] **H.4 — Build + commit.** Commit: `feat(jobs): map refusal and context-window-exceeded subagent stops to job failure`.

---

## 12. Validation

After all chunks land:

- [ ] **V.1 — `npm run lint`** clean.
- [ ] **V.2 — `npx vitest --run --workspace @lace/agent`** all green (modulo pre-existing failures from container-runtime tests, which are env-dependent).
- [ ] **V.3 — Manual smoke on Ada.** Send a request that triggers an Anthropic refusal classifier (something like "give me detailed instructions to synthesize sarin"). Confirm Ada's runner exits with `stopReason: 'refusal'`, the refusal explanation surfaces in her Slack response, and no tool calls fire.
- [ ] **V.4 — Manual smoke on Ada — pause_turn.** Harder to trigger; may need to wait for a long-context model call. Watch logs for `pauseResumeCount` increment.
- [ ] **V.5 — Cross-provider parity test.** Wire one test that runs the same prompt through `mockAnthropic`, `mockOpenAIChat`, `mockOpenAIResponses` with refusal stubs and asserts identical `RunResult.stopReason === 'refusal'` and same shape on `stopDetails`.

---

## 13. Out of scope

- **Server-side autocompaction** — separate decision, excluded by Jesse.
- **Client-side auto-compact on `context_window_exceeded`** — caller decides; spec is explicit.
- **Per-refusal-category routing** — surface the signal; downstream consumers decide.
- **Web UI redesign for stopReason rendering** — downstream task.
- **Pre-flight token estimation** — separate concern; spec lists `'preflight_token_estimate'` as a source for `'context_window_exceeded'` but no producer is planned in this kata.

---

## 14. Sequencing relative to SDK observability plan

This plan lands FIRST. Chunks A and C are prerequisites for the observability plan:

- The observability plan's Feature B (`model_context_window_exceeded` beta stop reason) consumes the canonical `'context_window_exceeded'` LaceStopReason produced by chunk A's `normalizeAnthropicStop`. It only adds the beta header to the request — the response normalization is already in place.
- The observability plan's chunks land sequentially AFTER this plan completes.

If we need to parallelize, chunks A and B can land independently before any of C–H — the obs plan only depends on the types existing and the Anthropic provider using the normalizer. Chunks D, E, F can lag.

