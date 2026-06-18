# Session-State Architecture — Step 0: Guardrails & Instrumentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the safety net — per-provider golden-bytes tests, a render-determinism test (with the determinism fixes it forces), and a production cache-health log signal — *before* any change to the session-state hot path, so every later step (the O(N²) fix) can be proven byte-safe and watched in production.

**Architecture:** Three deliverables, all additive except two tiny determinism fixes. (1) A reusable request-body capture harness that drives each provider's real `convert→cache→sanitize→serialize` pipeline against a local mock HTTP server and captures the *literal* serialized body; a shared fixture corpus; committed golden snapshots (refactor-equivalence gate) and cross-turn cache-stability assertions (markers stripped for Anthropic/Bedrock, whole for OpenAI/Gemini). (2) A render-determinism test on the system-prompt + tools render path, plus the `fs.readdirSync` sort fix it exposes. (3) A pure `cache-health` log-line builder wired into the runner at the `turn_end` write.

**Tech Stack:** TypeScript, vitest 3.x, `node:http` mock servers, the lace `@lace/agent` package.

**Why this order (from the spec, `docs/design/session-state-architecture.md`):** "Build the safety net before touching a byte." Nothing in this plan changes the hot path or message-building logic — it only *observes* and *pins* current behavior, except the readdir sort, which is a determinism fix the new test proves is needed. Later steps refactor against these committed golden bytes.

---

## Background the implementer needs

**Read first:** `docs/design/session-state-architecture.md` (the spec) — specifically "Layer 3", "Invariants 4 & 5", and "Step 0".

**Key facts (already verified — do not re-derive, but do open the cited files to copy exact code):**

- The neutral message type is `ProviderMessage` at `packages/agent/src/providers/base-provider.ts:925`:
  ```ts
  export interface ProviderMessage {
    role: 'user' | 'assistant' | 'system';
    content: string | ContentBlock[];
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    thinkingBlocks?: ThinkingBlock[];
  }
  ```
- The four converters live in `packages/agent/src/providers/format-converters.ts`: `convertToAnthropicFormat` (line 62), `convertToOpenAIFormat` (line 254), `convertToTextOnlyFormat` (line 324), `convertToGeminiFormat` (line 370).
- `attachMessageCacheBreakpoints` is in `packages/agent/src/providers/cache-control.ts:158`; the anchor offset constant `ANCHOR_OFFSET_RAW_BLOCKS = 10` is at line 20.
- `sanitizeLoneSurrogates` is in `packages/agent/src/providers/anthropic/well-formed-json.ts:18`; it runs at the Anthropic send boundary (`anthropic-provider.ts:343`).
- **The canonical body-capture pattern already exists** at `packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts`. It stands up a `node:http` server on port 0, captures the raw request body string in a `captured: string[]`, points `new AnthropicProvider({ apiKey: 'sk-test', baseURL })` at it, and calls `provider.createResponse(messages, tools, model)`. The cache_control strip is `s.replace(/,?"cache_control":\{[^}]*\}/g, '')`. **Mirror this pattern; do not invent a new capture mechanism.**
- Existing per-provider tests that already mock responses (crib the exact minimal response JSON + constructor shape from these — **do not hand-author response JSON**):
  - OpenAI: `packages/agent/src/providers/openai-provider.test.ts`
  - Gemini: `packages/agent/src/providers/gemini-provider.test.ts`
  - End-to-end body capture through the runner: `packages/agent/src/core/conversation/__tests__/runner.cache-control-e2e.test.ts`
- Token usage type with cache fields: `ProviderResponse.usage` at `base-provider.ts:81-102` has optional `cacheCreationInputTokens` / `cacheReadInputTokens`. The runner accumulates `totalCacheCreationInputTokens` / `totalCacheReadInputTokens` and tracks `lastCacheMissReason`, then writes the `turn_end` event around `runner.ts:1115-1134`.
- Logger: `packages/agent/src/utils/logger.ts` exports `logger`; call style is `logger.info('message', { structured: data })`.
- `generateProjectTree` (`packages/agent/src/config/variable-providers.ts:204-219`) builds the `{{project.tree}}` template variable from `fs.readdirSync(dir, { withFileTypes: true })` **without sorting** — a latent nondeterminism. `getAllTools` (`packages/agent/src/tools/executor.ts:102-113`) is already byte-stable-sorted (binary `<`/`>`).

**Test commands** (run from `packages/agent`):
```bash
cd packages/agent
npx vitest run <relative-path-to-test-file>     # single file
npx vitest run -u <relative-path-to-test-file>  # update committed golden snapshots
```
Typecheck/lint before each commit (repo convention, pre-commit hook enforces): from repo root `npm run typecheck && npm run lint`.

**Golden snapshot mechanism:** use vitest's `await expect(body).toMatchFileSnapshot('./golden/<name>.json')`. The golden file is committed; later refactors compare against it. This *is* the spec's `Buffer.equals` refactor-equivalence gate (string compare of identical-encoding JSON is byte-equality). Each golden test ALSO captures the body twice in one run and asserts the two captures are equal *before* the snapshot compare, to catch any body-level nondeterminism immediately.

**Capture strategy — per provider (decided after reading the existing tests; do not change without reason):**
- **Anthropic** → **real `node:http` server, literal post-SDK bytes.** This mirrors the proven `cache-control-byte-stable.test.ts`. Anthropic is the provider where literal wire bytes carry the cache (explicit `cache_control` markers live *in* the body; a 1-byte prefix drift = ~5× re-bill), so post-serializer fidelity matters most here. `AnthropicProvider` takes a `baseURL` constructor option, so this needs no provider change.
- **OpenAI / Gemini** → **capture the request OBJECT passed to the SDK method, then `JSON.stringify` it.** Both existing provider tests already do this via a file-hoisted `vi.mock('openai')` / `vi.mock('@google/genai')` that replaces `chat.completions.create` / `models.generateContent` with a `vi.fn()`; the captured object is `mock.calls[0][0]`. This is spec-aligned (the spec defines byte-identity as `JSON.stringify(stableObject)` — the object we control), needs no provider baseURL passthrough, and reuses proven mocking. OpenAI's server-side prefix cache and Gemini's lack of a managed cache make object-level fidelity sufficient for these two. **Because `vi.mock` is hoisted and module-global per file, the OpenAI and Gemini golden/cross-turn tests are SELF-CONTAINED (mock + capture in the test file) — they do NOT use the shared Anthropic helper.**
- **Confirmed real mock shapes** (from the existing tests — use these, don't invent):
  - OpenAI Chat Completions response (`mockCreate.mockResolvedValue`): `{ choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }`. Constructor: `new OpenAIProvider({ apiKey: 'test-key', baseURL: 'http://localhost:8080/v1' })` (a custom baseURL forces the Chat Completions path via `isCustomEndpoint()`). Model: `'gpt-4o'`. The mock module is `vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } } } }))`.
  - Gemini response (`mockGenerateContent.mockResolvedValue`): `{ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }`. Constructor: `new GeminiProvider({ apiKey: 'test-api-key' })`. Model: `'gemini-2.5-flash'`. The mock module is `vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mockGenerateContent, generateContentStream: mockGenerateContentStream } } }))` — **copy the exact factory and exported class name from `gemini-provider.test.ts:13-17` (it may export `GoogleGenAI` or another name).**

---

## File Structure

**Create:**
- `packages/agent/src/providers/__tests__/golden/_capture-request-body.ts` — the reusable **Anthropic** real-server body-capture helper (single-turn + two-turn). Sole responsibility: stand up a `node:http` server, drive `AnthropicProvider.createResponse`, return captured literal body string(s). (OpenAI/Gemini capture lives inside their own test files because their `vi.mock` is file-hoisted — see the Capture strategy note above.)
- `packages/agent/src/providers/__tests__/golden/_fixtures.ts` — the shared fixture corpus: builders returning `{ messages: ProviderMessage[], tools, systemPrompt }` for each scenario (thinking blocks, multi-key/numeric tool args, image, compaction era with `preserved`, post-compaction persona re-render, unicode, orphaned tool block).
- `packages/agent/src/providers/__tests__/golden/golden-bytes-anthropic.test.ts`
- `packages/agent/src/providers/__tests__/golden/golden-bytes-openai.test.ts`
- `packages/agent/src/providers/__tests__/golden/golden-bytes-gemini.test.ts`
- `packages/agent/src/providers/__tests__/golden/cross-turn-cache-stability.test.ts`
- `packages/agent/src/config/__tests__/render-determinism.test.ts`
- `packages/agent/src/providers/__tests__/converter-determinism.test.ts`
- `packages/agent/src/core/conversation/cache-health.ts` — pure `buildCacheHealthLog(...)` function.
- `packages/agent/src/core/conversation/__tests__/cache-health.test.ts`

**Modify:**
- `packages/agent/src/config/variable-providers.ts` — sort the `readdirSync` result in `generateProjectTree` (determinism fix Task 5 forces).
- `packages/agent/src/core/conversation/runner.ts` — call `buildCacheHealthLog` + `logger.info` after the `turn_end` write (Task 8).

**Note on `golden/` directory:** committed golden snapshot files land in `packages/agent/src/providers/__tests__/golden/<name>.json`. They are fixtures, not source — they will be committed and are the gate later steps must reproduce.

---

## Task 1: Capture harness + fixture corpus (Anthropic only, to prove the harness)

**Files:**
- Create: `packages/agent/src/providers/__tests__/golden/_capture-request-body.ts`
- Create: `packages/agent/src/providers/__tests__/golden/_fixtures.ts`
- Reference (read, do not modify): `packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts`

- [ ] **Step 1: Write the fixture corpus module**

Create `_fixtures.ts`. Each fixture is a named builder returning the neutral inputs. Use only `ProviderMessage` fields. Tool calls/results use the existing `Tool` subclass pattern from `cache-control-byte-stable.test.ts` (the `EchoTool`). Keep content deterministic (no `Date.now()`).

```ts
// ABOUTME: Shared fixture corpus for the per-provider golden-bytes tests. Each
// fixture is a deterministic ProviderMessage[] + tools + systemPrompt that
// exercises one wire-shape concern (thinking, tool args, images, compaction
// era, unicode, orphaned tool block). The SAME fixtures feed every provider's
// golden test so a refactor is checked byte-for-byte against committed bytes.

import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

export class EchoTool extends Tool {
  name = 'echo';
  description = 'Echo a value';
  schema = z.object({ v: z.string() });
  protected async executeValidated(args: { v: string }, _c: ToolContext): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.v));
  }
}

export type GoldenFixture = {
  name: string;
  systemPrompt: string;
  tools: Tool[];
  messages: ProviderMessage[];
};

const SYSTEM = 'You are Lace. Cached system block.';

export const FIXTURES: GoldenFixture[] = [
  {
    name: 'plain-conversation',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you' },
    ],
  },
  {
    name: 'thinking-blocks',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'think about this' },
      {
        role: 'assistant',
        content: 'done',
        thinkingBlocks: [{ type: 'thinking', thinking: 'let me reason', signature: 'sig-abc' }],
      },
    ],
  },
  {
    name: 'tool-call-multikey-numeric-args',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'use the tool' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'echo', input: { v: 'x', count: 3, flag: true, nested: { a: 1 } } }],
      },
      { role: 'user', content: '', toolResults: [{ id: 'call_1', content: [{ type: 'text', text: 'x' }], isError: false }] },
    ],
  },
  {
    name: 'unicode-and-surrogates',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'café — 日本語 — 😀 — \uD83D' }, // trailing lone high surrogate on purpose
      { role: 'assistant', content: 'ok' },
    ],
  },
];
```

> NOTE on exact shapes: `ToolCall` and `ToolResult` field names (`id`/`name`/`input`, `id`/`content`/`isError`) must match the definitions in `base-provider.ts`. **Open `base-provider.ts` and confirm the exact field names before finalizing** — if they differ, use the real ones. The image / compaction-era / orphaned-tool / post-compaction fixtures are added in Task 4 once the harness is proven; this task keeps the corpus small to validate the harness end-to-end.

- [ ] **Step 2: Write the capture helper (Anthropic)**

Create `_capture-request-body.ts`. Mirror the server setup from `cache-control-byte-stable.test.ts` exactly.

```ts
// ABOUTME: Reusable mock-HTTP-server harness that drives a provider's real
// createResponse() pipeline and captures the LITERAL serialized request body.
// One capture fn per provider family; each mirrors the minimal valid response
// shape that provider's parser expects (cribbed from the provider's own tests).

import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import type { GoldenFixture } from './_fixtures';

async function startServer(handler: (body: string, n: number) => string): Promise<{ server: Server; baseURL: string; captured: string[] }> {
  const captured: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      captured.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(handler(body, captured.length));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return { server, baseURL: `http://127.0.0.1:${addr.port}`, captured };
}

export async function captureAnthropicBody(fixture: GoldenFixture): Promise<string> {
  const { server, baseURL, captured } = await startServer((_b, n) =>
    JSON.stringify({
      id: `msg_${n}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })
  );
  try {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt(fixture.systemPrompt);
    await provider.createResponse(fixture.messages, fixture.tools, 'claude-sonnet-4-20250514');
    if (captured.length !== 1) throw new Error(`expected 1 request, got ${captured.length}`);
    return captured[0]!;
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
}
```

- [ ] **Step 3: Smoke-test the harness compiles and captures**

Add a temporary inline test at the bottom of a scratch file is NOT allowed; instead, this is validated by Task 2's first run. Just typecheck.

Run: `cd packages/agent && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "_capture-request-body|_fixtures" || echo "no type errors in new files"`
Expected: `no type errors in new files`

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/_capture-request-body.ts packages/agent/src/providers/__tests__/golden/_fixtures.ts
git commit -m "test(session-state): golden-bytes capture harness + initial fixture corpus"
```

---

## Task 2: Anthropic refactor-equivalence golden snapshots

**Files:**
- Create: `packages/agent/src/providers/__tests__/golden/golden-bytes-anthropic.test.ts`
- Create (generated): `packages/agent/src/providers/__tests__/golden/anthropic-*.json`

- [ ] **Step 1: Write the golden test**

```ts
import { describe, it, expect } from 'vitest';
import { captureAnthropicBody } from './_capture-request-body';
import { FIXTURES } from './_fixtures';

describe('golden-bytes: Anthropic request body is pinned', () => {
  for (const fixture of FIXTURES) {
    it(`pins the Anthropic body for "${fixture.name}"`, async () => {
      // Intra-run determinism: two captures of the same fixture must be byte-equal.
      const a = await captureAnthropicBody(fixture);
      const b = await captureAnthropicBody(fixture);
      expect(a).toBe(b);

      // Refactor-equivalence gate: the body must match the committed golden bytes.
      await expect(a).toMatchFileSnapshot(`./anthropic-${fixture.name}.json`);
    });
  }
});
```

- [ ] **Step 2: Run to generate goldens (first run writes them)**

Run: `cd packages/agent && npx vitest run -u src/providers/__tests__/golden/golden-bytes-anthropic.test.ts`
Expected: PASS, and new `anthropic-*.json` files appear in the `golden/` dir.

- [ ] **Step 3: Run again WITHOUT `-u` to prove the gate compares**

Run: `cd packages/agent && npx vitest run src/providers/__tests__/golden/golden-bytes-anthropic.test.ts`
Expected: PASS (now comparing against committed goldens).

- [ ] **Step 4: Sanity-inspect one golden**

Run: `cat packages/agent/src/providers/__tests__/golden/anthropic-thinking-blocks.json | head -c 400; echo`
Expected: a JSON object containing `"model"`, `"system"`, `"messages"`, and a `"thinking"` block with `"signature":"sig-abc"`. Confirm the lone surrogate in `unicode-and-surrogates` was replaced with U+FFFD (`�`) in `anthropic-unicode-and-surrogates.json` — this proves `sanitizeLoneSurrogates` is in the captured path.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/golden-bytes-anthropic.test.ts packages/agent/src/providers/__tests__/golden/anthropic-*.json
git commit -m "test(session-state): pin Anthropic request-body golden bytes (refactor-equivalence gate)"
```

---

## Task 3: OpenAI + Gemini golden snapshots (object-capture, self-contained)

These two tests do NOT use the shared helper — each owns a file-hoisted `vi.mock` of its SDK and captures the request *object* passed to the mocked method, then `JSON.stringify`s it. Copy the mock factory + `mockResolvedValue` shapes from the existing provider tests (cited below); they are reproduced here from those files.

**Files:**
- Create: `packages/agent/src/providers/__tests__/golden/golden-bytes-openai.test.ts`
- Create: `packages/agent/src/providers/__tests__/golden/golden-bytes-gemini.test.ts`
- Reference: `packages/agent/src/providers/openai-provider.test.ts:11-25,42-54,97-108`, `packages/agent/src/providers/gemini-provider.test.ts:13-17,27,67-81`

- [ ] **Step 1: Write the OpenAI golden test (self-contained)**

```ts
// ABOUTME: Pins the OpenAI Chat Completions REQUEST OBJECT (JSON.stringify) for
// the shared fixture corpus. Captures the object lace hands the SDK (the thing
// we control) — OpenAI's prefix cache is server-side, so object-level fidelity
// is the right gate. Mirrors the mock in openai-provider.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { OpenAIProvider } from '@lace/agent/providers/openai-provider';
import { FIXTURES } from './_fixtures';

function capture(): string {
  // The request object lace passed to chat.completions.create on the last call.
  const call = mockCreate.mock.calls.at(-1);
  if (!call) throw new Error('mockCreate was not called');
  return JSON.stringify(call[0]);
}

describe('golden-bytes: OpenAI request object is pinned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });

  for (const fixture of FIXTURES) {
    it(`pins the OpenAI object for "${fixture.name}"`, async () => {
      const provider = new OpenAIProvider({ apiKey: 'test-key', baseURL: 'http://localhost:8080/v1' });
      provider.setSystemPrompt(fixture.systemPrompt);
      await provider.createResponse(fixture.messages, fixture.tools, 'gpt-4o');
      const a = capture();
      await provider.createResponse(fixture.messages, fixture.tools, 'gpt-4o');
      const b = capture();
      expect(a).toBe(b); // intra-run determinism
      await expect(a).toMatchFileSnapshot(`./openai-${fixture.name}.json`);
    });
  }
});
```

> Confirm the `vi.mock('openai', …)` factory matches `openai-provider.test.ts:15-25` exactly (the SDK's default export shape). If `createResponse` for `gpt-4o` with a custom baseURL still routes to the Responses API (`responses.create`) instead of `chat.completions.create`, the mock must also stub `responses.create` and `capture()` must read whichever was called — read `openai-provider.ts` `isCustomEndpoint()` to confirm the custom baseURL forces Chat Completions (the existing test relies on exactly this).

- [ ] **Step 2: Write the Gemini golden test (self-contained)**

```ts
// ABOUTME: Pins the Gemini generateContent REQUEST OBJECT (JSON.stringify) for
// the shared fixture corpus. Gemini exposes no baseURL passthrough and manages
// no prompt cache, so the object lace hands the SDK is the right gate. Mirrors
// the mock in gemini-provider.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
// COPY the exact factory + exported class name from gemini-provider.test.ts:13-17.
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent, generateContentStream: mockGenerateContentStream };
  },
}));

import { GeminiProvider } from '@lace/agent/providers/gemini-provider';
import { FIXTURES } from './_fixtures';

function capture(): string {
  const call = mockGenerateContent.mock.calls.at(-1);
  if (!call) throw new Error('mockGenerateContent was not called');
  return JSON.stringify(call[0]);
}

describe('golden-bytes: Gemini request object is pinned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  });

  for (const fixture of FIXTURES) {
    it(`pins the Gemini object for "${fixture.name}"`, async () => {
      const provider = new GeminiProvider({ apiKey: 'test-api-key' });
      provider.setSystemPrompt(fixture.systemPrompt);
      await provider.createResponse(fixture.messages, fixture.tools, 'gemini-2.5-flash');
      const a = capture();
      await provider.createResponse(fixture.messages, fixture.tools, 'gemini-2.5-flash');
      const b = capture();
      expect(a).toBe(b); // intra-run determinism — this also pins the Date.now()/Math.random() tool-id concern: the converter must not re-mint ids for persisted history
      await expect(a).toMatchFileSnapshot(`./gemini-${fixture.name}.json`);
    });
  }
});
```

> The exported class name in the `@google/genai` mock factory MUST be copied verbatim from `gemini-provider.test.ts:13-17` (shown above as `GoogleGenAI` — verify). The Gemini converter mints tool-call ids with `Date.now()/Math.random()` only when parsing a *response* (`gemini-provider.ts:118-119`), never when converting persisted history — so the intra-run `expect(a).toBe(b)` must hold. If it does NOT, that's a real determinism bug to surface (a re-mint leaked into the request path), not something to snapshot away.

- [ ] **Step 3: Generate + verify both**

Run: `cd packages/agent && npx vitest run -u src/providers/__tests__/golden/golden-bytes-openai.test.ts src/providers/__tests__/golden/golden-bytes-gemini.test.ts`
Expected: PASS, goldens written.

Run again without `-u`:
`cd packages/agent && npx vitest run src/providers/__tests__/golden/golden-bytes-openai.test.ts src/providers/__tests__/golden/golden-bytes-gemini.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/golden-bytes-openai.test.ts packages/agent/src/providers/__tests__/golden/golden-bytes-gemini.test.ts packages/agent/src/providers/__tests__/golden/openai-*.json packages/agent/src/providers/__tests__/golden/gemini-*.json
git commit -m "test(session-state): pin OpenAI + Gemini request-object golden bytes"
```

---

## Task 4: Complete the fixture corpus (the hard wire shapes)

**Files:**
- Modify: `packages/agent/src/providers/__tests__/golden/_fixtures.ts`
- Reference: `packages/agent/src/message-building/message-builder.ts` (how `context_compacted.preserved` becomes messages), `packages/agent/src/compaction/toolkit.ts:415` (`buildPreservedTail` shape), `packages/agent/src/providers/format-converters.ts:62` (Anthropic tool-result-before-text ordering, the `dropOrphanedToolBlocks` consumer).

- [ ] **Step 1: Add the remaining fixtures**

Append to `FIXTURES`. These cover the spec's required corpus: image block, a compaction era (a `preserved`-derived prefix + a small tail), a post-compaction persona re-render (a second system block), and an orphaned tool block (a `tool_use` with no matching `tool_result`). Build them as the *already-rebuilt* `ProviderMessage[]` (this test pins the converter+serializer, not the rebuilder — the rebuilder is pinned in Step 1's golden indirectly via fixtures that mirror its output).

```ts
// Append inside FIXTURES (use the real ContentBlock image shape from base-provider.ts):
{
  name: 'image-block',
  systemPrompt: SYSTEM,
  tools: [new EchoTool()],
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      ],
    },
    { role: 'assistant', content: 'an image' },
  ],
},
{
  name: 'orphaned-tool-block',
  systemPrompt: SYSTEM,
  tools: [new EchoTool()],
  messages: [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_orphan', name: 'echo', input: { v: 'y' } }] },
    // no matching tool_result — the converter/guard must handle this deterministically
    { role: 'user', content: 'next question' },
  ],
},
{
  name: 'post-compaction-double-system',
  systemPrompt: SYSTEM,
  tools: [new EchoTool()],
  messages: [
    { role: 'user', content: 'summary of prior era' },
    { role: 'assistant', content: 'acknowledged' },
    { role: 'user', content: 'new turn after compaction' },
  ],
},
```

> The `ContentBlock` image shape (`source.type` / `media_type` / `data` field names) MUST be copied exactly from the `ContentBlock` union in `base-provider.ts`. If lace's internal image block differs from the Anthropic wire shape, use lace's internal shape — the converter produces the wire shape. Confirm before finalizing.

- [ ] **Step 2: Regenerate all goldens (new fixtures added)**

Run: `cd packages/agent && npx vitest run -u src/providers/__tests__/golden/`
Expected: PASS; new `*-image-block.json`, `*-orphaned-tool-block.json`, `*-post-compaction-double-system.json` for all three providers.

- [ ] **Step 3: Inspect the orphaned-tool golden**

Run: `cat packages/agent/src/providers/__tests__/golden/anthropic-orphaned-tool-block.json | python3 -m json.tool | grep -A2 -B2 tool_use || true`
Expected: confirm the orphaned `tool_use` was handled consistently (either dropped or paired-with-synthetic) — whatever the current code does, it is now PINNED. Note the behavior in a one-line comment in the test file.

- [ ] **Step 4: Run the whole golden suite without `-u`**

Run: `cd packages/agent && npx vitest run src/providers/__tests__/golden/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/_fixtures.ts packages/agent/src/providers/__tests__/golden/*.json
git commit -m "test(session-state): complete golden fixture corpus (image, orphan, compaction era)"
```

---

## Task 5: Render-determinism test + the `readdirSync` sort fix

**Files:**
- Create: `packages/agent/src/config/__tests__/render-determinism.test.ts`
- Modify: `packages/agent/src/config/variable-providers.ts:204-219` (`generateProjectTree`)
- Reference: `packages/agent/src/config/variable-providers.ts` (`ProjectVariableProvider`), `packages/agent/src/config/prompt-manager.test.ts` (existing render-test pattern, lines ~121/238)

- [ ] **Step 1: Write the failing determinism test**

This test forces the dependency on directory-read order by stubbing `fs.readdirSync` to return entries in two different orders, and asserts the rendered `project.tree` variable is byte-identical regardless. Use vitest's `vi.spyOn`. Crib the `ProjectVariableProvider` construction from `variable-providers.ts`.

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import { ProjectVariableProvider } from '@lace/agent/config/variable-providers';

afterEach(() => vi.restoreAllMocks());

function fakeEntry(name: string, isDir: boolean): fs.Dirent {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as unknown as fs.Dirent;
}

describe('render determinism: project tree is insensitive to readdir order', () => {
  it('produces byte-identical tree regardless of fs.readdirSync ordering', () => {
    const entries = [fakeEntry('zebra.ts', false), fakeEntry('alpha', true), fakeEntry('mango.ts', false)];

    const render = (order: fs.Dirent[]): string => {
      const spy = vi.spyOn(fs, 'readdirSync');
      // top-level dir returns `order`; any nested dir returns empty
      spy.mockImplementation(((_p: fs.PathLike, _o?: unknown) => order) as unknown as typeof fs.readdirSync);
      // Construct the provider against a fixed cwd so cwd is held constant.
      const provider = new ProjectVariableProvider(/* fixed cwd / session per the real constructor */);
      const vars = provider.getVariables() as { project: { tree: string } };
      spy.mockRestore();
      return vars.project.tree;
    };

    const forward = render(entries);
    const reversed = render([...entries].reverse());
    expect(forward).toBe(reversed);
  });
});
```

> Confirm the real `ProjectVariableProvider` constructor signature and how it determines `cwd` (it falls back to `process.cwd()`); pass a fixed directory so cwd is constant. The point is to vary ONLY readdir order.

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/agent && npx vitest run src/config/__tests__/render-determinism.test.ts`
Expected: FAIL — `forward` and `reversed` differ because `generateProjectTree` emits entries in readdir order.

- [ ] **Step 3: Fix `generateProjectTree` — sort entries byte-stably**

In `variable-providers.ts`, in `generateProjectTree`, sort the filtered entries by name with a byte-stable comparator (matching the `executor.ts` convention) before iterating:

```ts
const items = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((item) => !item.name.startsWith('.') && item.name !== 'node_modules')
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  .slice(0, 20);
```

> Apply the sort BEFORE `.slice(0, 20)` so which 20 entries are chosen is also deterministic.

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/agent && npx vitest run src/config/__tests__/render-determinism.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a wall-clock determinism assertion**

Append a second test: render twice with `vi.useFakeTimers()` set to two different times, asserting `system.sessionDate` and the full rendered prompt are equal when the two times fall on the same UTC day, and confirming the prompt uses date-only (not timestamp). This pins the existing `sessionDate` mitigation (`variable-providers.ts:55`).

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SystemVariableProvider } from '@lace/agent/config/variable-providers';

afterEach(() => vi.useRealTimers());

describe('render determinism: system date is date-only (stable within a UTC day)', () => {
  it('same UTC day, different wall-clock → identical sessionDate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-18T01:00:00Z'));
    const morning = (await new SystemVariableProvider().getVariables()) as { system: { sessionDate: string } };
    vi.setSystemTime(new Date('2026-06-18T23:00:00Z'));
    const night = (await new SystemVariableProvider().getVariables()) as { system: { sessionDate: string } };
    expect(morning.system.sessionDate).toBe(night.system.sessionDate);
    expect(morning.system.sessionDate).toBe('2026-06-18');
  });
});
```

> Confirm `SystemVariableProvider.getVariables()` is sync vs async (it returned a plain object in the explorer map — adjust `await` accordingly).

- [ ] **Step 6: Run the file — expect GREEN; then run full config suite for no regressions**

Run: `cd packages/agent && npx vitest run src/config/__tests__/render-determinism.test.ts && npx vitest run src/config/`
Expected: PASS (no other config tests broken by the sort).

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/config/__tests__/render-determinism.test.ts packages/agent/src/config/variable-providers.ts
git commit -m "fix(session-state): sort project-tree entries byte-stably + render-determinism tests (Invariant 5)"
```

---

## Task 6: Cross-turn cache-stability, per provider

A second turn whose only difference is a longer tail must leave the shared prefix byte-stable. One file, three providers, each using its capture strategy: Anthropic via the real-server two-turn helper (markers stripped); OpenAI/Gemini via their file-hoisted SDK mocks (object capture, compared whole — no markers).

**Files:**
- Modify: `packages/agent/src/providers/__tests__/golden/_capture-request-body.ts` (add `captureAnthropicTwoTurn`)
- Create: `packages/agent/src/providers/__tests__/golden/cross-turn-cache-stability.test.ts`
- Reference: existing `cache-control-byte-stable.test.ts` (the Anthropic pattern this generalizes)

- [ ] **Step 1: Add the Anthropic two-turn helper**

In `_capture-request-body.ts`, add (reuses the same server; it pushes every request into `captured`):

```ts
export async function captureAnthropicTwoTurn(): Promise<[string, string]> {
  const { server, baseURL, captured } = await startServer((_b, n) =>
    JSON.stringify({ id: `msg_${n}`, type: 'message', role: 'assistant', model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 } })
  );
  try {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are Lace. Cached system block.');
    const base = [
      { role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: 'a1' },
      { role: 'user' as const, content: 'q2' }, { role: 'assistant' as const, content: 'a2' },
    ];
    await provider.createResponse([...base, { role: 'user', content: 'NEW1' }], [], 'claude-sonnet-4-20250514');
    await provider.createResponse(
      [...base, { role: 'user', content: 'NEW1' }, { role: 'assistant', content: 'NEWA1' }, { role: 'user', content: 'NEW2' }],
      [], 'claude-sonnet-4-20250514');
    if (captured.length !== 2) throw new Error(`expected 2 requests, got ${captured.length}`);
    return [captured[0]!, captured[1]!];
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
}
```

- [ ] **Step 2: Write the cross-turn test (self-contained for OpenAI/Gemini)**

The file mocks `openai` and `@google/genai` (file-hoisted, module-global) for the OpenAI/Gemini object capture; the Anthropic case uses the real-server helper, unaffected by those mocks. `prefixOf` slices the shared base-history prefix off a captured object/body.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mockCreate } }; } }));
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mockGenerateContent, generateContentStream: mockGenerateContentStream }; } }));

import { OpenAIProvider } from '@lace/agent/providers/openai-provider';
import { GeminiProvider } from '@lace/agent/providers/gemini-provider';
import { captureAnthropicTwoTurn } from './_capture-request-body';

const stripCacheControl = (s: string) => s.replace(/,?"cache_control":\{[^}]*\}/g, '');

// SHARED base history = 4 messages. Turn N+1 appends an assistant answer + a new
// user message, so the first `sharedCount` provider-messages must be identical.
const BASE = [
  { role: 'user' as const, content: 'q1' }, { role: 'assistant' as const, content: 'a1' },
  { role: 'user' as const, content: 'q2' }, { role: 'assistant' as const, content: 'a2' },
];
const TURN1 = [...BASE, { role: 'user' as const, content: 'NEW1' }];
const TURN2 = [...BASE, { role: 'user' as const, content: 'NEW1' }, { role: 'assistant' as const, content: 'NEWA1' }, { role: 'user' as const, content: 'NEW2' }];

// Slice the shared prefix from a captured request object/body.
function prefixFromObject(obj: Record<string, unknown[]>, key: string, sharedCount: number): string {
  return JSON.stringify((obj[key] as unknown[]).slice(0, sharedCount));
}

describe('cross-turn cache stability: shared prefix is byte-stable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'ok', tool_calls: undefined }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
    mockGenerateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  });

  it('Anthropic: prefix identical after stripping cache_control', async () => {
    const [t1, t2] = await captureAnthropicTwoTurn();
    const pre = (body: string) => JSON.stringify((JSON.parse(body) as { messages: unknown[] }).messages.slice(0, BASE.length));
    expect(stripCacheControl(pre(t1))).toBe(stripCacheControl(pre(t2)));
  });

  it('OpenAI: request-object prefix identical (server-side cache, no markers)', async () => {
    const p = new OpenAIProvider({ apiKey: 'test-key', baseURL: 'http://localhost:8080/v1' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(TURN1, [], 'gpt-4o');
    const o1 = mockCreate.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    await p.createResponse(TURN2, [], 'gpt-4o');
    const o2 = mockCreate.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    // OpenAI prepends a system message → shared count = BASE.length + 1. Confirm the
    // body key ('messages') and the +1 by inspecting o1 on first run.
    expect(prefixFromObject(o1, 'messages', BASE.length + 1)).toBe(prefixFromObject(o2, 'messages', BASE.length + 1));
  });

  it('Gemini: request-object prefix identical (no managed cache, no markers)', async () => {
    const p = new GeminiProvider({ apiKey: 'test-api-key' });
    p.setSystemPrompt('You are Lace. Cached system block.');
    await p.createResponse(TURN1, [], 'gemini-2.5-flash');
    const o1 = mockGenerateContent.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    await p.createResponse(TURN2, [], 'gemini-2.5-flash');
    const o2 = mockGenerateContent.mock.calls.at(-1)![0] as Record<string, unknown[]>;
    // Gemini uses `contents` and a separate `systemInstruction` (no leading system message).
    expect(prefixFromObject(o1, 'contents', BASE.length)).toBe(prefixFromObject(o2, 'contents', BASE.length));
  });
});
```

> The exact `sharedCount` and body key are facts to read off the first captured object, not to guess: OpenAI prepends a `system` chat message (so `BASE.length + 1` on the `messages` array); Gemini keeps the system prompt in `systemInstruction` and the turns in `contents` (so `BASE.length`). Adjust after inspecting `o1` on the first run.

- [ ] **Step 3: Run — expect GREEN**

Run: `cd packages/agent && npx vitest run src/providers/__tests__/golden/cross-turn-cache-stability.test.ts`
Expected: PASS for all three. If a provider FAILS, that is a real pre-existing cache-stability bug — STOP and report it (do not paper over it); it is exactly what this gate exists to catch.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/_capture-request-body.ts packages/agent/src/providers/__tests__/golden/cross-turn-cache-stability.test.ts
git commit -m "test(session-state): cross-turn cache-stability gate for all three providers"
```

---

## Task 7: Per-converter determinism (incl. the OpenAI token-count path)

**Files:**
- Create: `packages/agent/src/providers/__tests__/converter-determinism.test.ts`
- Reference: `format-converters.ts` (all four converters), `gemini-provider.ts:114-125` (the `Date.now()/Math.random()` tool-id landmine)

- [ ] **Step 1: Write the converter-determinism test**

Feed each converter the corpus twice and assert `JSON.stringify` byte-equality. Include a Gemini fixture whose tool call carries a *persisted* `gemini_echo_<ts>_<rand>`-style id, to prove the converter is deterministic *given a fixed id* (the landmine only fires if an id is re-minted, which happens only in response parsing — outside the converter).

```ts
import { describe, it, expect } from 'vitest';
import {
  convertToAnthropicFormat, convertToOpenAIFormat, convertToGeminiFormat, convertToTextOnlyFormat,
} from '@lace/agent/providers/format-converters';
import { FIXTURES } from './golden/_fixtures';

describe('converter determinism: each converter is a pure function of its input', () => {
  for (const fixture of FIXTURES) {
    it(`all four converters are byte-stable for "${fixture.name}"`, () => {
      expect(JSON.stringify(convertToAnthropicFormat(fixture.messages))).toBe(JSON.stringify(convertToAnthropicFormat(fixture.messages)));
      expect(JSON.stringify(convertToOpenAIFormat(fixture.messages))).toBe(JSON.stringify(convertToOpenAIFormat(fixture.messages)));
      expect(JSON.stringify(convertToGeminiFormat(fixture.messages))).toBe(JSON.stringify(convertToGeminiFormat(fixture.messages)));
      expect(JSON.stringify(convertToTextOnlyFormat(fixture.messages))).toBe(JSON.stringify(convertToTextOnlyFormat(fixture.messages)));
    });
  }

  it('Gemini converter is deterministic given a persisted tool-call id (no re-minting)', () => {
    const messages = [
      { role: 'user' as const, content: 'go' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'gemini_echo_1700000000000_abc123', name: 'echo', input: { v: 'z' } }] },
      { role: 'user' as const, content: '', toolResults: [{ id: 'gemini_echo_1700000000000_abc123', content: [{ type: 'text', text: 'z' }], isError: false }] },
    ];
    expect(JSON.stringify(convertToGeminiFormat(messages))).toBe(JSON.stringify(convertToGeminiFormat(messages)));
  });
});
```

- [ ] **Step 2: Add the OpenAI count-path determinism assertion**

The spec (Invariant 5 / Step 0) requires the OpenAI `countTokensExplicit` wire re-serialization to be covered, because `_countTokensImpl` is live on the no-usage fallback path (`openai-provider.ts:759/1074/1400`). Add a focused test: count tokens for a fixture twice and assert equal. Construct `OpenAIProvider` with no network (token counting via tiktoken is local). Crib construction from `openai-provider.test.ts`.

```ts
import { OpenAIProvider } from '@lace/agent/providers/openai-provider';

describe('OpenAI token-count path is deterministic', () => {
  it('counts the same tokens twice for a fixture', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    provider.setSystemPrompt('You are Lace. Cached system block.');
    // _countTokensImpl is protected; exercise it via the public countTokens entry
    // the provider exposes. Confirm the exact public method name in openai-provider.ts
    // (e.g. provider.countTokens(messages, tools, model)).
    const msgs = FIXTURES[0]!.messages;
    const a = await provider.countTokens(msgs, [], 'gpt-4o');
    const b = await provider.countTokens(msgs, [], 'gpt-4o');
    expect(a).toBe(b);
  });
});
```

> Confirm the public token-counting method name and signature in `openai-provider.ts` (the base class likely exposes `countTokens`). If tiktoken WASM init is async/flaky in CI, mark this `it` with a generous timeout; do not stub tiktoken (that would test the mock).

- [ ] **Step 3: Run — expect GREEN**

Run: `cd packages/agent && npx vitest run src/providers/__tests__/converter-determinism.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/__tests__/converter-determinism.test.ts
git commit -m "test(session-state): per-converter determinism + OpenAI count-path (Invariant 5)"
```

---

## Task 8: Production cache-health signal

**Files:**
- Create: `packages/agent/src/core/conversation/cache-health.ts`
- Create: `packages/agent/src/core/conversation/__tests__/cache-health.test.ts`
- Modify: `packages/agent/src/core/conversation/runner.ts` (after the `turn_end` write, ~line 1134)
- Reference: `runner.ts:1115-1134` (turn_end write + accumulators), `utils/logger.ts`

- [ ] **Step 1: Write the failing test for the pure builder**

```ts
import { describe, it, expect } from 'vitest';
import { buildCacheHealthLog } from '@lace/agent/core/conversation/cache-health';

describe('buildCacheHealthLog', () => {
  it('computes cache-read rate from turn usage', () => {
    const out = buildCacheHealthLog({
      turnId: 't1',
      model: 'claude-opus-4-8',
      inputTokens: 100,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 850,
      outputTokens: 20,
      cacheMissReason: null,
    });
    // read / (read + creation + uncached input)
    expect(out.cacheReadRate).toBeCloseTo(850 / (850 + 50 + 100), 5);
    expect(out.turnId).toBe('t1');
    expect(out.cacheReadInputTokens).toBe(850);
    expect(out.cacheCreationInputTokens).toBe(50);
    expect(out.cacheMissReason).toBe(null);
  });

  it('reports rate 0 when there is no cached read (cold cache)', () => {
    const out = buildCacheHealthLog({
      turnId: 't2', model: 'gpt-4o', inputTokens: 500,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 10, cacheMissReason: 'first_turn',
    });
    expect(out.cacheReadRate).toBe(0);
    expect(out.cacheMissReason).toBe('first_turn');
  });

  it('avoids divide-by-zero when the turn sent no input tokens', () => {
    const out = buildCacheHealthLog({
      turnId: 't3', model: 'm', inputTokens: 0,
      cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, cacheMissReason: null,
    });
    expect(out.cacheReadRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect RED (module missing)**

Run: `cd packages/agent && npx vitest run src/core/conversation/__tests__/cache-health.test.ts`
Expected: FAIL — `buildCacheHealthLog` not found.

- [ ] **Step 3: Implement the pure builder**

```ts
// ABOUTME: Pure builder for the per-turn cache-health log signal. Turns the
// runner's accumulated cache usage into a flat structured record (with a derived
// cache-read rate) for logger.info, so a prefix-cache regression is visible in
// production immediately instead of three weeks later. No I/O, no logger here —
// the runner does the logging; this stays pure and unit-testable.

export type CacheHealthInput = {
  turnId: string;
  model: string;
  inputTokens: number; // uncached input tokens this turn (cumulative across tool-loop calls)
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  cacheMissReason: string | null;
};

export type CacheHealthLog = CacheHealthInput & { cacheReadRate: number };

export function buildCacheHealthLog(input: CacheHealthInput): CacheHealthLog {
  const denom = input.cacheReadInputTokens + input.cacheCreationInputTokens + input.inputTokens;
  const cacheReadRate = denom === 0 ? 0 : input.cacheReadInputTokens / denom;
  return { ...input, cacheReadRate };
}
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd packages/agent && npx vitest run src/core/conversation/__tests__/cache-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the runner**

In `runner.ts`, immediately AFTER the `turn_end` `writeAndAdvance({ type: 'turn_end', ... })` completes (around line 1134), add the log. Use the accumulators already in scope (`totalInputTokens`, `totalCacheCreationInputTokens`, `totalCacheReadInputTokens`, `totalOutputTokens`, `lastCacheMissReason`, `turnId`) and the model id (read the exact in-scope variable name for the model from the surrounding code — likely `this._config`/`modelId`). Import `buildCacheHealthLog` and `logger` at the top of the file (top-level imports per the repo import style).

```ts
logger.info('cache-health: turn complete', buildCacheHealthLog({
  turnId,
  model: modelId, // use the actual in-scope model variable name
  inputTokens: totalInputTokens,
  cacheCreationInputTokens: totalCacheCreationInputTokens,
  cacheReadInputTokens: totalCacheReadInputTokens,
  outputTokens: totalOutputTokens,
  cacheMissReason: lastCacheMissReason ?? null,
}));
```

> Place it in the same `finally`/success path where `turn_end` is written so it fires once per turn. Confirm the exact accumulator variable names by reading `runner.ts` around lines 696-726 and 1115-1134 — use the real names, not these if they differ.

- [ ] **Step 6: Typecheck + run the runner test suite for no regressions**

Run: `cd packages/agent && npx tsc --noEmit && npx vitest run src/core/conversation/`
Expected: PASS, no regressions. (The log line is `info` level; it does not change control flow.)

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/core/conversation/cache-health.ts packages/agent/src/core/conversation/__tests__/cache-health.test.ts packages/agent/src/core/conversation/runner.ts
git commit -m "feat(session-state): per-turn cache-health log signal (prod prefix-regression watch)"
```

---

## Task 9: Full-suite green + measure

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint the whole repo**

Run (from repo root): `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 2: Run the entire agent test suite**

Run: `cd packages/agent && npx vitest run`
Expected: PASS (pre-existing unrelated reds, if any — e.g. apple-container on Linux — are noted in MEMORY as expected; everything this plan added/touched is green).

- [ ] **Step 3: Record a baseline measurement note**

Create `docs/design/step0-baseline.md` with: the date, the golden corpus size (count of `golden/*.json`), and a one-paragraph statement that the byte-identity gates and the cache-health signal are now in place, so Steps 1-5 can be verified byte-for-byte against `packages/agent/src/providers/__tests__/golden/`. This is the "measured before the next step" gate from the spec's build order.

- [ ] **Step 4: Commit**

```bash
git add docs/design/step0-baseline.md
git commit -m "docs(session-state): Step 0 baseline — guardrails in place, gates green"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** Task 2/3/4 = golden-bytes refactor-equivalence gate (per provider). Task 6 = cross-turn cache-stability gate (markers stripped for Anthropic, whole for OpenAI/Gemini). Task 5 = render-determinism (Invariant 5) + the readdir fix it forces. Task 7 = per-converter determinism + the OpenAI count-path coverage the spec calls out. Task 8 = prod cache-health signal. Together these are exactly the three Step 0 deliverables.
- **Out of scope (do NOT do here):** unifying the three coalescers (Step 1), the seq tail-read / `loadSession` change (Step 2), the index/projection/snapshots (Steps 3-4), and the cross-process max-seq authority decision (an open design item to resolve before Step 3). This plan only builds the net.
- **The load-bearing honesty:** the golden snapshots PIN current behavior — including any current bug. If the cross-turn test (Task 6) is red for a provider, that's a real finding to surface, not to snapshot away. The whole point of Step 0 is that later steps can't silently change the bytes.
- **Provider response JSON / constructor shapes / exact field names** (`ToolCall`, `ToolResult`, `ContentBlock` image shape, model ids, the public `countTokens` method, the runner's accumulator variable names) MUST be read from the cited real files, never invented. Several steps say this explicitly.
