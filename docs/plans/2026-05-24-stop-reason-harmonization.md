# Stop Reason Harmonization Across Providers

**Status:** Draft spec, 2026-05-24. Pre-implementation.
**Branch:** TBD. Probably the same branch that lands the SDK observability work, sequenced first.
**Inputs:** Anthropic Messages API (`stop_reason` + `stop_details`), Anthropic beta extensions (`pause_turn`, `refusal`, `model_context_window_exceeded`, `compaction`), OpenAI Chat Completions (`finish_reason`), OpenAI Responses API (`status` + `incomplete_details` + per-item refusal/error events), Bedrock (Anthropic semantics, no beta endpoint), LMStudio (minimal), our current `RunResult.stopReason` union, and the existing `normalizeStopReason` implementations on each provider.

---

## 0. The framing

We have five provider implementations and four `normalizeStopReason` functions. Each maps a different raw vocabulary into a string we treat as `ProviderResponse.stopReason`. The runner then folds that into a `RunResult.stopReason` with a different and overlapping vocabulary. There is no single document that says what the legal values are or what the agent loop should do for each. There is no test that says "for an OpenAI content_filter, the runner should X." Several signals — `pause_turn`, `refusal`, OpenAI `content_filter`, OpenAI `incomplete_details.reason`, OpenAI Responses `status: 'incomplete'` and `'failed'` — are silently flattened into `'stop'` or `'error'` today, throwing away information the agent or operator needs.

This spec defines:

1. The **canonical stop-reason taxonomy** the agent loop and downstream consumers will see, with explicit semantics for each value.
2. The **per-provider normalization** from raw signals to canonical values, surfaced as a single reference table, no per-provider drift.
3. The **structured details** payload that travels alongside the canonical reason (the policy category on a refusal, the incomplete reason on OpenAI, etc.).
4. The **runner dispatch**: what the agent loop does for each canonical reason. Loop? Resume? Exit and surface? Crash?
5. The **durable persistence** of stop reason + details in `events.jsonl` so the conversation rebuild sees the same shape we sent at runtime.
6. The **compatibility plan** for the existing `RunResult.stopReason` union and its consumers.

The intent is that after this lands, no provider silently throws away a signal, and the runner has exactly one place that decides what each signal means.

---

## 1. Current state — raw signals by provider

### 1.1 Anthropic Messages API (base)

Source: `@anthropic-ai/sdk@0.98.0`, `resources/messages/messages.d.ts`.

```ts
StopReason =
  | 'end_turn'        // natural completion
  | 'max_tokens'      // hit our requested max_tokens or model max
  | 'stop_sequence'   // a custom stop_sequence matched; stop_sequence field set
  | 'tool_use'        // model emitted tool_use blocks
  | 'pause_turn'      // long-running turn paused; resend message to continue
  | 'refusal'         // streaming classifier intervened on policy
```

Plus a top-level `stop_details: RefusalStopDetails | null`. Today the only variant is:

```ts
interface RefusalStopDetails {
  category: 'cyber' | 'bio' | null;
  explanation: string | null;  // human-readable, not guaranteed stable
  type: 'refusal';
}
```

Custom stop sequences set `stop_sequence: string` on the Message.

### 1.2 Anthropic Messages API (beta endpoint, `client.beta.messages.*`)

Source: same SDK, `resources/beta/messages/messages.d.ts`.

```ts
BetaStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'compaction'                       // server autocompacted; not adopting (per Jesse)
  | 'model_context_window_exceeded'    // input would exceed context window; beta header opt-in
```

Same `RefusalStopDetails` shape; same `stop_sequence` field. No structured details for `model_context_window_exceeded` today — just the stop reason itself, with the partial output up to the limit.

### 1.3 Anthropic via Bedrock (`@anthropic-ai/bedrock-sdk`)

Bedrock SDK declares a peer on `@anthropic-ai/sdk@>=0.50.3 <1` and routes through AWS Bedrock. The wire surface is the Anthropic Messages API shape, but the Bedrock SDK does NOT expose `client.beta.messages` — beta features only via `anthropic-beta` header, and the response types don't include beta-only fields. So:

```ts
BedrockStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'   // received but never beta-only
  | 'refusal'
```

No access to `model_context_window_exceeded` even when the model is from Anthropic.

### 1.4 OpenAI Chat Completions (`finish_reason`)

Source: `openai`, `resources/chat/completions/completions.d.ts`.

```ts
ChatCompletionFinishReason =
  | 'stop'             // natural completion
  | 'length'           // hit max_tokens
  | 'tool_calls'       // model emitted tool_calls
  | 'content_filter'   // content policy filter triggered
  | 'function_call'    // legacy single-function form; deprecated
  | null               // still streaming
```

No structured stop-details object. No refusal explanation. `content_filter` is binary.

### 1.5 OpenAI Responses API

Source: `openai`, `resources/responses/responses.d.ts`. This is the newer endpoint we use in `openai-provider.ts:582` and `_createResponseImpl`.

```ts
ResponseStatus =
  | 'completed'
  | 'incomplete'      // structured reason in incomplete_details
  | 'failed'          // structured error in `error` field
  | 'cancelled'
  | 'queued'          // non-terminal
  | 'in_progress'     // non-terminal

IncompleteDetails = { reason?: 'max_output_tokens' | 'content_filter' }

ResponseError = {
  code: 'server_error' | 'rate_limit_exceeded' | 'invalid_prompt'
      | 'vector_store_timeout' | 'invalid_image' | 'invalid_image_format'
      | 'invalid_base64_image' | 'invalid_image_url' | 'image_too_large'
      | 'image_too_small' | 'image_parse_error'
      | 'image_content_policy_violation' | 'invalid_image_mode'
      | 'image_file_too_large' | 'unsupported_image_media_type'
      | 'empty_image_file' | 'failed_to_download_image'
      | 'image_file_not_found',
  message: string
}
```

Refusals on Responses are **per-item output events**, not a status:

```ts
ResponseRefusalDoneEvent { refusal: string, content_index: number, ... }
```

A response can have `status: 'completed'` AND emit a `ResponseRefusalDoneEvent` as one of its output items. So checking only top-level `status` misses refusals entirely (which is what we do today).

There is no "tool_use" status — tool calls are output items.

### 1.6 LMStudio

Source: `lmstudio-provider.ts:466`, `:559`, `:586`. Two values observed: `'tool_use'` and `'stop'` (plus `null` during streaming). LMStudio is a local-model frontend; what it actually emits depends on the loaded model and the runtime version. We treat unknowns as `'stop'`.

### 1.7 What lace currently does — the existing `normalizeStopReason` functions

`anthropic-provider.ts:443`:
```ts
'max_tokens'    → 'max_tokens'
'end_turn'      → 'stop'
'tool_use'      → 'tool_use'
'stop_sequence' → 'stop'
default         → 'stop'           // pause_turn, refusal, model_context_window_exceeded all here
```

`bedrock-provider.ts:345`: identical to Anthropic.

`openai-provider.ts:1363`:
```ts
'length'         → 'max_tokens'
'stop'           → 'stop'
'tool_calls'     → 'tool_use'
'content_filter' → 'stop'           // dropped
default          → 'stop'
```

`openai-provider.ts:582` (Responses API):
```ts
response.status === 'completed' ? 'stop' : 'error'
// incomplete_details.reason dropped, error.code dropped, refusal items dropped
```

`base-provider.ts:542`: fallback returns `'stop'` for everything.

`RunResult.stopReason` union (`core/conversation/types.ts:32`):
```ts
'end_turn' | 'max_tokens' | 'max_turns' | 'cancelled' | 'budget_exceeded' | 'incomplete' | 'permission_cancelled'
```

`'end_turn'` is in `RunResult` but providers emit `'stop'`. Runner assigns `'end_turn'` itself when its loop exits naturally (`runner.ts:472`). So `'stop'` from the provider becomes either `'end_turn'`, `'incomplete'`, or `'max_turns'` depending on runner state.

### 1.8 Signals we're silently dropping

| Signal | Provider | What we do today |
|---|---|---|
| `pause_turn` | Anthropic, Bedrock | Collapsed to `'stop'`. Partial response is returned; agent treats it as a clean end. **The model intended to continue.** |
| `refusal` (Anthropic) | Anthropic, Bedrock | Collapsed to `'stop'`. Lose policy category and explanation. |
| `content_filter` | OpenAI Chat | Collapsed to `'stop'`. Lose the signal entirely. |
| `incomplete_details.reason = 'content_filter'` | OpenAI Responses | Collapsed to `'error'`. |
| `incomplete_details.reason = 'max_output_tokens'` | OpenAI Responses | Collapsed to `'error'`. Should be `max_tokens`. |
| `status: 'failed'` + `error.code` | OpenAI Responses | Collapsed to `'error'`. Lose the specific error code. |
| `ResponseRefusalDoneEvent` items | OpenAI Responses | Ignored — we only check top-level `status`. Refusal text bleeds into normal output as if it were an assistant turn. |
| `model_context_window_exceeded` (beta) | Anthropic (beta) | Not opted into yet; would currently fall through `default → 'stop'` even if it appeared. |
| `stop_sequence` field | Anthropic | Collapsed to `'stop'`. Lose which sequence matched. |

The most consequential ones for the agent loop are `pause_turn` (we drop continuation), refusals on both providers (we treat policy intervention as a clean end), and `model_context_window_exceeded` (we have no signal at all today).

---

## 2. Canonical taxonomy

### 2.1 `LaceStopReason` — the canonical enum

This is the union we'll use on `ProviderResponse.stopReason` AND on `RunResult.stopReason`. Same enum at both layers. No mental translation between "what the provider said" and "what the runner reported."

```ts
type LaceStopReason =
  // Terminal — successful
  | 'end_turn'                  // model finished cleanly
  | 'tool_use'                  // model wants to call tools; loop continues
  | 'stop_sequence'             // a custom stop sequence matched

  // Terminal — model-decided incomplete
  | 'max_output_tokens'         // the OUTPUT exceeded our requested max_tokens (or model's max)
  | 'context_window_exceeded'   // the INPUT couldn't fit in the context window
  | 'refusal'                   // policy classifier or content filter intervened

  // Non-terminal — provider control flow
  | 'pause_turn'                // resend message to let model continue; SAME logical turn

  // Terminal — caller / runtime
  | 'cancelled'                 // AbortSignal fired (caller wants to stop)
  | 'permission_cancelled'      // tool-permission cancellation (kata #37)

  // Terminal — agent-loop policy (no provider-side cause)
  | 'max_turns'                 // hit our loop budget
  | 'budget_exceeded'           // hit configured cost budget
  | 'incomplete'                // future-tense intent detected (NEVER_SUBMITTED)

  // Terminal — failure
  | 'failed';                   // provider returned an error
```

Rationale for each name:

- `'end_turn'` (existing): preserved for compat; semantically "model thinks it's done."
- `'tool_use'`: present on `ProviderResponse` to drive the runner's tool-call branch. Not present on `RunResult` — by the time runner returns to its caller, tool use has either continued the loop (ended via something else) or the caller doesn't care that intermediate turns called tools.
- `'stop_sequence'`: surfaced because the caller may want to know which custom sequence matched. Today we don't use `stop_sequences` anywhere; this is forward-compat.
- `'max_output_tokens'`: renamed from `'max_tokens'` for clarity. Distinguishes from `'context_window_exceeded'` which is an INPUT problem. (Migration in §6.)
- `'context_window_exceeded'`: new. The conversation history is too long. Triggered by either (a) Anthropic beta `model_context_window_exceeded`, (b) explicit pre-flight detection if we add one, (c) HTTP 400 with `prompt_too_long`-style error message — see §3.7.
- `'refusal'`: new. Unified across Anthropic policy classifier, OpenAI Chat `content_filter`, OpenAI Responses `incomplete_details.reason: 'content_filter'`, and OpenAI Responses `ResponseRefusalDoneEvent` items.
- `'pause_turn'`: new. Anthropic-only. Runner auto-resumes; does not appear on `RunResult` unless we want to expose it (decision in §5.4).
- `'cancelled'`, `'permission_cancelled'`, `'max_turns'`, `'budget_exceeded'`, `'incomplete'`: preserved from existing union, semantics unchanged.
- `'failed'`: new. Today the OpenAI Responses path emits `'error'` as an unconstrained string. Promote to a typed value with structured details (see §2.2).

### 2.2 `LaceStopDetails` — the structured payload

Sits alongside `LaceStopReason` wherever the reason appears. `null` when no extra detail.

```ts
type LaceStopDetails =
  | { type: 'refusal';
      category: string | null;       // 'cyber' | 'bio' | null (Anthropic); null otherwise
      explanation: string | null;    // anthropic explanation OR openai refusal text OR null
      source: 'anthropic_classifier' | 'openai_chat_content_filter'
            | 'openai_responses_content_filter' | 'openai_responses_refusal_item' }

  | { type: 'context_window_exceeded';
      source: 'anthropic_beta_stop_reason' | 'http_400_prompt_too_long' | 'preflight_token_estimate';
      // optional advisory; populated when the source provides it
      estimatedExcessTokens?: number }

  | { type: 'max_output_tokens';
      source: 'anthropic_stop_reason' | 'openai_chat_finish_reason'
            | 'openai_responses_incomplete_details';
      requestedMaxTokens?: number }

  | { type: 'stop_sequence';
      sequence: string;                              // which custom sequence matched
      source: 'anthropic_stop_sequence' }

  | { type: 'pause_turn';
      source: 'anthropic_stop_reason' }

  | { type: 'failed';
      code: string;                                  // provider's code, e.g. 'server_error'
      message: string;                               // provider's message
      source: 'openai_responses_failed_status' | 'http_error' }

  | { type: 'cancelled';
      reason: 'abort_signal' | 'permission_cancelled' };
```

For the simple/structural cases (`end_turn`, `tool_use`, `max_turns`, `budget_exceeded`, `incomplete`), `stopDetails` is `null`.

`source` is a deliberate field. It tells the operator (and the test author) exactly which provider channel the signal came from. Two refusals from the same model but different code paths (one from streaming classifier, one from output-item refusal event) are distinguishable.

### 2.3 What goes on `ProviderResponse` vs `RunResult`

`ProviderResponse.stopReason: LaceStopReason` — the raw normalized value from the provider call. Includes `'tool_use'` and `'pause_turn'`.

`ProviderResponse.stopDetails: LaceStopDetails | null` — structured payload from the provider call.

`RunResult.stopReason: LaceStopReason` — the terminal reason the runner exited on. Excludes `'tool_use'` (it's not terminal — runner continues) and excludes `'pause_turn'` if we auto-resume. Includes runner-only values (`'max_turns'`, `'budget_exceeded'`, `'incomplete'`).

`RunResult.stopDetails: LaceStopDetails | null` — structured payload. For runner-only values where there's no provider signal, this is `null` (or a `'cancelled'` variant for permission_cancelled).

Same enum at both layers — the subset differs, but no aliasing.

---

## 3. Per-provider normalization

This is the single source of truth. Each provider implements `normalizeStopReason` and `extractStopDetails` against this table; no per-provider drift.

### 3.1 Anthropic Messages API (base + beta, same mapping)

| Raw `stop_reason` | Raw `stop_details` / context | Canonical `stopReason` | Canonical `stopDetails` |
|---|---|---|---|
| `'end_turn'` | — | `'end_turn'` | `null` |
| `'max_tokens'` | — | `'max_output_tokens'` | `{ type: 'max_output_tokens', source: 'anthropic_stop_reason', requestedMaxTokens? }` |
| `'tool_use'` | — | `'tool_use'` | `null` |
| `'stop_sequence'` | `stop_sequence: <string>` | `'stop_sequence'` | `{ type: 'stop_sequence', sequence, source: 'anthropic_stop_sequence' }` |
| `'pause_turn'` | — | `'pause_turn'` | `{ type: 'pause_turn', source: 'anthropic_stop_reason' }` |
| `'refusal'` | `stop_details: { type: 'refusal', category, explanation }` | `'refusal'` | `{ type: 'refusal', category, explanation, source: 'anthropic_classifier' }` |
| `'model_context_window_exceeded'` (beta) | — | `'context_window_exceeded'` | `{ type: 'context_window_exceeded', source: 'anthropic_beta_stop_reason' }` |
| `'compaction'` (beta) | — | unreachable — we don't enable autocompaction | — |
| anything else | — | `'end_turn'` + WARN log | `null` |

**Default to `'end_turn'`, not `'stop'`.** Unknown reasons are likely future-compatible additions where "model stopped naturally" is the safer assumption than a more specific value. WARN at INFO level so we notice when Anthropic ships something new.

### 3.2 Anthropic via Bedrock

Identical to §3.1 EXCEPT:

- `'model_context_window_exceeded'` will never appear (no beta endpoint).
- The `'compaction'` case is also unreachable.

Bedrock provider can share the same normalization function as Anthropic-direct.

### 3.3 OpenAI Chat Completions (`finish_reason`)

| Raw `finish_reason` | Context | Canonical `stopReason` | Canonical `stopDetails` |
|---|---|---|---|
| `'stop'` | — | `'end_turn'` | `null` |
| `'length'` | — | `'max_output_tokens'` | `{ type: 'max_output_tokens', source: 'openai_chat_finish_reason', requestedMaxTokens? }` |
| `'tool_calls'` | — | `'tool_use'` | `null` |
| `'content_filter'` | — | `'refusal'` | `{ type: 'refusal', category: null, explanation: null, source: 'openai_chat_content_filter' }` |
| `'function_call'` (legacy) | — | `'tool_use'` + WARN | `null` (we don't use legacy functions; warn if we ever receive one) |
| `null` | streaming, non-terminal | undefined (no terminal value) | `null` |
| anything else | — | `'end_turn'` + WARN | `null` |

### 3.4 OpenAI Responses API (`status` + `incomplete_details` + refusal items)

The Responses API surface is structurally different — `status` is the terminal classifier, with `incomplete_details` and `error` carrying detail. Plus refusals appear as output items, not as a status.

**Precedence (highest first):** if a refusal item was emitted during the stream, that wins over `status` (a refusal item means policy intervention; everything else is secondary).

| Condition (checked in order) | Canonical `stopReason` | Canonical `stopDetails` |
|---|---|---|
| stream emitted `ResponseRefusalDoneEvent` | `'refusal'` | `{ type: 'refusal', category: null, explanation: <refusal text>, source: 'openai_responses_refusal_item' }` |
| `status: 'completed'` AND output ends with a function tool call | `'tool_use'` | `null` |
| `status: 'completed'` | `'end_turn'` | `null` |
| `status: 'incomplete'` AND `incomplete_details.reason: 'max_output_tokens'` | `'max_output_tokens'` | `{ type: 'max_output_tokens', source: 'openai_responses_incomplete_details', requestedMaxTokens? }` |
| `status: 'incomplete'` AND `incomplete_details.reason: 'content_filter'` | `'refusal'` | `{ type: 'refusal', category: null, explanation: null, source: 'openai_responses_content_filter' }` |
| `status: 'failed'` AND `error.code` present | `'failed'` | `{ type: 'failed', code: error.code, message: error.message, source: 'openai_responses_failed_status' }` |
| `status: 'cancelled'` | `'cancelled'` | `{ type: 'cancelled', reason: 'abort_signal' }` |
| `status: 'queued' \| 'in_progress'` | undefined | `null` (non-terminal — provider should not have returned yet) |
| anything else | `'failed'` + WARN | `{ type: 'failed', code: 'unknown_status', message: '<the literal status string>', source: 'openai_responses_failed_status' }` |

The "tool_use detection" condition needs explicit logic: scan the output array for the last function/tool_call item and check whether it's terminal. (The current implementation already does this implicitly by populating `toolCalls`; this just promotes the same observation to the stop_reason layer.)

### 3.5 Bedrock (Anthropic-via-AWS)

Same as Anthropic §3.1, minus the beta-only reasons.

### 3.6 LMStudio

| Raw | Canonical | Details |
|---|---|---|
| `'tool_use'` | `'tool_use'` | `null` |
| `'stop'` | `'end_turn'` | `null` |
| undefined / unknown | `'end_turn'` + WARN | `null` |

### 3.7 HTTP-error escalation to `'context_window_exceeded'`

The Anthropic beta gives us a server signal for context-window overflow. Without the beta (Bedrock, and Anthropic-direct before the beta is enabled), the overflow surfaces as HTTP 400 with a body matching `/prompt is too long/i` or similar. Today we throw `LaceRpcError` with `category: 'provider'`.

**Spec:** add a pre-throw classifier in the provider error-handling layer. If the HTTP error body matches a small whitelist of "input too long" patterns (Anthropic and OpenAI variants), wrap it into a `'context_window_exceeded'` `LaceStopReason` and surface it through the normal stopReason channel instead of throwing. `stopDetails.source = 'http_400_prompt_too_long'`.

This is the only place we manufacture a stop reason from an HTTP error rather than from a successful response. Justified because the user-visible symptom is identical and the runner's response is identical (compact or give up).

---

## 4. Refusal handling — special case

Refusals appear in three different shapes across providers:

1. **Anthropic streaming classifier** — `stop_reason: 'refusal'` + structured `stop_details: { category, explanation }`. The model's textual output up to the refusal point is in `content`; the refusal explanation is separate metadata.
2. **OpenAI Chat `content_filter`** — `finish_reason: 'content_filter'`, no structured detail, no explanation. Just a flag.
3. **OpenAI Responses refusal item** — `ResponseRefusalDoneEvent` embedded mid-stream. The refusal text IS the explanation, and it appears in the output content array alongside any other text.

The canonical mapping (§2.2's `LaceStopDetails.refusal`) carries:
- `category` (Anthropic-only; `null` elsewhere)
- `explanation` (Anthropic explanation OR OpenAI Responses refusal text OR `null`)
- `source` discriminator

**Important downstream behavior:** when stop is `'refusal'`, the assistant content collected before the refusal MAY be useful (a partial answer that was cut off) OR may be misleading (text that the policy filter rejected). The spec recommends:

- Keep the partial assistant content in `RunResult.content`.
- DO NOT execute any tool calls that were emitted before the refusal — these are speculative and the refusal supersedes them. (Current code probably already skips them because we only execute when `stopReason === 'tool_use'`; verify in implementation.)
- The runner exits with `stopReason = 'refusal'`. The caller (subagent job, slash command, web UI) decides what to display.

---

## 5. Runner dispatch — what to do for each canonical reason

`packages/agent/src/core/conversation/runner.ts`, the main agentic loop at `:248`. Today the loop branches on `response.stopReason === 'max_tokens'` and otherwise relies on `toolCalls.length === 0` to decide whether to break. After this spec lands the dispatch is explicit.

### 5.1 Provider returns one of:

| `ProviderResponse.stopReason` | Runner action |
|---|---|
| `'tool_use'` | Execute tool calls (existing path). Loop continues. Do NOT exit. |
| `'end_turn'` | Exit loop. `RunResult.stopReason = 'end_turn'`. UNLESS the empty-response-retry heuristic triggers (existing `retriedWithToolChoice` path). |
| `'max_output_tokens'` | Exit loop. `RunResult.stopReason = 'max_output_tokens'`. Surface partial content. |
| `'stop_sequence'` | Exit loop. `RunResult.stopReason = 'stop_sequence'`. Surface partial content. |
| `'context_window_exceeded'` | Exit loop. `RunResult.stopReason = 'context_window_exceeded'`. Surface partial content. Caller is expected to compact and retry. |
| `'refusal'` | Exit loop. `RunResult.stopReason = 'refusal'`. Surface partial content + `stopDetails`. Skip any pending tool calls. |
| `'pause_turn'` | **Auto-resume.** See §5.4. Does not appear on RunResult. |
| `'failed'` | Throw. Same path as today's provider-error throw. Carries `stopDetails` for callers that catch. |
| `'cancelled'` | Already covered by the existing abort-signal branch. |

### 5.2 Pre-loop or in-loop runner-only conditions

| Condition | RunResult.stopReason |
|---|---|
| `completedTurns >= maxTurns` after a `'end_turn'` provider exit | `'max_turns'` (existing) |
| `maxBudgetUsd` exceeded | `'budget_exceeded'` (existing) |
| `hasFutureTenseIntent(assistantText)` heuristic triggers | `'incomplete'` (existing) |
| Tool permission cancellation (kata #37) | `'permission_cancelled'` (existing) |
| `abortController.signal.aborted` | `'cancelled'` (existing) |

### 5.3 `'tool_use'` is the only non-terminal provider value

By definition, when `ProviderResponse.stopReason === 'tool_use'`, the runner is mid-turn and the loop continues. It NEVER appears in `RunResult.stopReason`. Type-level: `RunResult.stopReason` is a strict subset of `LaceStopReason` minus `'tool_use'` (and minus `'pause_turn'` per §5.4).

### 5.4 `'pause_turn'` — auto-resume semantics

Anthropic returns `pause_turn` when a long-running turn (e.g. server-side compaction is happening mid-generation, or a tool is taking too long server-side) needs the client to "resend the assistant turn as-is" to continue. The SDK docstring says: *"You may provide the response back as-is in a subsequent request to let the model continue."*

**Spec:** the runner handles this transparently. Same `turnId`, same `turnSeq` budget (does NOT count against `maxTurns`), same `streamTurnSeq`. Implementation:

```ts
case 'pause_turn': {
  // Append the partial assistant turn to in-memory messages and immediately
  // re-call the provider with the same options.
  providerMessages = [
    ...providerMessages,
    { role: 'assistant', content: response.content, toolCalls: response.toolCalls ?? [] },
  ];
  continue; // same `for` loop body, no completedTurns++
}
```

This means `maxTurns` only counts user-visible logical turns. A `pause_turn`/`pause_turn`/`end_turn` sequence costs ONE turn against the budget, not three.

**Edge case:** a pathological loop of `pause_turn` forever. Add a safety counter: if the SAME logical turn auto-resumes more than `MAX_PAUSE_RESUMES = 10` times, surface `'failed'` with `stopDetails: { type: 'failed', code: 'pause_turn_loop', message: '...' }`. Pure defense-in-depth; should never fire.

**`pause_turn` is NOT exposed on `RunResult.stopReason`** (per the 2026-05-24 decision). By the time the run returns, the turn either eventually ended cleanly (RunResult is whatever ended it) or the loop-safety counter fired (RunResult is `'failed'`). RunResult consumers don't see the intermediate pause/resume cycle.

### 5.5 `'context_window_exceeded'` — caller decides

Spec is explicit: the runner does NOT auto-compact. It exits with the partial response and the structured stop reason. Caller (subagent job, slash command, web UI) chooses next steps:

- A slash command could invoke `/compact` and retry.
- A subagent job could surface the failure to its parent.
- The web UI could display "context limit reached, click to compact" and pause.

This preserves the current property that compaction is explicit. Auto-compaction can be added later if telemetry shows operators consistently want it. (Out-of-scope per Jesse's "no server-side autocompaction" direction — but this is client-side and would be a separate spec.)

### 5.6 Skipping pending tool calls on refusal / context-exceeded

When `stopReason ∈ {'refusal', 'context_window_exceeded'}` AND the partial assistant turn contains tool_use blocks: the runner does NOT execute them. Two reasons:

1. The tool calls are speculative — the model didn't get to finish reasoning.
2. Executing them and writing their results would commit durable side effects that the conversation didn't agree to.

Concrete change: gate `for (const toolCall of toolCalls)` at `runner.ts:491` on `stopReason === 'tool_use'`. Today the gate is implicit (other stopReason values exit before reaching the loop), but with the new values that have terminal partial content, this becomes explicit.

**The tool_use blocks DO survive in `RunResult.content`** (per the 2026-05-24 decision). The user/caller sees what the model was about to do before being stopped, for transparency. The runner just doesn't execute them.

---

## 6. Durable persistence in `events.jsonl`

`turn_end` events today carry `stopReason: string` (per `event-types.ts:37`, free-form). The string values today match `RunResult.stopReason`.

**Spec:**

1. `turn_end.data.stopReason: LaceStopReason` — typed.
2. `turn_end.data.stopDetails: LaceStopDetails | null` — new field. Optional for backward compat (existing events have no `stopDetails` and that should be treated as `null`).
3. Conversation rebuild (`buildProviderMessagesFromDurableEvents`) does NOT consume `stopReason` for message reconstruction. The field is for replay/telemetry only.

**Backward compatibility for the existing `'max_tokens'` value:**

Existing sessions have `turn_end` events with `stopReason: 'max_tokens'`. Two options:

- **(A)** Migrate-on-read: when the rebuild encounters `stopReason: 'max_tokens'`, treat it as `'max_output_tokens'`. No event rewrite.
- **(B)** Migrate-on-write only: new events use `'max_output_tokens'`; existing events keep `'max_tokens'`. Rebuild handles both.

Recommend **(B)**. Lower-risk. `turn_end` data isn't used to rebuild messages, only for telemetry/UI. Add a `normalizeLegacyStopReason()` helper at any consumer that wants a unified view.

---

## 7. Cross-cutting: `normalizeStopReason` becomes shared logic

Today each provider has its own `normalizeStopReason`. With this spec, the per-provider logic shrinks to a pure mapping table and the runner-side dispatch is centralized.

**Proposed structure:**

`packages/agent/src/providers/stop-reason.ts` (new):

```ts
export interface NormalizedStop {
  stopReason: LaceStopReason;
  stopDetails: LaceStopDetails | null;
}

export function normalizeAnthropicStop(
  stopReason: string | null | undefined,
  stopDetails: Anthropic.RefusalStopDetails | null,
  stopSequence: string | null,
  source: 'anthropic_direct' | 'bedrock'
): NormalizedStop { ... }

export function normalizeOpenAIChatStop(
  finishReason: ChatCompletionFinishReason | null | undefined
): NormalizedStop { ... }

export function normalizeOpenAIResponsesStop(
  status: ResponseStatus,
  incompleteDetails: IncompleteDetails | null,
  error: ResponseError | null,
  refusalEmittedDuringStream: string | null,
  hasFunctionToolCallOutput: boolean
): NormalizedStop { ... }

export function normalizeLMStudioStop(
  stopReason: string | null | undefined
): NormalizedStop { ... }
```

Each provider's `_createStreamingResponseImpl` calls the appropriate normalizer with the raw inputs and pipes the result into `ProviderResponse`. The provider classes don't define their own `normalizeStopReason` overrides anymore.

`base-provider.ts` removes `normalizeStopReason` entirely (it's the wrong layer).

**Tests:** one parametric test file per normalizer (`stop-reason.test.ts`), exercising every row in the §3 tables.

---

## 8. UI and downstream consumer impact

Most consumers don't read `stopReason` today (the runner emits `turn_end` and clients display the final assistant message). The ones that DO:

- **Subagent job → parent agent.** `subagent-job.ts` maps subagent stop reason to job terminal status (`completed` / `failed` / `cancelled`). Currently checks for `'permission_cancelled'`. Needs to also handle `'refusal'`, `'context_window_exceeded'`, `'failed'` → all map to job `'failed'`.
- **Slash commands.** `/compact` could autofire when caller observed `'context_window_exceeded'`. Not in scope for this spec but the hook becomes available.
- **Web UI.** Today renders all stopReasons identically (just shows the assistant text). Refusal and context-exceeded warrant distinct treatment downstream.

This spec doesn't redesign those consumers; it just makes the typed signal available.

---

## 9. Implementation order

One chunk per item, small and revertible:

1. **`LaceStopReason` + `LaceStopDetails` types + `stop-reason.ts` normalizers.** Pure additions. No provider behavior change yet. Tests exercise the §3 tables comprehensively.

2. **Wire normalizers into providers.** Replace existing per-provider `normalizeStopReason` calls with the new shared functions. `ProviderResponse` gets `stopDetails`. Provider behavior is identical for the values they already mapped; new values flow through but the runner ignores them at this stage.

3. **Runner dispatch — terminal cases.** Update `runner.ts` to handle `'refusal'`, `'context_window_exceeded'`, `'max_output_tokens'`, `'stop_sequence'`, `'failed'`. Each one exits the loop with the typed reason and structured details. Skip pending tool calls on refusal / context-exceeded.

4. **Runner dispatch — `pause_turn` auto-resume.** Add the auto-resume branch and the `MAX_PAUSE_RESUMES` safety counter. Doesn't change RunResult shape.

5. **HTTP-400 → `'context_window_exceeded'` classifier.** Wrap the "prompt too long" error class so it surfaces as a stop reason instead of throwing.

6. **OpenAI Responses refusal-item detection.** Scan the stream for `ResponseRefusalDoneEvent` and capture the text. Plumb into the normalizer. (This one might be a bigger change because the current handler doesn't surface refusal events at all.)

7. **Persistence: `stopDetails` on `turn_end` events.** Add the field. Update `event-types.ts`. Verify rebuild doesn't trip on missing field for legacy events.

8. **`max_tokens` → `max_output_tokens` rename.** Update `RunResult` type. Add `normalizeLegacyStopReason()` for any consumer that needs to read old events. Update tests.

9. **Subagent job + slash command consumer updates** (§8).

Steps 1–5 are independent of the Anthropic beta endpoint migration (separate spec). Step 6 stands alone. Steps 7–9 are cleanup.

---

## 10. Risks & rollback

**Risk: false positives on HTTP-400 → `context_window_exceeded` classifier.** A different 400 could be misclassified. Mitigation: explicit whitelist of error-body patterns from Anthropic + OpenAI, defaulting to throw-as-failed if no pattern matches. Tested with fixtures.

**Risk: `pause_turn` infinite loop.** Mitigated by `MAX_PAUSE_RESUMES = 10` safety counter. Pathological case becomes `'failed'` instead of CPU spin.

**Risk: legacy `'max_tokens'` consumers.** Anywhere we compare `stopReason === 'max_tokens'` must be updated or the legacy normalizer must wrap reads. Grep for occurrences before the rename.

**Risk: subagent job status inversion.** If a parent today sees `'stop'` (clean) for a refusal, after this spec it sees `'refusal'` and surfaces a failure. This is the CORRECT behavior, but it's a behavioral change visible in test fixtures and integration tests. Update tests as part of step 9.

**Rollback:** each chunk is independent. If step 4 (`pause_turn` auto-resume) misbehaves, revert just that one — fallback is back to current behavior (collapse to `'end_turn'`).

---

## 11. Out of scope

- Server-side autocompaction (Anthropic beta `compaction` stop reason). Explicitly excluded.
- Client-side auto-compact on `'context_window_exceeded'`. Caller decides. Could be a follow-up.
- Per-refusal-category remediation (e.g. "if `category: 'cyber'`, route to a different model"). Out of scope; we just surface the signal.
- Token-budget pre-flight checks (manually estimating before the call). Separate concern.
- Renaming the existing `'incomplete'` runner-only value (the future-tense-intent heuristic). Confusing because Anthropic and OpenAI both use "incomplete" in their own vocabularies, but the rename has its own compat cost. Punt.

---

## 12. Decisions (resolved 2026-05-24, Jesse)

1. **§5.4 `pause_turn` visibility on `RunResult.stopReason`:** **NOT visible.** Runner transparently auto-resumes; RunResult never exposes it. The only way `pause_turn` reaches RunResult is via the `MAX_PAUSE_RESUMES` safety counter as `'failed'`.

2. **§3.4 OpenAI Responses `tool_use` detection:** **Confirmed.** Promote the existing "output array contains a function tool call" observation from a side-effect of populating `toolCalls` to a first-class stop_reason value, for consistency with the other providers.

3. **§5.6 partial tool calls on refusal:** **Keep them in `RunResult.content`** for transparency — the user/caller sees what the model was about to do before policy intervention. The runner DOES NOT execute them, but the content survives. Same for `'context_window_exceeded'`.

4. **§3.7 HTTP-400 classifier:** **Permission granted.** Proceed with the whitelist-of-patterns approach. Start narrow (Anthropic's `"prompt is too long"` first, OpenAI variants as fixtures become available), default to throw-as-failed when no pattern matches.

5. **§6 backward compat for `'max_tokens'` → `'max_output_tokens'`:** **Leave existing events as-is** (option B). New events use the new name; consumers that read `turn_end` history use a `normalizeLegacyStopReason()` helper. Events are immutable for cache stability.

