# Session-State Architecture — Step 1: One Reducer (`foldEvent`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three divergent event→message coalescers with a single pure reducer `foldEvent`, so the batch rebuild, the compaction-tail build, and the runner's live tail all produce **one canonical message shape** — fixing a real per-parallel-tool-turn cache break (sent shape ≠ rebuilt shape) in the process.

**Architecture:** A new pure module `message-building/fold-event.ts` exports `foldEvent(state, event) => state` and a `foldEvents(events) => state` batch wrapper. The canonical parallel-tool shape is Anthropic's documented form: **one assistant message carrying all `tool_use` blocks for the turn, followed by one user message carrying all `tool_result` blocks.** `buildProviderMessagesFromDurableEvents` and `buildPreservedTail` become thin wrappers over `foldEvents` (keeping their non-reducer concerns — system-prompt extraction, `context_compacted` reset + orphan cleanup, the compaction tail subset). The runner's live tail construction is changed to emit the same canonical shape so what's sent on turn N equals what's rebuilt on turn N+1.

**Tech Stack:** TypeScript, vitest 3.x, `@lace/agent`.

**Safety:** Every change is gated by the Step-0 golden + cross-turn + converter-determinism suites under `packages/agent/src/providers/__tests__/golden/`. The parallel-tool goldens **change deliberately** in this step (that is the bug fix); the cross-turn gate must stay green, and a new parallel-tool fixture must become cross-turn-stable where it would previously have drifted.

---

## Background the implementer needs

**Read first:** `docs/design/session-state-architecture.md` ("Layer 2 — Projections", Invariant 3, and Step 1) and `docs/architecture/prompt-cache-stability.md`.

**The three coalescers today (verified — quoted shapes are real):**

1. `buildProviderMessagesFromDurableEvents(sessionDir)` in
   `packages/agent/src/message-building/message-builder.ts:212-402`. Reads the log,
   two passes: pass 1 extracts `systemPrompt` (last `system_prompt_set` wins, warns on
   >1 per era); pass 2 folds events into `ProviderMessage[]`. Per-event behavior:
   - `prompt` → `extractContentBlocks(data.content)` (preserves images), drops empty.
   - `context_injected` → `extractTextFromContentBlocks` (text only) then
     `appendOrMergeUser(messages, text)` (merges into a trailing user message).
   - `context_compacted` → **reset** `messages` to the `preserved[]` array verbatim,
     then `dropOrphanedToolBlocks(messages)`.
   - `message` → assistant; `content` is `data.content` if string else
     `extractTextFromContentBlocks` (text only); carries `thinkingBlocks`.
   - `tool_use` → append `toolCall` to the trailing assistant (or push a new one);
     if `result`, append to a trailing user-with-results (or push a new user). Because
     the call-append makes the trailing message an assistant, **each result pushes a
     NEW user**, and a second parallel call pushes a **NEW assistant** → split shape.
2. `buildPreservedTail(events)` in `packages/agent/src/compaction/toolkit.ts:415-491`.
   Same `tool_use` coalescing as (1). Differences: passes `data.content` through
   verbatim for `prompt`/`context_injected`/`message` (preserves images everywhere);
   does **not** merge `context_injected`; has **no** `context_compacted` or
   `system_prompt_set` branch (it folds a post-compaction tail subset); runs **no**
   orphan cleanup. Returns `PreservedMessage[]` (toolkit.ts:394-400).
3. The runner's live construction in
   `packages/agent/src/core/conversation/runner.ts`: lines 981-992 push **one**
   assistant `{ content: assistantText, toolCalls: [all calls] }`; the loop at
   1001-1059 (specifically 1041-1044) pushes **one user per tool result**
   `{ role: 'user', content: '', toolResults: [result.coreResult] }`.

**The bug:** each `tool_use` event is written once with call+result together
(`runner.ts:1394-1397` and the other `writeAndAdvance({type:'tool_use', data:{toolCallId,name,kind,input,result}})` sites). For a 2-call turn the log holds
`tool_use(c1,r1)`, `tool_use(c2,r2)`. The runner **sent** `[assistant(c1,c2), user(r1), user(r2)]`; the rebuild **produces** `[assistant(c1), user(r1), assistant(c2), user(r2)]`. Different bytes → the cached prefix from turn N is invalid on turn N+1, on **every** parallel-tool turn.

**The canonical shape (the fix):** for a turn with calls `c1..cN` and results `r1..rN`,
produce exactly:
```
{ role: 'assistant', content: <assistantText>, thinkingBlocks?, toolCalls: [c1..cN] }
{ role: 'user',      content: '',              toolResults: [r1..rN] }
```
Both the reducer (rebuild) and the runner (live) must emit this. This matches the
Anthropic Messages API's documented parallel-tool form and makes sent == rebuilt.

**Shared types** (`packages/agent/src/providers/base-provider.ts`,
`packages/agent/src/tools/types.ts`): `ProviderMessage`, `ContentBlock`
(`text`|`image`), `ToolCall = {id,name,arguments}`, `ToolResult = {id?,content,status,…}`,
`ThinkingBlock`. `coreToolResultFromProtocol` (toolkit.ts:22-49) maps a protocol
result → `CoreToolResult`.

**Helpers to keep:** `extractContentBlocks`, `extractTextFromContentBlocks`,
`appendOrMergeUser` (message-builder.ts / message-building/append-or-merge.ts),
`dropOrphanedToolBlocks` (message-builder.ts:115-191). These are **not** part of
`foldEvent`'s tool coalescing — they are the rebuild-only concerns layered around it.

**Callers / blast radius:** `buildProviderMessagesFromDurableEvents` is called at
`runner.ts:431`, `session-operations.ts:185/205/211`, and re-exported. `buildPreservedTail`
is called at `track-compaction.ts:197,274`. Behavior-pinning tests:
`message-builder.test.ts`, `compaction/toolkit.test.ts` (notably the
"coalesces consecutive tool_use" tests at ~246-292 that assert the **split** shape —
those assertions change in this step).

**Test command:** `cd packages/agent && npx vitest run <path>` (`-u` to regenerate golden snapshots).

---

## File Structure

**Create:**
- `packages/agent/src/message-building/fold-event.ts` — the pure reducer: `FoldState`, `foldEvent(state, event)`, `foldEvents(events)`, and the canonical tool-batch logic. One responsibility: events → canonical `ProviderMessage[]`.
- `packages/agent/src/message-building/__tests__/fold-event.test.ts` — reducer unit tests + the incremental==batch fuzz.
- `packages/agent/src/message-building/__tests__/sent-vs-rebuilt.test.ts` — the characterization gate proving sent-shape == rebuilt-shape for a parallel-tool turn.

**Modify:**
- `packages/agent/src/message-building/message-builder.ts` — `buildProviderMessagesFromDurableEvents` delegates folding to `foldEvents`, keeping pass-1 system-prompt extraction, the `context_compacted` reset + `dropOrphanedToolBlocks`, `context_injected` merge, and empty-`prompt` drop.
- `packages/agent/src/compaction/toolkit.ts` — `buildPreservedTail` delegates to `foldEvents` (tail subset; verbatim content).
- `packages/agent/src/core/conversation/runner.ts` — the live tail at 1041-1044 accumulates results into one user message per tool batch (canonical shape).
- `packages/agent/src/compaction/toolkit.test.ts` — update the two coalescing assertions to the canonical shape (deliberate).
- Regenerated golden snapshots under `packages/agent/src/providers/__tests__/golden/` (new parallel-tool fixture + the shape change).

---

## Task 1: Characterization — prove the sent-vs-rebuilt cache break (RED)

**Files:**
- Create: `packages/agent/src/message-building/__tests__/sent-vs-rebuilt.test.ts`
- Reference: `runner.ts:981-992,1041-1044` (live shape), `message-builder.ts:364-398` (rebuild shape)

This test does not depend on `foldEvent` yet. It builds the two shapes the two paths
produce for the same 2-call parallel-tool turn and asserts they are equal. It is
committed now as a vitest `it.fails(...)` (which PASSES while the bodied assertion
fails — documenting the bug with green CI), and Task 5 flips `it.fails` → `it` once the
reducer + runner are unified.

- [ ] **Step 1: Write the characterization test (as `it.fails`)**

```ts
// ABOUTME: Pins that the message shape the runner SENDS for a parallel-tool turn
// equals the shape rebuilt from the durable events for the same turn. They differ
// today (the cache break this step fixes); this test is RED until the reducer and
// the runner emit the one canonical shape.
import { describe, it, expect } from 'vitest';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The live shape the runner produces for a 2-call turn (assistant text + 2 calls,
// then one user per result). Mirror runner.ts:981-992 + 1041-1044 exactly.
function liveShape() {
  return [
    { role: 'assistant', content: 'doing two things', toolCalls: [
      { id: 'c1', name: 'echo', arguments: { v: 'a' } },
      { id: 'c2', name: 'echo', arguments: { v: 'b' } },
    ] },
    { role: 'user', content: '', toolResults: [{ id: 'c1', content: [{ type: 'text', text: 'a' }], status: 'completed' }] },
    { role: 'user', content: '', toolResults: [{ id: 'c2', content: [{ type: 'text', text: 'b' }], status: 'completed' }] },
  ];
}

describe('sent shape equals rebuilt shape for a parallel-tool turn', () => {
  // it.fails: PASSES while the assertion below fails — pins the known cache break.
  // Task 5 flips this to a plain it(...) once the reducer + runner are unified.
  it.fails('runner-sent messages match the rebuild from durable events', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lace-svr-'));
    try {
      const events = [
        { eventSeq: 1, timestamp: '2026-06-18T00:00:00Z', type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'sys' } },
        { eventSeq: 2, timestamp: '2026-06-18T00:00:01Z', type: 'prompt', data: { content: [{ type: 'text', text: 'do two things' }] } },
        { eventSeq: 3, timestamp: '2026-06-18T00:00:02Z', type: 'message', data: { content: 'doing two things' } },
        { eventSeq: 4, timestamp: '2026-06-18T00:00:03Z', type: 'tool_use', data: { toolCallId: 'c1', name: 'echo', kind: 'read', input: { v: 'a' }, result: { outcome: 'completed', content: [{ type: 'text', text: 'a' }] } } },
        { eventSeq: 5, timestamp: '2026-06-18T00:00:04Z', type: 'tool_use', data: { toolCallId: 'c2', name: 'echo', kind: 'read', input: { v: 'b' }, result: { outcome: 'completed', content: [{ type: 'text', text: 'b' }] } } },
      ];
      writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

      const { messages: rebuilt } = buildProviderMessagesFromDurableEvents(dir);
      // Compare the assistant+tool portion (drop the prompt user message at index 0).
      const rebuiltTail = rebuilt.slice(1);
      expect(JSON.stringify(rebuiltTail)).toBe(JSON.stringify(liveShape()));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

> Confirm the durable `tool_use` event's `result` field shape (`{ outcome, content }`) against a real event — read `coreToolResultFromProtocol` (toolkit.ts:22-49) and an existing fixture in `message-builder.test.ts` to match the protocol result shape exactly. Adjust the event JSON if it differs.

- [ ] **Step 2: Run — expect RED**

Run: `cd packages/agent && npx vitest run src/message-building/__tests__/sent-vs-rebuilt.test.ts`
Expected: FAIL — rebuilt is the split shape `[assistant(c1), user(r1), assistant(c2), user(r2)]`, not the canonical `liveShape()`.

- [ ] **Step 3: Commit (the failing characterization, marked)**

Leave the test failing is NOT acceptable to commit on its own. Instead, do not commit yet — this test goes green at Task 5. Note its RED output and proceed to Task 2. (Commit it together with Task 5 when it passes.)

---

## Task 2: The pure `foldEvent` reducer (canonical shape)

**Files:**
- Create: `packages/agent/src/message-building/fold-event.ts`
- Create: `packages/agent/src/message-building/__tests__/fold-event.test.ts`

- [ ] **Step 1: Write the reducer unit tests first (RED)**

Cover: single tool call+result; **two parallel calls+results → one assistant(2 calls) + one user(2 results)**; a `message` between two tool batches starts a fresh batch; `prompt`/`context_injected` close a batch; thinking blocks ride the assistant; and `foldEvents(events)` equals folding the same events one at a time (incremental == batch).

```ts
import { describe, it, expect } from 'vitest';
import { foldEvent, foldEvents, initialFoldState } from '@lace/agent/message-building/fold-event';

const toolEvent = (id: string, v: string) => ({
  type: 'tool_use' as const,
  data: { toolCallId: id, name: 'echo', kind: 'read', input: { v }, result: { outcome: 'completed', content: [{ type: 'text', text: v }] } },
});

describe('foldEvent canonical tool-batch shape', () => {
  it('two parallel calls fold into one assistant(2 calls) + one user(2 results)', () => {
    const events = [
      { type: 'message' as const, data: { content: 'doing two things' } },
      toolEvent('c1', 'a'),
      toolEvent('c2', 'b'),
    ];
    const { messages } = foldEvents(events);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'doing two things' });
    expect(messages[0].toolCalls?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(messages[1]).toMatchObject({ role: 'user', content: '' });
    expect(messages[1].toolResults?.map((r) => r.id)).toEqual(['c1', 'c2']);
  });

  it('a message between two tool batches starts a fresh batch', () => {
    const events = [
      { type: 'message' as const, data: { content: 'first' } }, toolEvent('c1', 'a'),
      { type: 'message' as const, data: { content: 'second' } }, toolEvent('c2', 'b'),
    ];
    const { messages } = foldEvents(events);
    // assistant(first,c1), user(r1), assistant(second,c2), user(r2)
    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user']);
    expect(messages[0].toolCalls?.map((c) => c.id)).toEqual(['c1']);
    expect(messages[2].toolCalls?.map((c) => c.id)).toEqual(['c2']);
  });

  it('incremental fold equals batch fold', () => {
    const events = [
      { type: 'message' as const, data: { content: 'x' } }, toolEvent('c1', 'a'), toolEvent('c2', 'b'),
      { type: 'prompt' as const, data: { content: [{ type: 'text', text: 'next' }] } },
    ];
    let s = initialFoldState();
    for (const e of events) s = foldEvent(s, e);
    expect(JSON.stringify(s.messages)).toBe(JSON.stringify(foldEvents(events).messages));
  });
});
```

- [ ] **Step 2: Run — expect RED (module missing)**

Run: `cd packages/agent && npx vitest run src/message-building/__tests__/fold-event.test.ts`
Expected: FAIL — `fold-event` not found.

- [ ] **Step 3: Implement `foldEvent`**

The reducer is pure: `foldEvent(state, event) => state`. State carries the message list
and a pointer to the current tool batch (the assistant index and the user index) so
that a second parallel call appends to the same assistant (not the trailing message)
and a second result appends to the same user. Any non-`tool_use` event closes the batch.

```ts
// ABOUTME: The single pure reducer that folds durable events into the canonical
// ProviderMessage[] shape. One assistant carries all of a turn's tool_use blocks;
// one user carries all of that turn's tool_result blocks (the Anthropic parallel-
// tool form). This is the one place event->message coalescing happens; the batch
// rebuild, the compaction-tail build, and the runner's live tail all share it, so
// the shape sent on turn N equals the shape rebuilt on turn N+1.

import type { ProviderMessage, ContentBlock, ThinkingBlock } from '@lace/agent/providers/base-provider';
import type { ToolCall as CoreToolCall, ToolResult as CoreToolResult } from '@lace/agent/tools/types';
import { coreToolResultFromProtocol } from '@lace/agent/compaction/toolkit'; // or its shared home — confirm import path
import { toNonEmptyString } from '@lace/agent/message-building/message-builder'; // confirm export; else inline

export type FoldEventInput =
  | { type: 'prompt'; data: { content: unknown } }
  | { type: 'context_injected'; data: { content: unknown } }
  | { type: 'message'; data: { content?: unknown; thinkingBlocks?: unknown } }
  | { type: 'tool_use'; data: { toolCallId?: unknown; name?: unknown; input?: unknown; result?: unknown } };

export type FoldState = {
  messages: ProviderMessage[];
  // Open tool batch for the current turn: indices into messages, or null between turns.
  batch: { assistantIdx: number; userIdx: number | null } | null;
};

export function initialFoldState(): FoldState {
  return { messages: [], batch: null };
}

// Content helpers: the reducer keeps content VERBATIM (string or ContentBlock[]).
// Callers that need text-flattening (context_injected merge in message-builder) do
// it BEFORE calling foldEvent; the reducer itself never drops image blocks.
function asContent(raw: unknown): string | ContentBlock[] {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw as ContentBlock[];
  return '';
}

export function foldEvent(state: FoldState, event: FoldEventInput): FoldState {
  const messages = state.messages.slice();

  if (event.type === 'tool_use') {
    const id = toNonEmptyString(event.data.toolCallId);
    const name = toNonEmptyString(event.data.name);
    if (!id || !name) return { messages, batch: state.batch };
    const call: CoreToolCall = {
      id, name,
      arguments: typeof event.data.input === 'object' && event.data.input ? (event.data.input as Record<string, unknown>) : {},
    };

    // Find/establish the batch assistant: reuse the open batch's assistant; else
    // adopt a trailing assistant; else push a new empty assistant.
    let batch = state.batch;
    if (!batch) {
      const lastIdx = messages.length - 1;
      if (lastIdx >= 0 && messages[lastIdx]!.role === 'assistant') {
        batch = { assistantIdx: lastIdx, userIdx: null };
      } else {
        messages.push({ role: 'assistant', content: '', toolCalls: [] });
        batch = { assistantIdx: messages.length - 1, userIdx: null };
      }
    }
    const a = messages[batch.assistantIdx]!;
    messages[batch.assistantIdx] = { ...a, toolCalls: [...(a.toolCalls ?? []), call] };

    if (event.data.result) {
      const result: CoreToolResult = coreToolResultFromProtocol(event.data.result, id);
      if (batch.userIdx === null) {
        messages.push({ role: 'user', content: '', toolResults: [result] });
        batch = { assistantIdx: batch.assistantIdx, userIdx: messages.length - 1 };
      } else {
        const u = messages[batch.userIdx]!;
        messages[batch.userIdx] = { ...u, toolResults: [...(u.toolResults ?? []), result] };
      }
    }
    return { messages, batch };
  }

  // Any non-tool_use event closes the batch.
  if (event.type === 'message') {
    const content = asContent(event.data.content);
    const thinkingBlocks = Array.isArray(event.data.thinkingBlocks) && event.data.thinkingBlocks.length > 0
      ? (event.data.thinkingBlocks as ThinkingBlock[]) : undefined;
    messages.push({ role: 'assistant', content, ...(thinkingBlocks ? { thinkingBlocks } : {}) });
    return { messages, batch: null };
  }

  if (event.type === 'prompt' || event.type === 'context_injected') {
    messages.push({ role: 'user', content: asContent(event.data.content) });
    return { messages, batch: null };
  }

  return { messages, batch: state.batch };
}

export function foldEvents(events: FoldEventInput[]): FoldState {
  let s = initialFoldState();
  for (const e of events) s = foldEvent(s, e);
  return s;
}
```

> Confirm the import path for `coreToolResultFromProtocol` and `toNonEmptyString` (they live in `compaction/toolkit.ts` and `message-builder.ts` today; if importing from those creates a cycle, move the helper into a shared `message-building/` module and re-export). Do NOT duplicate the helper.
> Note the reducer keeps content VERBATIM (no image-dropping). The `message`-event text-flattening that `message-builder` does today via `extractTextFromContentBlocks` is a **behavior question** — see Task 3 Step 2.

- [ ] **Step 4: Add the incremental==batch fuzz**

Append a fuzz test: generate random sequences of `message`/`prompt`/`tool_use` (with and without results, 1-4 calls per batch) and assert `foldEvents(seq)` equals folding one-by-one. Use a seeded PRNG (a small LCG with a fixed seed — no `Math.random()` so it's reproducible).

- [ ] **Step 5: Run — expect GREEN; commit**

Run: `cd packages/agent && npx vitest run src/message-building/__tests__/fold-event.test.ts`
Expected: PASS.

```bash
git add packages/agent/src/message-building/fold-event.ts packages/agent/src/message-building/__tests__/fold-event.test.ts
git commit -m "feat(session-state): pure foldEvent reducer with canonical parallel-tool shape"
```

---

## Task 3: Migrate `buildProviderMessagesFromDurableEvents` to `foldEvent`

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts`
- Reference tests: `packages/agent/src/message-building/message-builder.test.ts`

- [ ] **Step 1: Delegate the fold; keep the rebuild-only concerns**

Rewrite pass 2 to drive `foldEvent`, while keeping: pass-1 system-prompt extraction
(unchanged); the empty-`prompt` drop; the `context_injected` text-flatten + merge
(call `appendOrMergeUser` — NOT plain push, to preserve current merge behavior); the
`context_compacted` reset to `preserved[]` + `dropOrphanedToolBlocks`; and image
preservation for `prompt` (keep `extractContentBlocks`). Concretely: iterate events;
for `prompt`/`message`/`tool_use` feed `foldEvent`; for `context_injected` and
`context_compacted` apply the existing special handling and **reset the fold batch**
(start a fresh `FoldState` seeded with the current `messages`). The cleanest structure
is to keep a `FoldState` and, for the special events, mutate `state.messages` directly
then set `state.batch = null`.

> Image/text decision (resolve explicitly, do not hand-wave): today `message`-event
> content is text-flattened by `extractTextFromContentBlocks` in this path, but
> `buildPreservedTail` passes it through verbatim. The canonical reducer passes through
> verbatim. Assistant `message` events in practice carry **string** content (the
> assistant's text), so flatten-vs-verbatim is a no-op for the common case; verify by
> grepping real transcripts / the `message` event writer. Adopt **verbatim** (the
> reducer's behavior) for consistency, and if any test depended on flattening a
> ContentBlock[] assistant message, update it deliberately and note why.

- [ ] **Step 2: Run the existing message-builder tests; update deliberately**

Run: `cd packages/agent && npx vitest run src/message-building/message-builder.test.ts`
Expected: the orphan-recovery, system-prompt, and context_injected tests PASS unchanged.
Any test asserting the **split** parallel-tool shape must change to the canonical shape
— update it and add a one-line comment that the canonical shape is the fix. If a test
fails for any *other* reason, STOP and investigate (it may be a real regression).

- [ ] **Step 3: Regenerate the golden corpus + add a parallel-tool fixture**

Add a `tool-call-parallel-two` fixture to
`packages/agent/src/providers/__tests__/golden/_fixtures.ts` (an assistant with two
`toolCalls` and one user with two `toolResults` — the canonical shape). Regenerate:
`cd packages/agent && npx vitest run -u src/providers/__tests__/golden/`, then run
without `-u`. **Review the diff**: the new fixture's goldens appear; existing goldens
should be unchanged (the existing fixtures have ≤1 tool call). Commit the regenerated goldens.

- [ ] **Step 4: Verify + commit**

Run: `cd packages/agent && npx vitest run src/message-building src/providers/__tests__/golden && npx tsc --noEmit`
Expected: PASS.

```bash
git add packages/agent/src/message-building/message-builder.ts packages/agent/src/message-building/message-builder.test.ts packages/agent/src/providers/__tests__/golden/_fixtures.ts packages/agent/src/providers/__tests__/golden/*.json
git commit -m "refactor(session-state): buildProviderMessagesFromDurableEvents folds via foldEvent"
```

---

## Task 4: Migrate `buildPreservedTail` to `foldEvent`

**Files:**
- Modify: `packages/agent/src/compaction/toolkit.ts`
- Modify: `packages/agent/src/compaction/toolkit.test.ts`

- [ ] **Step 1: Delegate to `foldEvents`**

`buildPreservedTail(events)` becomes: map the typed tail events to `FoldEventInput`
and return `foldEvents(...).messages` as `PreservedMessage[]` (the types are
structurally identical — `PreservedMessage` is `ProviderMessage` minus nothing
relevant; confirm and, if identical, have `buildPreservedTail` return the reducer's
messages directly). The tail contains no `context_compacted`/`system_prompt_set`, so no
special handling is needed. Verbatim content is already what the reducer does.

- [ ] **Step 2: Update the two coalescing assertions (deliberate)**

In `toolkit.test.ts`, the test "coalesces consecutive tool_use events" currently asserts
the **split** shape (2 assistants, 2 users for interleaved results). Change it to the
canonical shape: **one assistant with both calls, one user with both results.** Add a
one-line comment: the canonical parallel-tool shape is what the runner now sends, so the
preserved tail matches it. Keep the "coalesces multiple tool_calls when no results" test
(it already asserts one assistant with 2 calls — still true).

- [ ] **Step 3: Run — expect GREEN; commit**

Run: `cd packages/agent && npx vitest run src/compaction && npx tsc --noEmit`
Expected: PASS (the compaction strategy/byte-safe seam tests must stay green — the
preserved array shape changed but is still valid and orphan-free for live turns).

```bash
git add packages/agent/src/compaction/toolkit.ts packages/agent/src/compaction/toolkit.test.ts
git commit -m "refactor(session-state): buildPreservedTail folds via foldEvent (canonical shape)"
```

---

## Task 5: Make the runner's live tail emit the canonical shape

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` (the tool loop, ~1001-1059)
- Create/commit: `packages/agent/src/message-building/__tests__/sent-vs-rebuilt.test.ts` (from Task 1) now goes green

- [ ] **Step 1: Accumulate results into one user per tool batch**

Today (runner.ts:1041-1044) each tool result pushes a **new** user message. Change it
so all results of the current batch accumulate into a **single** trailing user message,
matching the canonical shape (the assistant with all calls was already pushed once at
981-992). Concretely: before the per-call loop, after pushing the assistant message,
push one empty `{ role: 'user', content: '', toolResults: [] }`; inside the loop, append
`result.coreResult` to that message's `toolResults` instead of pushing a new user.
Keep the existing `shouldContinue`/`permission_cancelled` handling unchanged.

> Read 1001-1059 carefully: the loop also handles `shouldContinue=false` mid-batch.
> Ensure the single-user accumulation still holds if the batch stops early (a partial
> result set in one user message is fine and matches what a partial rebuild produces).
> Do not change control flow other than where results are appended.

- [ ] **Step 2: Flip the characterization test `it.fails` → `it` (now genuinely GREEN)**

The reducer + runner are now unified, so the assertion passes — which means `it.fails`
would now FAIL (it expects a failure). Change `it.fails(` back to `it(` in
`sent-vs-rebuilt.test.ts` and remove the two-line `it.fails` comment.

Run: `cd packages/agent && npx vitest run src/message-building/__tests__/sent-vs-rebuilt.test.ts`
Expected: PASS — rebuilt tail now equals the canonical live shape.

Then run the runner suite for regressions:
`cd packages/agent && npx vitest run src/core/conversation && npx tsc --noEmit`
Expected: PASS. Any runner test asserting the old N-user shape is updated deliberately.

```bash
git add packages/agent/src/core/conversation/runner.ts packages/agent/src/message-building/__tests__/sent-vs-rebuilt.test.ts
git commit -m "fix(session-state): runner emits canonical parallel-tool shape (sent == rebuilt, closes the cache break)"
```

---

## Task 6: Full verification + evergreen doc

**Files:**
- Create: `packages/agent/src/providers/__tests__/golden/cross-turn-parallel-tool.test.ts` (or extend the cross-turn test)
- Modify: `docs/architecture/prompt-cache-stability.md` (add the reducer + canonical-shape section)

- [ ] **Step 1: Add a cross-turn parallel-tool stability assertion**

Extend `cross-turn-cache-stability.test.ts` (or add a sibling) with a two-turn scenario
whose turn 1 includes a parallel-tool exchange, asserting the shared prefix (through the
parallel-tool turn) is byte-stable across turn 2. Before this step it would have drifted;
now it is stable. Run and confirm GREEN.

- [ ] **Step 2: Full Step-0 + Step-1 gate run**

Run (repo root): `npm run typecheck && npm run lint`
Run: `cd packages/agent && npx vitest run src/message-building src/compaction src/core/conversation src/providers/__tests__/golden`
Expected: PASS (the known environmental `ollama-integration.test.ts` red is unrelated).

- [ ] **Step 3: Document the reducer in the evergreen doc**

Add a section to `docs/architecture/prompt-cache-stability.md` (present-tense, no refs):
"**One reducer.** Events become messages through a single pure reducer
(`packages/agent/src/message-building/fold-event.ts`). A turn's parallel tool calls fold
into one assistant message carrying all `tool_use` blocks followed by one user message
carrying all `tool_result` blocks — the Anthropic parallel-tool form. The batch rebuild
(`buildProviderMessagesFromDurableEvents`), the compaction tail (`buildPreservedTail`),
and the runner's live tail all share this reducer, so the shape sent on one turn is the
shape rebuilt on the next, and the cached prefix holds across parallel-tool turns." Note
that `context_compacted` reset + `dropOrphanedToolBlocks` and the `context_injected`
text-merge remain rebuild-only concerns layered around the reducer.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/__tests__/golden/ docs/architecture/prompt-cache-stability.md
git commit -m "test+docs(session-state): cross-turn parallel-tool stability + reducer doc"
```

---

## Self-review notes (for the executor)

- **The canonical shape is the contract:** one assistant (all `tool_use`) + one user
  (all `tool_result`) per turn. All three paths must produce it. The whole point is
  sent == rebuilt, proven by `sent-vs-rebuilt.test.ts`.
- **Deliberate golden/test changes:** the parallel-tool goldens and the two
  `toolkit.test.ts` coalescing assertions change *on purpose* (the bug fix). Single-tool
  and non-tool goldens must NOT change — if they do, that's an unintended regression;
  STOP.
- **Keep rebuild-only concerns out of the reducer:** system-prompt extraction,
  `context_compacted` reset + `dropOrphanedToolBlocks`, `context_injected` text-merge,
  and empty-`prompt` drop stay in `buildProviderMessagesFromDurableEvents`. The reducer
  is pure event→message folding with verbatim content.
- **Do not touch seq derivation, the index, or snapshots** — those are Steps 2-4.
- **No invented details:** confirm `coreToolResultFromProtocol`/`toNonEmptyString` import
  paths, the protocol `result` shape in `tool_use` events, and `PreservedMessage` vs
  `ProviderMessage` structural identity against source before finalizing.
