# Anthropic SDK Observability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Anthropic-direct calls from `client.messages.*` to
`client.beta.messages.*` with a typed `betas[]` opt-in array, enable the
`model-context-window-exceeded-2025-08-26` and `cache-diagnosis-2026-04-07`
betas by default for Anthropic-direct instances, plumb `previous_response_id`
and `cache_miss_reason` end-to-end, and persist `cacheMissReason` on `turn_end`
events for retrospective analysis.

**Architecture:** Single `getBetasForRequest(model, opts)` helper builds the
`betas[]` from three sources (per-model catalog, per-instance global
observability flag, per-call options). Anthropic provider's two call sites
(streaming + non-streaming) switch to the beta endpoint. The `cache-diagnosis`
beta requires threading the previous response's `id` forward in
`RequestOptions`; rename the existing OpenAI-specific `openaiResponseId` to
provider-agnostic `previousResponseId` and use it across all providers.
`ProviderResponse` gains an optional `cacheMissReason` field; runner writes it
onto `turn_end.data.cacheMissReason`. Bedrock provider stays on the base path
(`@anthropic-ai/bedrock-sdk` has no `client.beta` namespace).

**Tech Stack:** `@anthropic-ai/sdk@0.98.0` (already upgraded), TypeScript strict
mode, Vitest. Existing provider classes in `packages/agent/src/providers/`.

**Companion specs:**

- [2026-05-24-anthropic-sdk-observability-upgrades.md](./2026-05-24-anthropic-sdk-observability-upgrades.md)
  — design rationale and decisions.
- [2026-05-24-stop-reason-harmonization.md](./2026-05-24-stop-reason-harmonization.md)
  — where `'context_window_exceeded'` stop dispatch lives.
- [2026-05-24-stop-reason-harmonization-implementation.md](./2026-05-24-stop-reason-harmonization-implementation.md)
  — implementation prerequisites.

**Sequencing:** stop-reason chunks A and B MUST land first. The Anthropic
normalizer in `stop-reason.ts` is where `model_context_window_exceeded` becomes
`'context_window_exceeded'`. This plan only adds the beta header; the response
normalization is upstream.

---

## 1. Summary

We just upgraded `@anthropic-ai/sdk` from 0.54 → 0.98 (commit `fae32625d`).
Three Anthropic features became available that would have made the PRI-1796
4-hour debug session a 15-minute one:

- `model-context-window-exceeded` — server signal instead of HTTP 400.
- `cache-diagnosis` — server tells us WHY a cache prefix didn't match.
- (out of scope) `thinking-token-count`, server-side autocompaction.

Both in-scope features require calling `client.beta.messages.*` with
`betas: [...]`. The base endpoint accepts beta headers but the SDK types don't
expose beta-only response fields. We migrate Anthropic-direct fully to the beta
endpoint. Bedrock stays on the base endpoint (no `client.beta` exists in
`@anthropic-ai/bedrock-sdk`).

This plan is three chunks (I–K). Each is independently testable and revertible.
The whole set lands cleanly after the stop-reason plan's chunks A and C
complete.

---

## 2. Current state — code references

- `packages/agent/src/providers/anthropic-provider.ts:215` — non-streaming call:
  `this._client.messages.create(requestPayload, { headers: extraHeaders })`.
- `packages/agent/src/providers/anthropic-provider.ts:287` — streaming call:
  `this._client.messages.stream(requestPayload, { headers: extraHeaders })`.
- `packages/agent/src/providers/anthropic-provider.ts:219–223` — `extraHeaders`
  built from `getExtraHeadersForModel(model)` which reads catalog
  `extra_headers`. This is how the 1M-context beta (`context-1m-2025-08-07`) is
  currently opted into.
- `packages/agent/src/providers/anthropic-provider.ts:515` —
  `getExtraHeadersForModel` definition. Returns a `{[k:string]:string}` of raw
  headers.
- `packages/agent/src/providers/base-provider.ts` — `RequestOptions` type. Has
  `openaiResponseId?: string | null` (OpenAI-specific naming).
- `packages/agent/src/providers/openai-provider.ts` — references
  `openaiResponseId` from `RequestOptions` and threads it to the Responses API's
  `previous_response_id` field.
- `packages/agent/src/core/conversation/runner.ts:359–363` — tracks
  `lastResponseId` from each provider response, passes it via
  `nextRequestOptions.openaiResponseId` to the next call.
- `packages/agent/src/storage/event-types.ts:37` — `turn_end` event shape. After
  stop-reason chunk G it includes `stopDetails`; this plan adds
  `cacheMissReason`.
- `packages/agent/package.json` — `"@anthropic-ai/sdk": "^0.98.0"`.

---

## 3. Target state (chunk mapping)

| Chunk | Surface                                                                                                                                                                                                                                                                                                                                                               | Behavior change                                                                                                                                                                                                                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I     | Anthropic provider switches to `client.beta.messages.*` with typed `betas[]`. `getBetasForRequest` helper. Per-instance `observability_betas_enabled` config (default true for Anthropic-direct). 1M-context beta migrated from `extra_headers` to `betas[]`.                                                                                                         | None observable. Same model behavior, same response shape externally. Internal typing tightens.                                                                                                                                                                                                                                                   |
| J     | `'model-context-window-exceeded-2025-08-26'` in default observability betas.                                                                                                                                                                                                                                                                                          | When the context window would overflow, Anthropic returns a 200 with `stop_reason: 'model_context_window_exceeded'` instead of throwing 400. The stop-reason normalizer (already implemented in stop-reason plan chunk A) maps this to `'context_window_exceeded'`. Runner (already implemented in stop-reason plan chunk C) surfaces it cleanly. |
| K     | `'cache-diagnosis-2026-04-07'` in default observability betas. `RequestOptions.openaiResponseId` renamed to `previousResponseId`. Request includes `diagnostics.previous_message_id` when beta enabled. Response's `diagnostics.cache_miss_reason` captured to `ProviderResponse.cacheMissReason` and persisted to `turn_end.data.cacheMissReason`. INFO log on miss. | Cache misses on Anthropic-direct now emit structured diagnostics. Cache hits are unchanged.                                                                                                                                                                                                                                                       |

---

## 4. Chunk I: Beta endpoint migration scaffolding (TDD)

**Files:**

- Modify: `packages/agent/src/providers/anthropic-provider.ts`
- Create:
  `packages/agent/src/providers/anthropic/__tests__/beta-endpoint.test.ts`
- Create: `packages/agent/src/providers/anthropic/betas.ts` (small helper
  module)
- Create: `packages/agent/src/providers/anthropic/__tests__/betas.test.ts`
- Update: `packages/agent/src/providers/anthropic/types.ts` or wherever the
  per-instance config type lives — add `observability_betas_enabled?: boolean`.

**Acceptance:**

- All call sites in `anthropic-provider.ts` use `this._client.beta.messages.*`.
- A new `getBetasForRequest(model, opts?)` returns the deduped union of
  per-model catalog betas + global observability betas + per-call betas.
- With `observability_betas_enabled: false`, the returned array contains only
  catalog betas (i.e. `['context-1m-2025-08-07']` for models that have it, `[]`
  otherwise).
- With the flag true (default), the array additionally contains
  `cache-diagnosis-2026-04-07` and `model-context-window-exceeded-2025-08-26`.
- The `extra_headers` `anthropic-beta` value is no longer sent for
  Anthropic-direct (Bedrock keeps the header path).
- Existing provider tests pass. Existing 1M-context behavior preserved.

### Tasks

- [ ] **I.1 — Tests FIRST for `getBetasForRequest`.** In `betas.test.ts`:
  - Default config + model with no catalog betas →
    `['cache-diagnosis-2026-04-07', 'model-context-window-exceeded-2025-08-26']`.
  - Default config + 1M-context-enabled model → above plus
    `'context-1m-2025-08-07'`.
  - `observability_betas_enabled: false` + 1M model →
    `['context-1m-2025-08-07']` only.
  - `observability_betas_enabled: false` + plain model → `[]`.
  - `opts.additionalBetas: ['some-future-beta']` is added (and deduped).
  - Duplicate entries across sources are deduped (set semantics).

- [ ] **I.2 — Implement `betas.ts`.**

  ```ts
  export const OBSERVABILITY_BETAS = [
    'cache-diagnosis-2026-04-07',
    'model-context-window-exceeded-2025-08-26',
  ] as const;

  export function parseCatalogBetas(
    catalog: ProviderCatalog,
    model: string
  ): AnthropicBeta[] {
    // Read catalog's per-model extra_headers["anthropic-beta"], split on comma+trim
    // Return empty if absent.
  }

  export function getBetasForRequest(
    catalog: ProviderCatalog,
    model: string,
    config: { observability_betas_enabled?: boolean },
    opts?: RequestOptions
  ): AnthropicBeta[] {
    const fromCatalog = parseCatalogBetas(catalog, model);
    const fromInstance =
      config.observability_betas_enabled !== false
        ? [...OBSERVABILITY_BETAS]
        : [];
    const fromOpts = opts?.additionalBetas ?? []; // YAGNI per decision; the field can exist on the type but stay undocumented
    return Array.from(new Set([...fromCatalog, ...fromInstance, ...fromOpts]));
  }
  ```

  Note the inversion: `observability_betas_enabled !== false` defaults to ON.
  Operators have to explicitly set false to disable.

- [ ] **I.3 — Tests FIRST for the call-site migration.** In
      `beta-endpoint.test.ts`:
  - Mock `this._client.beta.messages.stream` (NOT
    `this._client.messages.stream`). Assert the streaming path uses the beta
    namespace.
  - Same for `beta.messages.create`.
  - Assert that the request payload passed to the beta endpoint includes
    `betas: [...]` (typed correctly).
  - Assert that `extra_headers["anthropic-beta"]` is NOT sent as a separate
    header (it's now in `betas[]`).
  - Bedrock provider tests still pass unchanged — they don't use this path.

- [ ] **I.4 — Migrate call sites in `anthropic-provider.ts`.**
  - Line 215: `this._client.messages.create(...)` →
    `this._client.beta.messages.create({ ...requestPayload, betas })`.
  - Line 287: `this._client.messages.stream(...)` →
    `this._client.beta.messages.stream({ ...requestPayload, betas })`.
  - Compute `betas` once at the top of `_createRequestPayload`:
    `const betas = getBetasForRequest(this.catalog, model, this._config, opts);`.
  - REMOVE the `extra_headers` overlay (line 219–223) for Anthropic-direct. The
    `betas[]` array replaces it.
  - DO NOT touch `bedrock-provider.ts` — Bedrock keeps its `extra_headers` path.

- [ ] **I.5 — Widen response handling for `Beta*` types.** The streaming event
      types change from `MessageStreamEvent` to `BetaRawMessageStreamEvent`. The
      `Message` type becomes `BetaMessage`. For each field access in the stream
      handler (`anthropic-provider.ts:316–419`), update type assertions
      accordingly. Most field names are identical — `BetaMessage.stop_reason`,
      `BetaMessage.stop_details`, `BetaMessage.usage`, etc. Casts to
      `BetaContentBlock` instead of `ContentBlock` where the SDK demands.

- [ ] **I.6 — Update `convertToAnthropicFormat` return type.** Currently returns
      `Anthropic.MessageParam[]`. The beta endpoint accepts
      `Anthropic.BetaMessageParam[]`. Either widen the return type (preferred —
      same shape) OR cast at the call site. Test that the format-converter tests
      still pass after the widen.

- [ ] **I.7 — Add `observability_betas_enabled` to provider config.** Find where
      Anthropic instance config is typed (likely `anthropic/types.ts` or
      `provider-registry.ts`). Add the optional boolean. Default behavior in
      `getBetasForRequest`: undefined or true = enabled, explicit false =
      disabled.

- [ ] **I.8 — Manual smoke test.** Build, deploy to a test Anthropic-direct
      instance, send one prompt. Verify in logs:
  - `ANTHROPIC REQUEST METADATA` includes
    `betas: ["cache-diagnosis-2026-04-07", "model-context-window-exceeded-2025-08-26", ...]`.
  - No `anthropic-beta` header is sent separately on Anthropic-direct.
  - Response still parses; no crash.

- [ ] **I.9 — Build + run all tests + commit.** Commit:
      `feat(anthropic-provider): migrate to client.beta.messages with typed betas[]`.

---

## 5. Chunk J: Feature B — `model-context-window-exceeded` (TDD)

**Files:**

- Tests already exist for the normalizer (stop-reason plan chunk A covers
  `model_context_window_exceeded` → `'context_window_exceeded'`).
- Tests already exist for runner dispatch (stop-reason plan chunk C covers the
  runner exit path).
- This chunk adds ONLY an integration test verifying the beta is requested AND
  the signal flows through.

**Acceptance:**

- `'model-context-window-exceeded-2025-08-26'` appears in the `betas[]` array on
  every Anthropic-direct request when `observability_betas_enabled !== false`.
- When the Anthropic stub returns
  `stop_reason: 'model_context_window_exceeded'`, the runner exits with
  `RunResult.stopReason === 'context_window_exceeded'`,
  `stopDetails.source === 'anthropic_beta_stop_reason'`, and partial assistant
  content is preserved.

### Tasks

- [ ] **J.1 — Verify beta is in default set.** This is technically already
      covered by chunk I.1's test cases (one of them asserts
      `OBSERVABILITY_BETAS` includes both entries). Add an explicit assertion:
      `expect(OBSERVABILITY_BETAS).toContain('model-context-window-exceeded-2025-08-26')`.
      Cheap regression guard if someone removes it later.

- [ ] **J.2 — Integration test FIRST.** New test file
      `packages/agent/src/providers/anthropic/__tests__/context-window-exceeded.integration.test.ts`.
      Stub Anthropic beta endpoint to return:

  ```json
  {
    "id": "msg_xxx",
    "type": "message",
    "role": "assistant",
    "content": [{"type": "text", "text": "I'll start by..."}],
    "stop_reason": "model_context_window_exceeded",
    "stop_details": null,
    "usage": {"input_tokens": 199000, "output_tokens": 23, ...}
  }
  ```

  Run through the full provider → runner pipeline. Assert:
  - `ProviderResponse.stopReason === 'context_window_exceeded'`.
  - `ProviderResponse.stopDetails === {type: 'context_window_exceeded', source: 'anthropic_beta_stop_reason'}`.
  - `RunResult.stopReason === 'context_window_exceeded'`.
  - `RunResult.content` contains the partial text `'I\'ll start by...'`.
  - No tool calls were executed (none were emitted).

- [ ] **J.3 — Verify the test passes** with the changes from chunk I in place.
      No further code changes needed in this chunk — the normalizer (stop-reason
      plan A) and runner dispatch (stop-reason plan C) already handle the
      signal. This chunk is essentially a regression test that the wiring is
      complete.

- [ ] **J.4 — Manual smoke (optional).** Trigger a real context-window overflow
      on a test Anthropic-direct instance by sending a huge prompt. Confirm
      Ada's runner exits cleanly with `'context_window_exceeded'` instead of
      crashing on a 400. Document the test case in a comment.

- [ ] **J.5 — Commit.** Commit:
      `feat(anthropic-provider): integration test for model_context_window_exceeded signal`.
      (Behavior change is from chunks A+C+I; this commit just adds the
      end-to-end verification.)

---

## 6. Chunk K: Feature C — cache diagnostics (TDD)

**Files:**

- Modify: `packages/agent/src/providers/base-provider.ts` (rename
  `RequestOptions.openaiResponseId` → `previousResponseId`; add
  `ProviderResponse.cacheMissReason`)
- Modify: `packages/agent/src/providers/anthropic-provider.ts` (set
  `diagnostics.previous_message_id` in request payload when beta enabled;
  capture `cache_miss_reason` from final message)
- Modify: `packages/agent/src/providers/openai-provider.ts` (rename consumption
  of `openaiResponseId` → `previousResponseId`)
- Modify: `packages/agent/src/core/conversation/runner.ts` (rename in
  `nextRequestOptions` usage; pass `cacheMissReason` through to `turn_end`)
- Modify: `packages/agent/src/storage/event-types.ts` (extend `turn_end` data
  shape with `cacheMissReason`)
- Create:
  `packages/agent/src/providers/anthropic/__tests__/cache-diagnosis.test.ts`

**Acceptance:**

- `RequestOptions.previousResponseId` is the single field across all providers
  (rename of `openaiResponseId`).
- When Anthropic-direct cache-diagnosis beta is enabled and
  `opts.previousResponseId` is set, the request payload includes
  `diagnostics: {previous_message_id: <id>}`.
- When the response's final message has `diagnostics.cache_miss_reason`, the
  provider sets `ProviderResponse.cacheMissReason` and emits an INFO log with
  structured fields.
- `turn_end.data.cacheMissReason` is persisted on every Anthropic-direct turn
  (null when no miss).
- All existing OpenAI plumbing still works under the renamed field.

### Tasks

- [ ] **K.1 — Test FIRST: rename `openaiResponseId` → `previousResponseId`.**
      Search-and-rename test. Verify:
  - `RequestOptions.previousResponseId` is the field name.
  - OpenAI provider reads it from opts and threads to `previous_response_id` in
    the Responses API request.
  - Anthropic provider reads it from opts.
  - Bedrock provider reads it (ignores it — no beta endpoint, no diagnostics).

- [ ] **K.2 — Rename in `base-provider.ts` `RequestOptions`.** Single rename of
      the field. The type widens slightly (it's now used for two purposes),
      document with a comment:

  ```ts
  /**
   * The previous request's response id, threaded forward for provider features
   * that compare requests across turns:
   * - OpenAI Responses API: sent as `previous_response_id` for conversation chaining.
   * - Anthropic cache-diagnosis beta: sent as `diagnostics.previous_message_id`
   *   so the server can report cache_miss_reason vs the previous request.
   */
  previousResponseId?: string | null;
  ```

- [ ] **K.3 — Update OpenAI provider.** Find every `openaiResponseId` reference
      in `openai-provider.ts` (likely a small number — maybe 3-5). Rename. Tests
      should be unaffected if they use the field name; update if needed.

- [ ] **K.4 — Update runner.** In `runner.ts:359`, the
      `nextRequestOptions = lastResponseId ? { openaiResponseId: lastResponseId } : undefined`.
      Rename to `previousResponseId`.

- [ ] **K.5 — Add `ProviderResponse.cacheMissReason` field.** In
      `base-provider.ts`:

  ```ts
  // From @anthropic-ai/sdk@0.98.0:
  //   BetaCacheMissReason = BetaCacheMissModelChanged | BetaCacheMissSystemChanged
  //                       | BetaCacheMissToolsChanged | BetaCacheMissMessagesChanged
  //                       | BetaCacheMissPreviousMessageNotFound | BetaCacheMissUnavailable
  cacheMissReason?: BetaCacheMissReason | null;
  ```

  Import the type from the SDK directly. Non-Anthropic providers leave the field
  undefined (or set explicit null).

- [ ] **K.6 — Test FIRST: request payload includes diagnostics when beta
      enabled.** In `cache-diagnosis.test.ts`:
  - With `observability_betas_enabled !== false` and
    `opts.previousResponseId: 'msg_prev_123'`, assert the payload to
    `beta.messages.create` includes
    `diagnostics: {previous_message_id: 'msg_prev_123'}`.
  - With `previousResponseId` unset (first turn of session), assert
    `diagnostics: {previous_message_id: null}` is sent (opt-in to diagnostics
    without a comparison target).
  - With `observability_betas_enabled: false`, assert the payload has NO
    `diagnostics` field at all.

- [ ] **K.7 — Implement diagnostics request field.** In
      `anthropic-provider.ts._createRequestPayload`:

  ```ts
  const betas = getBetasForRequest(...);
  const cacheDiagEnabled = betas.includes('cache-diagnosis-2026-04-07');
  // ...
  const payload = {
    model,
    max_tokens: ...,
    messages: cappedMessages,
    system: systemWithCaching,
    tools: anthropicTools,
    betas,
    ...(cacheDiagEnabled ? { diagnostics: { previous_message_id: opts?.previousResponseId ?? null } } : {}),
  };
  ```

- [ ] **K.8 — Test FIRST: response cache_miss_reason captured.** Stub the
      streaming endpoint to deliver a final message with:

  ```json
  {
    "diagnostics": {
      "cache_miss_reason": {
        "type": "system_changed",
        "cache_missed_input_tokens": 12345
      }
    }
  }
  ```

  Assert `ProviderResponse.cacheMissReason` equals that object. Assert an INFO
  log fires with `{type: 'system_changed', cache_missed_input_tokens: 12345}`.

- [ ] **K.9 — Implement cache_miss_reason capture.** In the streaming `message`
      event handler at `anthropic-provider.ts:369–419`:

  ```ts
  // existing final message processing
  const cacheMissReason =
    (message as BetaMessage).diagnostics?.cache_miss_reason ?? null;
  if (cacheMissReason) {
    logger.info('Anthropic cache miss', {
      type: cacheMissReason.type,
      missedTokens:
        'cache_missed_input_tokens' in cacheMissReason
          ? cacheMissReason.cache_missed_input_tokens
          : undefined,
    });
  }
  // Set on ProviderResponse
  ```

  Same path for the non-streaming `_createResponseImpl`.

- [ ] **K.10 — Test FIRST: turn_end persists cacheMissReason.** Run a full turn
      with a stubbed cache miss. Read the durable events.jsonl. Assert the
      `turn_end` event has `data.cacheMissReason` matching the stub. Run a turn
      with a cache hit. Assert `data.cacheMissReason` is `null`.

- [ ] **K.11 — Implement persistence.** Extend `event-types.ts` `turn_end`
      shape:

  ```ts
  type: 'turn_end';
  data: {
    stopReason: LaceStopReason;
    stopDetails?: LaceStopDetails | null;  // from stop-reason plan chunk G
    cacheMissReason?: BetaCacheMissReason | null;  // new
    // existing fields
  };
  ```

  In `runner.ts:559` (turn_end write), capture the LAST provider response's
  `cacheMissReason` and include it:

  ```ts
  let lastCacheMissReason: BetaCacheMissReason | null | undefined = undefined;
  // ... inside the loop, after each provider call:
  lastCacheMissReason = response.cacheMissReason ?? null;
  // ... at turn_end:
  await writeAndAdvance({
    type: 'turn_end',
    data: {
      stopReason,
      stopDetails,
      cacheMissReason: lastCacheMissReason ?? null,
    },
  });
  ```

  Multi-call turns (tool-use loops) record only the final call's miss reason —
  the inner calls within a single turn reuse the prefix from the same turn so
  they wouldn't have a meaningful "vs previous request" comparison anyway.

- [ ] **K.12 — Manual smoke on Ada.** Deploy. Force a cache miss by changing a
      tool description between two requests, or by waiting >5min for cache
      expiry. Verify in Ada's logs:
  - `Anthropic cache miss` INFO line with structured `{type, missedTokens}`.
  - The next request after the miss is a cache HIT (because we're now setting up
    cache with the new prefix).
  - `turn_end` events in events.jsonl contain `cacheMissReason` field.

- [ ] **K.13 — Build + run all tests + commit.** Commit:
      `feat(anthropic-provider): cache diagnostics — capture cache_miss_reason, persist on turn_end`.

---

## 7. Validation

After all three chunks land:

- [ ] **V.1 — `npm run lint`** clean.
- [ ] **V.2 — Agent test suite** fully green (modulo pre-existing
      container-runtime failures).
- [ ] **V.3 — Manual smoke on Ada — observability betas.**
  - Send a normal prompt. Check the request log:
    `betas: ["cache-diagnosis-2026-04-07", "model-context-window-exceeded-2025-08-26"]`
    (plus catalog betas if applicable).
  - Send a context-overflowing prompt. Verify Ada's runner reports
    `'context_window_exceeded'` cleanly, no 400 crash.
  - Force a cache miss. Verify the INFO log line and the
    `turn_end.data.cacheMissReason` field.
- [ ] **V.4 — Bedrock parity check.** Run a Bedrock instance. Verify:
  - It does NOT use `client.beta.messages` (still on base path).
  - It does NOT include the observability betas in any header.
  - 1M-context behavior on Bedrock continues to work via the legacy
    `extra_headers` path (Bedrock-only).
- [ ] **V.5 — Disable observability betas.** Set
      `observability_betas_enabled: false` on a test instance. Verify:
  - `betas[]` in the request only contains catalog betas (probably empty for
    most models).
  - No `diagnostics` field in the request.
  - No cache_miss_reason logging.

---

## 8. Risks & rollback

- **SDK compatibility.** Pin `@anthropic-ai/sdk` to `0.98.0` exactly during this
  work (`"@anthropic-ai/sdk": "0.98.0"`, no caret) so an SDK auto-update can't
  surprise us mid-implementation. Revisit at next dependency sweep. Current
  package.json has `^0.98.0` which is acceptable but slightly riskier.
- **Bedrock divergence.** This work increases the diff between Anthropic-direct
  and Bedrock provider code paths. Mitigated by:
  - Sharing the stop-reason normalizer (per stop-reason plan).
  - Keeping the same `convertToAnthropicFormat` (the BetaMessageParam superset
    is a structural match).
  - Documenting the divergence in the Bedrock provider source comments.
- **Cost.** Zero. Both betas are read-only and don't change billing.
  `previous_message_id` is one string per request.
- **Rollback per chunk.**
  - Revert chunk K: cache diagnostics stops capturing; `cacheMissReason` field
    is undefined; no logs; no persistence. Runner / provider operate identically
    to chunk J state.
  - Revert chunk J: the `model-context-window-exceeded` literal disappears from
    `OBSERVABILITY_BETAS`. The beta is no longer requested. The stop-reason
    normalizer's mapping for this raw value becomes dead code (harmless).
  - Revert chunk I: Anthropic provider falls back to `client.messages.*` and
    `extra_headers`. All observability gone but core functionality identical.

---

## 9. Out of scope

- **Thinking-token-count beta (0.98).** Excluded per Jesse. Requires
  `thinking.display = 'omitted'` to populate the count, which would mean losing
  the streaming thinking text in the UI. Not worth the tradeoff today.
- **Server-side autocompaction (0.71).** Explicitly excluded per Jesse.
- **Top-level `cache_control` (0.78).** Read-up complete in the companion spec
  §6; not adopting.
- **OpenAI/Bedrock observability parity.** OpenAI doesn't have a cache-diagnosis
  equivalent; Bedrock doesn't expose the beta endpoint. Acceptable divergence.
- **Per-call `additionalBetas` UI / API.** YAGNI per decision — the field can
  exist on the type but stays undocumented until a consumer needs it.
- **Cache miss UI dashboard.** Out of scope — log + durable persistence give us
  the raw data; building a visualization is separate.

---

## 10. Sequencing relative to stop-reason plan

| Step                                                              | Status before this plan starts         | Provided by                                                                 |
| ----------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `LaceStopReason` + `LaceStopDetails` types                        | Required                               | Stop-reason plan chunk A                                                    |
| `normalizeAnthropicStop` with `model_context_window_exceeded` row | Required                               | Stop-reason plan chunk A (the normalizer table covers it; no separate work) |
| Anthropic provider uses `normalizeAnthropicStop`                  | Required                               | Stop-reason plan chunk B                                                    |
| Runner dispatch for `'context_window_exceeded'`                   | Required for chunk J's end-to-end test | Stop-reason plan chunk C                                                    |
| `RequestOptions.openaiResponseId` exists                          | Required (we rename it)                | Pre-existing                                                                |
| `turn_end.data.stopDetails` field                                 | Recommended but not required           | Stop-reason plan chunk G (parallel)                                         |

**Minimum prerequisite:** stop-reason chunks A + B. Stop-reason chunk C strongly
recommended before chunk J's integration test runs cleanly. Stop-reason chunks
D, E, F, G, H can land in any order relative to this plan.

If both plans run in parallel, this plan's chunk I can land alongside
stop-reason chunks A+B without conflict. Chunk J should wait for stop-reason
chunk C. Chunk K can land any time after chunk I.
