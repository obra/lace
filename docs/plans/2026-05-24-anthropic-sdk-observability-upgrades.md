# Anthropic SDK Observability Upgrades

**Status:** Draft spec, 2026-05-24. Pre-implementation.
**Branch:** TBD (suggest `anthropic-sdk-observability`, branched from current main after `pri-1796-container-sharing` lands).
**Inputs:** Anthropic TS SDK 0.98.0 (just upgraded from 0.54 → 0.98 in commit `fae32625d`). The PRI-1796 cache-miss / 400-loop incident on 2026-05-24 (commits `8a785cc2d`, `28985f5f3`). Jesse's directive: features B and C are straightforward and in scope; D (thinking-token-count) NOT needed; A (structured stop_details) is part of the stop-reason work and moved to its own spec.
**Companion spec:** [2026-05-24-stop-reason-harmonization.md](./2026-05-24-stop-reason-harmonization.md). The stop-reason spec covers all stop-signal work across Anthropic and OpenAI providers — that's where `model_context_window_exceeded` (Feature B's payload) gets dispatched. This spec covers the SDK-level migration (beta endpoint, opt-in mechanism, request/response plumbing) that makes Feature B's signal AND Feature C (cache diagnostics) available in the first place.

---

## 0. The framing

We just spent hours debugging a misleading Anthropic 400 ("messages.1298: tool_use ids were found without tool_result blocks") because the SDK and our code give us very little signal about WHY a request was rejected or WHY the cache missed. Two of the four observability betas Anthropic has shipped since we last upgraded would have made the same incident much faster to diagnose:

- **cache-diagnosis** would have told us the cache miss reason on every retry (very different "this was about cache prefix divergence" vs. "this is purely a payload shape rejection").
- **model-context-window-exceeded** would replace our token-counting heuristics with an authoritative server signal.

The cost is a one-time migration from `client.messages.stream()` to `client.beta.messages.stream({ betas: [...] })`. The SDK supports both; the beta endpoint accepts an opt-in `betas` array per request. Beta endpoint payloads have a parallel `Beta*` type hierarchy that's a superset of the base types.

This spec covers the migration and the two observability additions. It does NOT cover:
- Structured stop_details — see the stop-reason harmonization spec.
- Thinking-token-count (0.98) — Jesse explicitly excluded; it requires `thinking.display = 'omitted'` to populate the count, which conflicts with showing thinking text to the user.
- Server-side autocompaction (0.71) — Jesse explicitly excluded.
- Top-level cache control (0.78) — read-up below; recommendation is don't adopt.

---

## 1. Current state

### 1.1 How we call Anthropic today

`packages/agent/src/providers/anthropic-provider.ts`:

- Line 215–225: `_createResponseImpl` calls `this._client.messages.create(requestPayload, { headers: extraHeaders })` for non-streaming.
- Line 285–310: `_createStreamingResponseImpl` calls `this._client.messages.stream(requestPayload, { headers: extraHeaders })` for streaming. This is the hot path; ambient loop always streams.
- Line 219–223: `extraHeaders` comes from `getExtraHeadersForModel(model)` which reads the per-instance catalog's `extra_headers` field — this is how we opt into `context-1m-2025-08-07` for specific models. The mechanism is a free-text string returned to the wire as `anthropic-beta: <comma-list>`.

So we already plumb beta headers per-model. We just don't use the typed `betas: [...]` SDK path, which means the response types don't include any beta-only fields and we'd have to cast `as unknown` to read them.

### 1.2 What we currently surface from a response

`anthropic-provider.ts:316–419` — streaming event handler:

- `event.type === 'message_delta' && event.usage`: emit `token_usage_update` with `{promptTokens, completionTokens, totalTokens}`. We DO log the raw usage including `cache_creation_input_tokens`, `cache_read_input_tokens`, and the per-TTL `cache_creation.ephemeral_{5m,1h}_input_tokens` breakdown.
- `event.type === 'content_block_start' && content_block.type === 'thinking'`: emit `thinking_start` to UI.
- `event.type === 'content_block_delta' && delta.type === 'thinking_delta'`: emit `thinking_delta` with `{text: thinkingDelta.thinking}` only.
- `event.type === 'content_block_stop' && currentBlockType === 'thinking'`: emit `thinking_end`.
- Final `message` event: build the `ProviderResponse` with `stopReason` normalized through `normalizeStopReason()`.

### 1.3 Where we'd surface diagnostics

- `packages/agent/src/utils/logger.ts` — our structured logger. INFO/DEBUG/WARN/ERROR.
- `packages/agent/src/utils/provider-logging.ts` — `logProviderRequest` / `logProviderResponse` (truncating helpers).
- The `ProviderResponse` shape (`packages/agent/src/providers/base-provider.ts`) — add new optional fields for structured diagnostics so the runner can include them in turn telemetry.

---

## 2. The migration: beta endpoint

### 2.1 Why we need it

`client.messages.stream()` returns `Message` typed events. The beta-only fields (`diagnostics.cache_miss_reason`, the `BetaStopReason.model_context_window_exceeded` value) are typed on `BetaMessage` and friends. To get them typed AND on the wire we have to call `client.beta.messages.stream({ ...params, betas: [...] })`.

The base endpoint also accepts beta headers (we already use `anthropic-beta: context-1m-...`), so technically we could stay on the base endpoint and cast. We won't — typed access is the whole point of upgrading and the runtime cost of switching is one line.

### 2.2 What changes

In `anthropic-provider.ts`:

- Line 215: `this._client.messages.create(...)` → `this._client.beta.messages.create({ ...requestPayload, betas })`.
- Line 287: `this._client.messages.stream(...)` → `this._client.beta.messages.stream({ ...requestPayload, betas })`.
- `betas` is `BetaAPI.AnthropicBeta[]` (union of literal strings). Build it from the union of:
  - Model-level betas (from catalog; today `context-1m-2025-08-07`).
  - Globally-enabled observability betas (see §5).
  - Eventually: per-call opt-ins from request options.

The result type changes from `MessageStream` → `BetaMessageStream`. Event payloads change from `Message`/`MessageStreamEvent` to `BetaMessage`/`BetaRawMessageStreamEvent`. Field access stays largely the same — the beta types are supersets.

### 2.3 What stays the same

- `convertToAnthropicFormat` produces `Anthropic.MessageParam[]` which is structurally identical to `Anthropic.BetaMessageParam[]` for the blocks we use (text, image, tool_use, tool_result). Same shape, narrower type. We may need to widen the return type to `Anthropic.BetaMessageParam[]` or accept the cast.
- `attachMessageCacheBreakpoints` and `enforceBreakpointBudget` in `cache-control.ts` operate on content blocks generically and don't care about message-level type. Unchanged.
- `markLastToolForCaching` operates on tool definitions, also unchanged.

### 2.4 Risk

Two known concerns:

1. **Bedrock provider** (`bedrock-provider.ts`) uses `@anthropic-ai/bedrock-sdk`, NOT `@anthropic-ai/sdk`. Bedrock SDK declares `>=0.50.3 <1` on the base SDK and routes through AWS. **Bedrock does NOT have a parallel `client.beta.messages` namespace** — beta features are passed only via `anthropic-beta` header on requests, and response shapes don't include beta-only fields. So this migration is **Anthropic-direct-only**. Bedrock stays on the base path. Both provider implementations diverge slightly more, but they were already different.

2. **Provider instance configuration**: the per-instance catalog already supports `extra_headers` for the 1M-context opt-in. We have to ensure the new `betas[]` argument doesn't duplicate or conflict with the legacy header path. Plan: when the instance is Anthropic-direct, parse the legacy `extra_headers["anthropic-beta"]` value into `betas[]` and stop sending the header separately. When the instance is Bedrock, keep the header path.

---

## 3. Feature B: model-context-window-exceeded (0.66)

### 3.1 What it is

Beta header: `model-context-window-exceeded-2025-08-26`. Adds `'model_context_window_exceeded'` to `BetaStopReason`. When the model's input would exceed the context window, the server returns a successful response (HTTP 200) with this stop reason instead of failing with a 400 like today.

That's the authoritative signal we currently lack. Today we either:
- Pre-check with our `estimateProviderTokens()` heuristic (lossy), OR
- Hit a 400 (`prompt is too long`) and the agent crashes the turn.

### 3.2 What to do — SDK plumbing only

The stop-reason dispatch (what runner does with this signal) lives in the stop-reason harmonization spec, §3.1 (the canonical normalization table) and §5.1 (runner action). This spec only covers the SDK-side plumbing:

- Add `'model-context-window-exceeded-2025-08-26'` to the global observability-betas list (see §5).
- When the beta is enabled, the `BetaStopReason` union widens to include `'model_context_window_exceeded'`. Anthropic-direct's normalizer (per the stop-reason spec §3.1) maps it to canonical `'context_window_exceeded'` with `stopDetails.source = 'anthropic_beta_stop_reason'`.
- That's it for THIS spec. Runner behavior is the stop-reason spec's concern.

### 3.3 Tests

- Unit: with the beta enabled, the provider passes `'model-context-window-exceeded-2025-08-26'` in the `betas[]` array on every request.
- Unit: with the beta disabled, the literal value never appears in `betas[]`.
- Integration: stub Anthropic beta endpoint to return `stop_reason: 'model_context_window_exceeded'`; assert `ProviderResponse.stopReason === 'context_window_exceeded'` and `stopDetails.source === 'anthropic_beta_stop_reason'`. (This test exercises both this spec's plumbing and the stop-reason spec's normalizer.)

---

## 4. Feature C: cache diagnostics (0.96)

### 4.1 What it is

Beta header: `cache-diagnosis-2026-04-07`. Adds two API affordances:

**Request side** — `BetaDiagnosticsParam`:
```ts
{ diagnostics?: { previous_message_id?: string | null } }
```
Pass the `id` (`msg_…`) of this client's PREVIOUS response. Server compares that request's prompt-fingerprint to the current one and reports why the cache prefix couldn't be reused.

**Response side** — `BetaDiagnostics`:
```ts
{
  diagnostics?: {
    cache_miss_reason:
      | { type: 'model_changed';            cache_missed_input_tokens: number }
      | { type: 'system_changed';           cache_missed_input_tokens: number }
      | { type: 'tools_changed';            cache_missed_input_tokens: number }
      | { type: 'messages_changed';         cache_missed_input_tokens: number }
      | { type: 'previous_message_not_found' }
      | { type: 'unavailable' }
      | null
  }
}
```

When the cache hits cleanly, `cache_miss_reason` is `null`. When it misses, the type tells us which input changed and how many tokens we'd have saved.

### 4.2 What to do

**4.2.1 — Track previous `responseId` via a unified field.**

`anthropic-provider.ts` already tracks `responseId` per call (line 363: `lastResponseId = response.responseId`). The runner threads it forward via `nextRequestOptions.openaiResponseId` — a provider-specific field. Per the 2026-05-24 decision, unify this into a single provider-agnostic field.

- Rename `RequestOptions.openaiResponseId` → `RequestOptions.previousResponseId` (string | null | undefined). One field across all providers.
- `runner.ts:359`: pass `{ previousResponseId: lastResponseId }` into the next `createStreamingResponse` call. Same plumbing for Anthropic-direct, OpenAI, future providers.
- `anthropic-provider.ts._createRequestPayload`: when the cache-diagnostics beta is enabled, set `payload.diagnostics = { previous_message_id: opts?.previousResponseId ?? null }`. Pass `null` on the first turn of a session to opt in without comparing to anything.
- `openai-provider.ts`: rename internal `openaiResponseId` references to consume the unified `previousResponseId`. Wire it through to the OpenAI Responses API's existing `previous_response_id` field.
- Bedrock: the field is read but ignored (no cache-diagnostics beta available).

**4.2.2 — Capture and emit `cache_miss_reason`.**

- `ProviderResponse` (new field): `cacheMissReason?: BetaCacheMissReason | null`. Discriminated union shape matches the SDK type; we pass it through verbatim.
- `anthropic-provider.ts` final message event (line 369–419): if `message.diagnostics?.cache_miss_reason`, set `response.cacheMissReason = message.diagnostics.cache_miss_reason`.
- Log at INFO with `{type, cache_missed_input_tokens?}`. This is the line that would have saved us during the PRI-1796 incident.

**4.2.3 — Persist in `turn_end`.**

Per the 2026-05-24 decision, persist `cacheMissReason` durably on the `turn_end` event so retrospective analysis (cache hit rate over time, miss-reason histogram per session) is available offline.

- `turn_end.data.cacheMissReason: BetaCacheMissReason | null` — new optional field. Existing events treat absence as `null`.
- `event-types.ts`: extend the `turn_end` data shape.
- `runner.ts`: when writing the `turn_end` event (`:559`), include `cacheMissReason` from the LAST `ProviderResponse` of the turn. (One turn can have multiple provider calls; only the most recent miss-reason is meaningful for "did this turn's prefix cache?" — the inner calls reused prefixes from the same turn and won't have new miss reasons against the parent.)
- Conversation rebuild (`buildProviderMessagesFromDurableEvents`) does NOT consume `cacheMissReason`. Read-only telemetry field.

### 4.3 What we ALREADY get without this beta

For reference, since this is partially overlapping with existing telemetry:

- `usage.cache_creation_input_tokens` — already logged. Tokens written to cache.
- `usage.cache_read_input_tokens` — already logged. Tokens served from cache.
- `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` — already logged. Per-TTL breakdown of cache writes.

What's NEW with this beta:
- A miss "reason" classification (model/system/tools/messages/previous-not-found/unavailable).
- An advisory "tokens you would have saved" count on miss.

### 4.4 Tests

- Unit: provider request payload includes `diagnostics.previous_message_id` when beta enabled and opts ID is set.
- Unit: provider request omits `diagnostics` entirely when beta is disabled.
- Unit: provider extracts `cache_miss_reason` from final message into `ProviderResponse.cacheMissReason`.
- Unit: provider does NOT set `cacheMissReason` when the response has no diagnostics field (cache hit case).
- Integration: end-to-end with a stub server that returns `cache_miss_reason: messages_changed` — assert it shows up in the response and gets logged at INFO with the expected structured fields.

---

## 5. Cross-cutting: how to enable betas

### 5.1 Where the list lives

Today: `getExtraHeadersForModel(model)` in `anthropic-provider.ts:515` reads catalog `extra_headers` per-model. This is the only opt-in point.

Going forward we need three sources of betas:

1. **Per-model (existing).** Continues to come from catalog. Example: `context-1m-2025-08-07` only for models that support it.
2. **Per-instance, global observability flag.** New. Default ON for Anthropic-direct, OFF for Bedrock (Bedrock can't use beta endpoint). Driven by a single boolean in the instance config: `observability_betas_enabled?: boolean`. When true, includes:
   - `cache-diagnosis-2026-04-07`
   - `model-context-window-exceeded-2025-08-26`
3. **Per-call (future).** RequestOptions could accept additional betas for one-off opt-ins. Out of scope now; mention as extension point.

### 5.2 The single new helper

Replace `getExtraHeadersForModel(model)` with:

```ts
private getBetasForRequest(model: string, opts?: RequestOptions): AnthropicBeta[] {
  const fromCatalog = parseBetasFromCatalog(this.catalog, model);  // existing extra_headers
  const fromInstance = this._config.observability_betas_enabled
    ? OBSERVABILITY_BETAS
    : [];
  const fromOpts = opts?.additionalBetas ?? [];
  return Array.from(new Set([...fromCatalog, ...fromInstance, ...fromOpts]));
}

const OBSERVABILITY_BETAS = [
  'cache-diagnosis-2026-04-07',
  'model-context-window-exceeded-2025-08-26',
] as const;
```

Then at the call site: `client.beta.messages.stream({ ...payload, betas: this.getBetasForRequest(model, opts) })`.

The legacy `extra_headers["anthropic-beta"]` path goes away for Anthropic-direct. Bedrock-direct keeps it.

### 5.3 Default

Anthropic-direct: `observability_betas_enabled` defaults to `true`. The cost is zero — these are read-only observability features; the server reads them but doesn't change behavior other than populating extra response fields. The benefit is uniform diagnostics across all our agents from day one. Operators who want to disable can flip the flag per-instance.

Bedrock-direct: leave the flag as `undefined` / not-applicable. Bedrock doesn't have the beta endpoint.

---

## 6. Sidebar: top-level cache_control (0.78) — read-up

### 6.1 What it is

Anthropic SDK 0.78 added a top-level optional field on `MessageCreateParamsBase`:

```ts
/**
 * Top-level cache control automatically applies a cache_control marker to the last
 * cacheable block in the request.
 */
cache_control?: CacheControlEphemeral | null;
```

When set, the server places a cache breakpoint on the last cacheable block automatically. The marker is the same `{type: 'ephemeral', ttl: '5m' | '1h'}` we already place manually.

### 6.2 What this DOES replace in our code

The "rolling tail" half of our two-marker strategy in `cache-control.ts:attachMessageCacheBreakpoints` — the marker we place on the last cacheable block of the last message. About 30 lines of logic, plus the part of the test file that exercises tail placement.

### 6.3 What this DOES NOT replace

The "stable anchor" half. Our anchor lives `ANCHOR_OFFSET_RAW_BLOCKS` blocks back from the tail and exists specifically to defeat Anthropic's 20-raw-block lookback window. Without the anchor, when a turn pushes the tail forward by more than 20 raw blocks, the cache lookup misses everything older than the new tail.

Top-level cache_control only places ONE marker (the tail). For the anchor we'd still place a manual `cache_control` on a content block, and we'd be mixing the two mechanisms in one request.

We also use cache markers on:
- `system` prompt (separate parameter, not in messages array)
- last tool definition (`markLastToolForCaching`)

Top-level cache_control doesn't help with either.

### 6.4 Recommendation

**Don't adopt.** Top-level `cache_control` solves the cheapest part of our problem (which block is "the tail") and leaves the load-bearing part (the anchor at the right offset to defeat the 20-block window) for us to compute. The migration would delete ~30 LOC and introduce a mixed-mechanism request shape. Not worth it.

Revisit only if Anthropic ships an "anchor" API or extends the lookback window such that the anchor becomes unnecessary.

---

## 7. Implementation order

Sequenced relative to the stop-reason harmonization spec. The stop-reason spec lands first (or at least its types + normalizer scaffolding) because Feature B's payload uses the canonical `LaceStopReason` and `LaceStopDetails` types.

1. **Stop-reason types + normalizer scaffolding** (from companion spec, step 1). Pure additions.
2. **Beta endpoint migration scaffolding.** Switch `client.messages` → `client.beta.messages`. Add `getBetasForRequest`. Move `context-1m-2025-08-07` from `extra_headers` to `betas[]`. No new features yet — just the path. Verify nothing regresses.
3. **Feature B plumbing.** Enable `model-context-window-exceeded-2025-08-26`. Wire the new beta `BetaStopReason` value through the Anthropic normalizer (the stop-reason spec's table already handles it; this step just ensures the beta is actually in the betas[] array).
4. **Feature C plumbing.** Enable `cache-diagnosis-2026-04-07`. Track previous_message_id. Capture `cache_miss_reason`. Log at INFO. Add `ProviderResponse.cacheMissReason` field.
5. (Companion spec, runner dispatch steps) — runner handles `'context_window_exceeded'` via the stop-reason spec's §5.1.

Each chunk is independently testable and revertible.

---

## 8. Risks & rollback

**Risk: Bedrock divergence.** This spec leaves Bedrock on the base endpoint. The two provider code paths drift further. Acceptable — they were already different (different SDKs, different auth, different model-name conventions). Documented in §2.4.

**Risk: SDK churn.** Anthropic SDK is pre-1.0 (latest 0.98.0). Beta endpoints have been stable for months but no formal commitment. Mitigation: pin to a known-good version (`0.98.0` exact, not `^0.98.0`) for the duration of this work; revisit at the next planned dependency sweep.

**Risk: Cost.** None. Both observability betas are read-only — they don't change billing. Cache diagnostics costs ~zero extra wire bytes per response. `previous_message_id` is one string field per request.

**Rollback:** Each chunk is a small, scoped commit. Per-instance feature flag (`observability_betas_enabled`) lets us turn off the observability set without a code change in case of incident. The migration to `client.beta.messages` is rollback-able by reverting the call-site change.

---

## 9. Out of scope

- **Structured `stop_details` (Feature A from earlier scoping).** Moved entirely to the stop-reason harmonization spec, which covers Anthropic refusal details + OpenAI Chat `content_filter` + OpenAI Responses refusal items + `incomplete_details` + `failed.error.code` all in one place.
- **Thinking-token-count (Feature D, 0.98).** Excluded per Jesse — requires `thinking.display = 'omitted'` to populate the count, which would mean losing the streaming thinking text in the UI. Not worth the tradeoff.
- **Server-side autocompaction (0.71).** Explicitly excluded per Jesse.
- **Top-level cache_control (0.78).** Read-up complete in §6; not adopting.
- **Memory tools (0.79, 0.91).** Separate evaluation.
- **Managed Agents (0.86, 0.91, 0.95).** Separate evaluation.
- **Bedrock parity.** Bedrock doesn't expose the beta endpoint; we accept the divergence.
- **Replacing `cache-control.ts`.** No.

---

## 10. Decisions (resolved 2026-05-24, Jesse)

1. **Per-call `additionalBetas` (§5.1, source #3):** **Punt.** YAGNI until we have a concrete consumer. The two enabled-by-default betas + the per-model catalog betas cover everything we need today.

2. **Persist `cacheMissReason` on `turn_end` events:** **Yes.** Durable telemetry for retrospective analysis (§4.2.3). Implementation detail captured in the spec body.

3. **Unify `previous_message_id` plumbing:** **Yes — unify on `RequestOptions.previousResponseId`** (§4.2.1). Rename the existing OpenAI-specific `openaiResponseId` to the provider-agnostic name. One field across all providers.

