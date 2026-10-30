# Prompt-cache stability

This document describes how Lace keeps request prefixes stable to support
provider prompt caching, and the tests and signals that check that behavior.
Local byte stability alone does not prove server-side cache reuse. If behavior
changes, update the references below alongside the code.

## Why byte-stability matters

Each turn sends the conversation so far plus a small live tail. Provider cache
rules differ, but reusable prefixes depend on stable content and ordering. Lace
checks **byte-for-byte identical** serialization locally to catch drift from
reordered keys, re-rendered timestamps or directory listings. These checks do
not establish a provider's tokenization, cache eligibility, retention or billing
behavior.

The stakes differ by provider, but the discipline is the same for all:

- **Anthropic / Bedrock** — Lace places explicit `cache_control` markers in the
  request. A prefix that drifts forces a full re-read of the cached tokens at
  roughly 5× the cached rate. This is the most expensive failure mode.
- **OpenAI** — the prefix cache is automatic and server-side; Lace places no
  markers. Drift silently loses the discount.
- **Gemini and local backends** (ollama, lmstudio) — Lace manages no explicit
  cache; a stable prefix still helps wherever the backend reuses prefix/KV
  state.

## The stable thing is the neutral prefix

Lace holds conversation history as a provider-neutral `ProviderMessage[]`
(`packages/agent/src/providers/base-provider.ts`). Each turn, the active
provider's converter turns that neutral array into the provider's wire shape:

- `convertToAnthropicFormat`, `convertToOpenAIFormat`, `convertToGeminiFormat`,
  `convertToTextOnlyFormat` — all in
  `packages/agent/src/providers/format-converters.ts`.

The neutral prefix is stable across turns because the events that produce it are
immutable and the converters are deterministic. The cache _mechanism_ is
provider-specific and lives behind the provider adapter; the stable neutral
prefix plus a deterministic conversion is what every provider's cache wants.

The providers serialize differently — Anthropic uses a `system` array (with
`cache_control` markers) and `messages`; OpenAI prepends a `{role:'system'}`
chat message into `messages`; Gemini supplies the system prompt and function
declarations through the SDK's `GenerateContentParameters.config` as
`systemInstruction` and `tools`, with turns in `contents`. The Google SDK emits
those configuration fields as top-level wire fields and converts output limits
to `generationConfig`. Putting instructions or tools at the top level of the SDK
input silently omits them from its wire request. A session that switches
provider keeps its conversation history but cold-starts its cache, because each
provider serializes a different prefix shape into a different cache namespace.

When a user message also carries tool results, required results precede that
message's text and images. Gemini places `functionResponse` parts first; OpenAI
Chat places all correlated `tool` messages before the user message. Anthropic
and OpenAI Responses apply the same ordering in their native shapes. Result
order, call IDs, success/error data and supported images are preserved.

### Anthropic cache markers

For Anthropic and Bedrock, `packages/agent/src/providers/cache-control.ts`
stamps the markers: `buildSystemWithCaching` (system block),
`markLastToolForCaching` (tool array), and `attachMessageCacheBreakpoints` (a
rolling-tail marker plus a stable anchor placed `ANCHOR_OFFSET_RAW_BLOCKS` raw
blocks behind the tail). `enforceBreakpointBudget` caps the total at Anthropic's
four-marker limit, dropping newest-first to preserve the stable anchor. The
anchor marker moves between turns; that is expected — the cache matches on
content, not on marker position.

Just before the Anthropic request is serialized, `sanitizeLoneSurrogates`
(`packages/agent/src/providers/anthropic/well-formed-json.ts`) replaces lone
UTF-16 surrogates with U+FFFD so the body is valid JSON. It returns the same
object when nothing changes, so it never perturbs a clean prefix.

### Temporary context stays after the marked prefix

The [temporary request context API](temporary-request-context.md) supplies one
sticky process-local value separately from canonical history. Anthropic direct
and Bedrock apply all explicit breakpoints and the four-marker cap to required
history first, then append a separate unmarked user text block. Changes to that
text or its size leave the marked prefix bytes unchanged. It is excluded from
event persistence and compaction input.

OpenAI Responses disables chaining and uses `store: false` for requests with
temporary context, including the remaining requests of a turn after a clear.
Other requests retain provider defaults. Chat Completions, Gemini and local
adapters append the same trailing text. This does not disable any provider's
automatic cache or configure local KV behavior.

## One reducer

Events become messages through a single pure reducer,
`packages/agent/src/message-building/fold-event.ts` (`foldEvent(state, event)`
and the `foldEvents(events)` batch wrapper). A turn's parallel tool calls fold
into the canonical Anthropic parallel-tool form: **one assistant message
carrying all `tool_use` blocks, followed by one user message carrying all
`tool_result` blocks.** The reducer keeps message content verbatim (it never
drops image blocks); a single `tool_use` event carries both the call and its
result, so the reducer tracks the open tool batch to append a second parallel
call to the same assistant and a second result to the same user.

Three paths share this reducer, which is what makes the shape sent on one turn
equal the shape rebuilt on the next:

- `buildProviderMessagesFromDurableEvents` (`message-builder.ts`) — the batch
  rebuild of the whole log.
- `buildPreservedTail` (`compaction/toolkit.ts`) — the post-compaction tail
  folded into a `context_compacted` event's `preserved` array.
- The runner's live tail (`core/conversation/runner.ts`) — as a turn's tools
  execute, results accumulate into one user message, matching the canonical
  shape.

Because all three agree, an assistant turn with parallel tool calls serializes
the same whether it was just sent or later rebuilt from the log, so the cached
prefix holds across it. (Assistant text reaching a converter as a plain string
and as a single-`text`-block array convert to byte-identical wire output —
pinned by `assistant-content-normalization.test.ts` — so the rebuild's verbatim
`ContentBlock[]` and the runner's string content are cache-equivalent.)

A few concerns stay **outside** the reducer, layered around it by the batch
rebuild only: system-prompt extraction; the `context_compacted` reset to the
preserved array followed by `dropOrphanedToolBlocks` (the orphan-pair guard);
and the `context_injected` text-merge into a trailing user message.

## One read at turn entry

Turn entry reads and parses the durable event log **once**, via
`loadTurnEntryProjection` (`message-building/turn-entry-projection.ts`). That
single parsed event array feeds three pure derivers: the provider message
prefix + system prompt (the batch reducer above), the files-read set, and the
last `turn_end` seq (the inject watermark). The per-append seq scan and the
per-iteration inject read remain — those are addressed by the durable index, not
by this read-coalescing.

## The gates

All gates live under `packages/agent/src/providers/__tests__/golden/` and
`packages/agent/src/config/__tests__/`. Run them with
`cd packages/agent && npx vitest run <path>`.

### Golden request bytes (refactor-equivalence)

`golden-bytes-anthropic.test.ts`, `golden-bytes-openai.test.ts`, and
`golden-bytes-gemini.test.ts` pin each provider's serialized request for a
shared fixture corpus (`_fixtures.ts`) against committed snapshot files
(`anthropic-*.json`, `openai-*.json`, `gemini-*.json`). Any change that alters
the request bytes shows up as a snapshot diff, so a refactor of the
message-building path can be proven to produce identical output.

Capture differs by provider, because what reaches the cache differs:

- **Anthropic** captures the **literal post-serializer body** by pointing the
  provider at a local `node:http` server (`_capture-request-body.ts`) and
  reading the raw request body. This is the most faithful gate, used where
  literal bytes carry the cache.
- **OpenAI and Gemini** capture the **request object** Lace hands the SDK, via
  the same SDK module mock the provider's own unit test uses, then
  `JSON.stringify` it. These fixtures pin Lace's SDK input, not actual wire
  serialization. `gemini-provider-sdk-request.test.ts` separately checks that
  the installed SDK sends instructions, declarations and output limits through
  intercepted fetch calls with synthetic credentials and responses.

`gemini-provider-sdk-ordering.test.ts` and `tool-result-ordering-sdk.test.ts`
exercise real SDK serialization for streaming and nonstreaming calls with mixed
user content and multiple tool results. They check result correlation, error
data, images and unchanged inputs for Gemini, Chat, Anthropic and Responses.
They make no live API acceptance or cache-hit claim.

Each golden test also captures twice in one run and asserts the two captures are
equal before comparing to the committed snapshot, so any nondeterminism in the
body surfaces immediately.

**To add a fixture or intentionally change the wire shape:** edit `_fixtures.ts`
(or the converter), regenerate with
`npx vitest run -u src/providers/__tests__/golden/`, and **review the snapshot
diff** — a change to a committed golden is a deliberate wire change and must be
read as one. The committed `.gitignore` ignores `anthropic-*.json` broadly; a
scoped negation keeps the golden directory's files tracked.

### Cross-turn cache-stability

`cross-turn-cache-stability.test.ts` sends a second turn whose only difference
is a longer tail and asserts the shared prefix is byte-identical. Anthropic is
compared with `cache_control` markers stripped (the rolling anchor legitimately
moves inside the request between turns); OpenAI and Gemini are compared whole
(no markers). Drift here — after stripping, for Anthropic — is the real cache
regression this gate exists to catch.

### Converter and render determinism

The cached prefix rests on every input being byte-deterministic.

- `converter-determinism.test.ts` feeds each of the four converters the corpus
  twice and asserts byte-equality, including a fixture whose Gemini tool-call id
  is a persisted `gemini_…` id. The Gemini converter encodes a tool id with
  `Date.now()`/`Math.random()` **only when parsing a response**
  (`packages/agent/src/providers/gemini-provider.ts`); that id is then persisted
  and replayed verbatim, never re-minted when rebuilding history, so conversion
  stays deterministic.
- `render-determinism.test.ts` asserts the system-prompt inputs render to
  identical bytes regardless of directory-read order and wall-clock within a UTC
  day. The concrete rules this enforces in code:
  - **Project tree** entries are sorted byte-stably before truncation in
    `generateProjectTree` (`packages/agent/src/config/variable-providers.ts`);
    the tree is rendered into the system prompt via
    `packages/agent/config/agent-personas/sections/environment.md`, so an
    unsorted listing would drift the cached system block.
  - **Session date** is emitted date-only (`YYYY-MM-DD`), not a precise
    timestamp, so it is stable within a UTC day (`variable-providers.ts`).
  - **Tool order** is byte-stable-sorted with a binary comparator (not
    locale-dependent `localeCompare`) in `getAllTools`
    (`packages/agent/src/tools/executor.ts`).

The system prompt is rendered once at session creation and frozen into a
`system_prompt_set` event, then replayed each turn; a post-compaction persona
re-render appends a fresh `system_prompt_set` only when the rendered text
actually changes. Determinism is what makes that skip-if-unchanged guard
correct.

## The production signal

Determinism gates run in CI against fixtures. A real session's state never
appears in a fixture, so production is watched directly: every turn logs a
`cache-health: turn complete` line. `buildCacheHealthLog`
(`packages/agent/src/core/conversation/cache-health.ts`) is a pure function that
turns the turn's accumulated usage into a flat record — uncached input,
cache-creation, and cache-read token counts, a derived cache-read rate, and the
cache-miss reason — and the runner emits it right after the `turn_end` event is
written (`packages/agent/src/core/conversation/runner.ts`).

The cache fields come from each provider's parsed usage
(`cacheCreationInputTokens` / `cacheReadInputTokens` on `ProviderResponse.usage`
in `base-provider.ts`). Anthropic populates them on every response; OpenAI and
Gemini report no cache split today, so their counts read zero and the signal is
most meaningful for Anthropic, where the cost of drift is highest. A sustained
drop in the cache-read rate, or a recurring miss reason, means a prefix
regression reached production — investigate the most recent change to the
message-building or prompt-rendering path. The line is logged at `info`; set
`LACE_LOG_LEVEL=info` (or lower) to see it.
