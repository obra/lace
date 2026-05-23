# Cache-Control Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the invariant *"the system prompt is the bytes computed at session creation and does not change for the lifetime of the session"*, fix the regressions introduced by PRI-1804/1806, and close the remaining cache-prefix determinism holes that the adversarial reviews surfaced.

**Architecture:** Introduce a new durable event type `system_prompt_set` that holds the rendered system-prompt text and is written exactly once at session creation. Session-rebuild reads this single event to recover the frozen prompt. All `context_injected` events become `role: 'user'` messages — they are runtime context, not part of the system prompt. `getEffectiveSystemPrompt` ignores `messages` entirely and returns only the value set via `setSystemPrompt`. The runner reads the frozen prompt at the top of each `run()` and pushes it into the provider before any request. Variable interpolation (sessionDate, git status, project tree, OS, tools) runs exactly once at session creation and the rendered text is what gets persisted.

**Tech Stack:** TypeScript 5.6+, Vitest, Anthropic SDK 0.60, durable-event-sourced session storage (JSONL), monorepo (`packages/agent`).

---

## File Structure

**New files:**
- `packages/agent/src/storage/system-prompt-event.ts` — helpers for writing/reading the new event type
- `packages/agent/src/providers/__tests__/cache-control-streaming.test.ts` — streaming-path cache_control smoke test
- `packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts` — two-turn byte-compare test asserting message prefix invariance
- `packages/agent/src/providers/__tests__/anthropic-provider-count-tokens.test.ts` — verifies `countTokensExplicit` shape parity with `_createRequestPayload`

**Modified files:**
- `packages/agent/src/storage/event-types.ts` — add `SystemPromptSetEventData` to the discriminated union
- `packages/agent/src/rpc/handlers/session.ts` — write `system_prompt_set` event at session creation instead of two `context_injected` events
- `packages/agent/src/message-building/message-builder.ts` — return `{messages, systemPrompt}` instead of `ProviderMessage[]`; convert `context_injected` to `role:'user'`
- `packages/agent/src/core/conversation/runner.ts` — read frozen system prompt, call `provider.setSystemPrompt()` once per run; fix loop-reminder double-injection
- `packages/agent/src/providers/base-provider.ts` — `getEffectiveSystemPrompt` returns only `_systemPrompt`, no fallback string
- `packages/agent/src/providers/openai-provider.ts` — use base helper instead of inline join
- `packages/agent/src/providers/cache-control.ts` — fix `enforceBreakpointBudget` to evict tail first AND handle system/tools overflow; expand cacheable-block whitelist; anchor Bedrock substring matching
- `packages/agent/src/providers/format-converters.ts` — drop `(no response)` placeholder; emit empty assistant turns correctly
- `packages/agent/src/tools/executor.ts` — replace `localeCompare` with byte-stable comparison

**Test files updated:**
- `packages/agent/src/providers/__tests__/anthropic-provider.test.ts` — multi-system-message test updated for new invariant
- `packages/agent/src/providers/__tests__/cache-control.test.ts` — `enforceBreakpointBudget` policy tests updated to expect tail-first eviction
- `packages/agent/src/message-building/message-builder.test.ts` (if it exists) or `packages/agent/src/__tests__/system-prompt-injection.test.ts` — update for new event type

---

## Background — what you need to know

### Current data flow (broken)

1. **Session creation** (`rpc/handlers/session.ts:413-461`) calls `loadPromptConfig` which interpolates `sessionDate`, git status, project tree, etc. into the persona template. Two `context_injected` events are written with `priority: 'normal'`: one for the persona, one for `userInstructions`.

2. **Session rebuild** (`message-building/message-builder.ts:171-177`) reads `events.jsonl` and converts EVERY `context_injected` event — regardless of priority — into `role: 'system'` messages.

3. **Provider request** (`providers/base-provider.ts:571-599`) concatenates all `role: 'system'` messages via `getEffectiveSystemPrompt`, joins with `\n\n`, falls back to literal `"You are a helpful assistant."` if none found. Result wraps into a single `TextBlockParam` with `cache_control`.

**Bugs this causes:**
- Every peer `ent/session/inject` adds another `context_injected` event → becomes `role:'system'` → concatenated into a single text block → the single text block's bytes change → the entire system cache invalidates.
- The PRI-1804 #4 "fix" persisted the loop-reminder as `context_injected` AND pushed it in-memory as `role:'user'` without advancing `lastSeenEventSeq`. Next turn re-reads it as `role:'system'`. Result: the reminder appears twice in the SAME run AND migrates between roles across restarts.
- `GitVariableProvider` runs every time `loadPromptConfig` runs. If we ever re-render (we don't right now, but the invariant should be loud), a single new untracked file mutates `clean → dirty` and busts the system cache.
- The `sessionDate` (PRI-1804 #1) is only stable across a UTC day. At midnight UTC, the next session has a different prompt.

### Desired data flow

1. **Session creation** writes a single `system_prompt_set` event holding the FULL rendered text (persona + userInstructions concatenated with `\n\n`).

2. **Session rebuild** reads the `system_prompt_set` event into a returned `systemPrompt: string`. All `context_injected` events become `role: 'user'` messages (they are runtime context, not session-foundational).

3. **Runner** reads the frozen `systemPrompt` from rebuild output. Calls `provider.setSystemPrompt(text)` once before the first turn. The provider's `_systemPrompt` field never changes again for the session lifetime.

4. **Provider request** — `getEffectiveSystemPrompt(messages)` returns `_systemPrompt` directly. It does not walk messages. Empty `_systemPrompt` throws (no silent fallback string).

5. **`cache_control` on `system[0]`** is stable across the entire session — first request writes the cache, every subsequent request reads it.

### Backward compatibility

Per project policy in `CLAUDE.md`, we do not preserve back-compat code paths. However, sessions in flight when this change deploys still have only old-style `context_injected` events. Approach: when rebuilding such sessions, the message-builder detects the absence of `system_prompt_set` and treats the first run of `context_injected` events (those written before the first `prompt` event) as the legacy system prompt, hoisting them into `systemPrompt`. New sessions always go through `system_prompt_set` and never trip the legacy path.

### How tests work here

- Vitest. Run from `packages/agent` (cwd matters — workspaces).
- Mock the Anthropic SDK by `vi.mock('@anthropic-ai/sdk', ...)` (existing pattern in tests).
- The local-HTTP-server smoke pattern from `anthropic-provider-smoke-pri-1799.test.ts` is the standard for wire-level assertions.
- Vi config: `npx vitest --run src/path/to/test.ts` runs a single file.
- Test fixtures often use `tmpdir()` + `mkdirSync` for ephemeral session dirs.

### How runner reminders persist

Runner uses `appendDurableEvent(sessionDir, ...)` via the `writeAndAdvance` helper. `lastSeenEventSeq` is the watermark for re-reading immediate injects from peers (PRI-1691). If we write a durable event from the runner itself and DON'T advance `lastSeenEventSeq`, the next iteration's `readImmediateInjectsSince` re-emits the same event into `providerMessages`.

---

# Phase 1: Urgent Regressions

These tasks fix bugs introduced by PRI-1804 and PRI-1806 that are live on `main` right now. They are independent of the architectural changes in Phase 2 — do them first so the bleeding stops.

---

### Task 1A: Stop loop-reminder double-injection

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts:245-264`
- Test: `packages/agent/src/core/conversation/runner-loop-reminder.test.ts` (new)

**Problem:** PRI-1804 #4 introduced `writeAndAdvance` for the reminder but also kept the in-memory append. Plus `lastSeenEventSeq` isn't advanced after the write. Next iteration's `readImmediateInjectsSince` re-reads the just-written event and appends it again. The model sees the reminder twice.

**Resolution:** Write durably AND advance `lastSeenEventSeq` so the next iteration's re-read won't pick it up again. DO NOT also push in-memory — the next iteration's re-read would have done that anyway, but we already pushed it. Simpler fix: push in-memory only (don't persist). Or: push in-memory AND advance the watermark.

The cleanest: push in-memory, don't persist. The reminder is ephemeral runtime guidance; it doesn't need to survive restart. If a session restarts mid-conversation, missing one reminder at turn 50 is fine.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/core/conversation/runner-loop-reminder.test.ts`:

```typescript
// ABOUTME: Regression test for PRI-1804 #4 — loop reminder must not appear
// twice in the message stream within one run().

import { describe, it, expect } from 'vitest';

// We test the property directly by reading the runner source and asserting
// the structural invariant: the reminder is pushed in-memory ONCE per
// LOOP_CHECK_INTERVAL boundary and is not also persisted via writeAndAdvance.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PRI-1804 #4 regression — loop reminder must not double-inject', () => {
  it('runner.ts does not call writeAndAdvance for the loop reminder', () => {
    const src = readFileSync(
      join(__dirname, 'runner.ts'),
      'utf8'
    );
    // Find the reminder block (anchor on the LOOP_CHECK_INTERVAL guard).
    const blockMatch = src.match(
      /completedTurns % ConversationRunner\.LOOP_CHECK_INTERVAL[\s\S]{0,1200}/
    );
    expect(blockMatch).not.toBeNull();
    const block = blockMatch![0];
    // The reminder block must NOT persist via writeAndAdvance.
    // (Persisting causes the next iteration's re-read to duplicate it.)
    expect(block).not.toContain('writeAndAdvance');
  });

  it('runner.ts still pushes the reminder into providerMessages in-memory', () => {
    const src = readFileSync(join(__dirname, 'runner.ts'), 'utf8');
    const blockMatch = src.match(
      /completedTurns % ConversationRunner\.LOOP_CHECK_INTERVAL[\s\S]{0,1200}/
    );
    const block = blockMatch![0];
    expect(block).toContain('providerMessages');
    expect(block).toContain('system-reminder');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/core/conversation/runner-loop-reminder.test.ts`
Expected: FAIL — "expected not to contain `writeAndAdvance`" (current code has `writeAndAdvance` inside the block).

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/core/conversation/runner.ts`, replace lines 245-264 with:

```typescript
        // Inject a reminder every LOOP_CHECK_INTERVAL turns to help detect
        // stuck loops. PRI-1804 #4 (revised after adversarial review): push
        // the reminder into providerMessages in-memory ONLY. Do NOT persist
        // it as a context_injected event — persisting caused the next
        // iteration's readImmediateInjectsSince to re-read and re-append
        // the same reminder, doubling it in the message stream. The
        // reminder is intentionally ephemeral runtime guidance; if the
        // session restarts mid-run, missing one nudge at turn 50 is fine.
        if (completedTurns > 0 && completedTurns % ConversationRunner.LOOP_CHECK_INTERVAL === 0) {
          const reminder =
            '<system-reminder>You have completed many agentic turns. If you believe you are stuck in a loop or not making progress, stop and ask the user for guidance. Otherwise, continue.</system-reminder>';
          providerMessages = [...providerMessages, { role: 'user' as const, content: reminder }];
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/core/conversation/runner-loop-reminder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/runner-loop-reminder.test.ts
git commit -m "fix(runner): stop loop-reminder double-injection (regression of PRI-1804 #4)

Adversarial review found that persisting the reminder durably AND
pushing it in-memory caused the next iteration's re-read to duplicate
it. The fix is simpler than the original PRI-1804 #4 attempt: push
in-memory only. The reminder is ephemeral runtime guidance; missing
one at turn 50 across a process restart is acceptable.
"
```

---

### Task 1B: Fix `enforceBreakpointBudget` eviction direction

**Files:**
- Modify: `packages/agent/src/providers/cache-control.ts:260-295`
- Test: `packages/agent/src/providers/__tests__/cache-control.test.ts:288-318` (existing test gets updated)

**Problem:** Current implementation strips the OLDEST cache_control marker first. By construction in a Lace request, the oldest marker is the stable anchor. Stripping the anchor first defeats PRI-1802 — exactly the breakpoint that PRI-1802 added to defeat the 20-block lookback window.

**Resolution:** Strip the NEWEST marker first (the rolling tail). The tail is regenerated cheaply on every turn (every turn writes a new tail breakpoint anyway); evicting it loses one turn's cache extension but preserves the long-lived anchor.

- [ ] **Step 1: Write the updated failing test**

In `packages/agent/src/providers/__tests__/cache-control.test.ts`, replace the existing test `enforceBreakpointBudget strips oldest message-level markers first when over cap` (around line 290) with:

```typescript
  it('enforceBreakpointBudget strips NEWEST message-level markers first when over cap (PRI-1802 anchor preservation)', () => {
    // 5 markers in messages — over the cap of 4. Strip the NEWEST first
    // so the stable anchor (oldest) survives. This is the breakpoint that
    // PRI-1802 added specifically to defeat Anthropic's 20-block lookback
    // window; evicting it first would defeat the whole point.
    const messages = [
      user({ ...text('first'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('second'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('third'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('fourth'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
      user({ ...text('fifth'), cache_control: MARKER_1H } as Anthropic.TextBlockParam),
    ];
    const result = enforceBreakpointBudget({ messages });

    const remainingMarkers = result.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b) => (b as { cache_control?: unknown }).cache_control)
        : []
    );
    expect(remainingMarkers).toHaveLength(MAX_CACHE_BREAKPOINTS);

    // Last (newest) message lost its marker
    expect(
      Array.isArray(result[4].content) &&
        (result[4].content[0] as { cache_control?: unknown }).cache_control
    ).toBeFalsy();
    // First (oldest = anchor position) kept it
    expect(
      Array.isArray(result[0].content) &&
        (result[0].content[0] as { cache_control?: unknown }).cache_control
    ).toEqual(MARKER_1H);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts -t "strips NEWEST"`
Expected: FAIL — current implementation strips oldest, so the first message still has its marker and the last one does not.

- [ ] **Step 3: Fix the implementation**

In `packages/agent/src/providers/cache-control.ts`, replace the body of `enforceBreakpointBudget` (the loop body, ~lines 273-294):

```typescript
export function enforceBreakpointBudget(payload: {
  system?: Anthropic.TextBlockParam[] | string;
  tools?: Array<{ cache_control?: Anthropic.CacheControlEphemeral | null }>;
  messages: Anthropic.MessageParam[];
}): Anthropic.MessageParam[] {
  const total = countCacheBreakpoints(payload);
  if (total <= MAX_CACHE_BREAKPOINTS) return payload.messages;

  // PRI-1806 #1 (revised after adversarial review): strip NEWEST message
  // markers first so the stable anchor (oldest) survives. The anchor is
  // expensive to position (PRI-1805 raw-block math) and exists specifically
  // to defeat Anthropic's 20-block lookback. The rolling tail is
  // regenerated on every turn and cheap to lose.
  let toDrop = total - MAX_CACHE_BREAKPOINTS;

  // Walk messages newest-to-oldest, dropping markers as we go.
  const reversed = [...payload.messages].reverse();
  const stripped = reversed.map((msg) => {
    if (toDrop === 0) return msg;
    if (!Array.isArray(msg.content)) return msg;
    let touched = false;
    // Within a message, also walk blocks newest-to-oldest (right-to-left).
    const blocks = [...msg.content].reverse().map((block) => {
      if (toDrop === 0) return block;
      if ((block as { cache_control?: unknown }).cache_control) {
        toDrop--;
        touched = true;
        const { cache_control: _drop, ...rest } = block as unknown as Record<string, unknown>;
        return rest as unknown as Anthropic.ContentBlockParam;
      }
      return block;
    });
    return touched ? { ...msg, content: blocks.reverse() } : msg;
  });
  return stripped.reverse();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts`
Expected: PASS (all cache-control unit tests, including the updated one).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/providers/cache-control.ts \
        packages/agent/src/providers/__tests__/cache-control.test.ts
git commit -m "fix(cache-control): enforceBreakpointBudget evicts NEWEST first (PRI-1802 anchor preserved)

Adversarial review found that the old implementation stripped the
oldest marker first, which by construction is the stable anchor — the
very breakpoint that PRI-1802 added to defeat Anthropic's 20-block
lookback window. Reverse the eviction order so the anchor survives
budget pressure and only the rolling tail (regenerated each turn) is
sacrificed.
"
```

---

### Task 1C: Handle `enforceBreakpointBudget` over-cap when system/tools are over

**Files:**
- Modify: `packages/agent/src/providers/cache-control.ts` (`enforceBreakpointBudget`)
- Test: `packages/agent/src/providers/__tests__/cache-control.test.ts` (add a new test in the same describe block)

**Problem:** If the cap is exceeded because of markers in `system` or `tools` (not just `messages`), the function only strips from `messages` and may return without bringing the count down. The 400 from Anthropic is still possible. The function name implies it enforces the cap; it doesn't fully.

**Resolution:** If after stripping all message markers we're STILL over cap, log a warning and return the unmodified messages — callers are responsible for not generating >4 markers across system+tools+anchor+tail. With current code paths Lace never sends >2 system or >1 tool markers; the assertion is purely defensive. A loud warning surfaces the bug fast if a future caller introduces a 5th marker upstream.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/src/providers/__tests__/cache-control.test.ts` inside the `describe('budget enforcement (PRI-1806 #1)', ...)` block:

```typescript
  it('logs a warning when system/tools markers push the total over cap (PRI-1806 #1 follow-up)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // 4 markers in system + 1 in tools = 5 total, all message-level slots empty
    const result = enforceBreakpointBudget({
      system: [
        { type: 'text', text: 'a', cache_control: MARKER_1H },
        { type: 'text', text: 'b', cache_control: MARKER_1H },
        { type: 'text', text: 'c', cache_control: MARKER_1H },
        { type: 'text', text: 'd', cache_control: MARKER_1H },
      ] as Anthropic.TextBlockParam[],
      tools: [{ cache_control: MARKER_1H }],
      messages: [user(text('plain'))],
    });

    // Messages array unchanged (no message markers to strip).
    expect(result).toHaveLength(1);
    // Warning fired so we surface this in production logs.
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/cache_control budget/i);

    warnSpy.mockRestore();
  });
```

Add `import { vi } from 'vitest';` at the top of the file if it isn't already there (it already is, alongside `describe, it, expect`). The current file imports only `describe, it, expect`. Update the import line at the top:

```typescript
import { describe, it, expect, vi } from 'vitest';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts -t "logs a warning"`
Expected: FAIL — `warnSpy` was not called.

- [ ] **Step 3: Update implementation**

In `packages/agent/src/providers/cache-control.ts`, modify `enforceBreakpointBudget` to add the warning at the end:

```typescript
export function enforceBreakpointBudget(payload: {
  system?: Anthropic.TextBlockParam[] | string;
  tools?: Array<{ cache_control?: Anthropic.CacheControlEphemeral | null }>;
  messages: Anthropic.MessageParam[];
}): Anthropic.MessageParam[] {
  const total = countCacheBreakpoints(payload);
  if (total <= MAX_CACHE_BREAKPOINTS) return payload.messages;

  let toDrop = total - MAX_CACHE_BREAKPOINTS;

  const reversed = [...payload.messages].reverse();
  const stripped = reversed.map((msg) => {
    if (toDrop === 0) return msg;
    if (!Array.isArray(msg.content)) return msg;
    let touched = false;
    const blocks = [...msg.content].reverse().map((block) => {
      if (toDrop === 0) return block;
      if ((block as { cache_control?: unknown }).cache_control) {
        toDrop--;
        touched = true;
        const { cache_control: _drop, ...rest } = block as unknown as Record<string, unknown>;
        return rest as unknown as Anthropic.ContentBlockParam;
      }
      return block;
    });
    return touched ? { ...msg, content: blocks.reverse() } : msg;
  });
  const result = stripped.reverse();

  // If we still couldn't get under the cap (system/tools markers are
  // pushing the total over 4 with no message slots left to evict), this is
  // a programmer error upstream. Warn loudly so we notice in production
  // logs; Anthropic will then 400 the request.
  if (toDrop > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[cache-control] cache_control budget exceeded: ${total} markers but only ${MAX_CACHE_BREAKPOINTS} allowed. ` +
        `Could not reduce — system/tools markers consumed too many slots. Request will likely 400.`
    );
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts`
Expected: PASS (all cache-control tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/providers/cache-control.ts \
        packages/agent/src/providers/__tests__/cache-control.test.ts
git commit -m "fix(cache-control): warn when budget enforcement cannot reduce to cap

When system/tools alone push the marker count over 4, enforceBreakpointBudget
has nothing to strip from messages and returns silently. Add a console.warn
so the regression surfaces in production logs before Anthropic 400s the
request.
"
```

---

### Task 1D: Fix OpenAI provider system-prompt divergence

**Files:**
- Modify: `packages/agent/src/providers/openai-provider.ts` (find the `_createResponsesAPIPayload` method around line 500-520)
- Test: `packages/agent/src/providers/openai-provider.test.ts` (find the existing tests, add one)

**Problem:** When PRI-1804 #3 changed `getEffectiveSystemPrompt` to concatenate ALL `role: 'system'` messages with `\n\n`, the OpenAI provider's Responses-API path was bypassed. That path has its own inline join — different separator (`\n`) AND it stringifies `content` arrays naively, producing `"[object Object]"` when content is an array of blocks. Two paths in the OpenAI provider now produce different system prompts for the same input.

**Resolution:** Replace the inline join with a call to `this.getEffectiveSystemPrompt(messages)`. Both paths go through the same well-tested code.

- [ ] **Step 1: Investigate the current code**

Run: `grep -n "system\|role === 'system'" packages/agent/src/providers/openai-provider.ts | head -20`

Read the file around line 500-520 to find the Responses-API system handling.

- [ ] **Step 2: Write the failing test**

Add to `packages/agent/src/providers/openai-provider.test.ts` (find a good insertion point near other system-prompt tests):

```typescript
  it('Responses-API path goes through getEffectiveSystemPrompt for system messages (regression: PRI-1804 #3)', async () => {
    // After PRI-1804 #3, getEffectiveSystemPrompt joins multiple role:system
    // messages with \n\n. The Responses-API path used to do its own \n-join
    // and stringified content arrays naively — that divergence is the bug.
    // Verify the Responses-API path now matches.
    mockCreateResponses.mockResolvedValue({
      // Minimal response shape...
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await provider.createResponse(
      [
        { role: 'system', content: 'First system block.' },
        { role: 'system', content: 'Second system block.' },
        { role: 'user', content: 'Hello' },
      ],
      [],
      'gpt-4o'
    );

    const callArgs = mockCreateResponses.mock.calls[0][0];
    // System should be the \n\n join, matching what getEffectiveSystemPrompt produces.
    expect(callArgs.instructions ?? callArgs.system).toContain('First system block.\n\nSecond system block.');
  });
```

(Adapt the assertion to the actual Responses-API field name — check what the existing tests use; it might be `instructions` or `input` with a system role item.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run src/providers/openai-provider.test.ts -t "Responses-API path goes through"`
Expected: FAIL — the current code uses `\n` separator and broken content stringification.

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/providers/openai-provider.ts`, find the Responses-API payload builder (around line 508-509 based on the adversarial review). It currently has logic like:

```typescript
const systemText = messages
  .filter((m) => m.role === 'system')
  .map((m) => m.content)
  .join('\n');
```

Replace with:

```typescript
const systemText = this.getEffectiveSystemPrompt(messages);
```

If the surrounding code expects the result to be only non-empty, wrap appropriately:

```typescript
const systemText = this.getEffectiveSystemPrompt(messages);
// systemText is guaranteed non-empty (getEffectiveSystemPrompt warns + returns fallback if no source).
```

- [ ] **Step 5: Run test to verify it passes AND verify no regressions**

Run: `npx vitest --run src/providers/openai-provider.test.ts`
Expected: PASS (all OpenAI tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/providers/openai-provider.ts \
        packages/agent/src/providers/openai-provider.test.ts
git commit -m "fix(openai-provider): route Responses-API system prompt through base helper

PRI-1804 #3 changed base-provider getEffectiveSystemPrompt to concatenate
all role:system messages with \\n\\n. The OpenAI Responses-API path had
its own inline join with a different separator (\\n) AND broken content
stringification — producing '[object Object]' for content-block arrays.
Route the Responses path through the base helper so both OpenAI code
paths produce identical system prompts.
"
```

---

# Phase 2: System Prompt Invariant

This is the architectural change. After this phase, the system prompt is computed exactly once per session at creation, persisted as a dedicated event, and never recomputed or mutated.

---

### Task 2A: Add `system_prompt_set` event type

**Files:**
- Modify: `packages/agent/src/storage/event-types.ts`
- Test: `packages/agent/src/storage/event-types.test.ts` (may not exist — if not, the type-check is the test)

- [ ] **Step 1: Add the type to the discriminated union**

In `packages/agent/src/storage/event-types.ts`, add after `ContextInjectedEventData` (around line 57):

```typescript
export type SystemPromptSetEventData = {
  type: 'system_prompt_set';
  text: string;
};
```

Then add `SystemPromptSetEventData` to the `DurableEventData` union (around line 130):

```typescript
export type DurableEventData =
  | PromptEventData
  | MessageEventData
  | ToolUseEventData
  | TurnStartEventData
  | TurnEndEventData
  | ContextCompactedEventData
  | ContextInjectedEventData
  | SystemPromptSetEventData
  | JobStartedEventData
  // ...rest unchanged
```

- [ ] **Step 2: Run typecheck to ensure the type compiles**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/storage/event-types.ts
git commit -m "feat(storage): add system_prompt_set event type

The new event holds the rendered system-prompt text for a session.
Written exactly once at session creation; read by the message-builder
to recover the frozen prompt without walking context_injected events.
"
```

---

### Task 2B: Write `system_prompt_set` at session creation

**Files:**
- Modify: `packages/agent/src/rpc/handlers/session.ts:413-461`
- Test: `packages/agent/src/__tests__/system-prompt-injection.test.ts` (existing; assertions need updating)

**Resolution:** Replace the two `context_injected` writes with a single `system_prompt_set` write whose `text` is `systemPrompt + '\n\n' + userInstructions` (when userInstructions is non-empty).

- [ ] **Step 1: Read existing test to know what to update**

Run: `cat packages/agent/src/__tests__/system-prompt-injection.test.ts | head -120`

Identify the assertions that look for `type === 'context_injected'`. They'll need to look for `type === 'system_prompt_set'` instead.

- [ ] **Step 2: Update the test expectations**

In `packages/agent/src/__tests__/system-prompt-injection.test.ts`, find every assertion that reads the first event of the session as `context_injected`. Replace with `system_prompt_set` and update the data extraction:

```typescript
// OLD pattern:
//   expect(firstEvent.type).toBe('context_injected');
//   const systemPromptText = firstEvent.data.content[0].text;
//
// NEW pattern:
//   expect(firstEvent.type).toBe('system_prompt_set');
//   const systemPromptText = firstEvent.data.text;
```

Apply this to BOTH occurrences in the file (around lines 84 and 277).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run src/__tests__/system-prompt-injection.test.ts`
Expected: FAIL — first event is still `context_injected`, not `system_prompt_set`.

- [ ] **Step 4: Update session.ts**

In `packages/agent/src/rpc/handlers/session.ts`, replace lines 442-461:

```typescript
    let sessionState: SessionState = readSessionState(sessionDir);

    // Compose the full system prompt text (persona + user instructions).
    // Persisted as a single `system_prompt_set` event so the system prompt
    // is byte-stable for the lifetime of the session — see plan
    // 2026-05-23-cache-control-hardening.md for the invariant.
    const fullSystemPrompt = promptConfig.userInstructions.trim()
      ? `${promptConfig.systemPrompt}\n\n${promptConfig.userInstructions}`
      : promptConfig.systemPrompt;

    const { nextState } = appendDurableEvent(sessionDir, sessionState, {
      type: 'system_prompt_set',
      data: { text: fullSystemPrompt },
    });
    sessionState = nextState;
    writeSessionState(sessionDir, sessionState);

    state.activeSession = { ...state.activeSession, state: sessionState };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest --run src/__tests__/system-prompt-injection.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/rpc/handlers/session.ts \
        packages/agent/src/__tests__/system-prompt-injection.test.ts
git commit -m "feat(session): write system_prompt_set event at session creation

Replaces the two context_injected events (persona + userInstructions)
with a single system_prompt_set event whose data.text holds the
rendered system-prompt bytes. Establishes the source of truth for the
invariant system prompt.
"
```

---

### Task 2C: Update message-builder to return `{messages, systemPrompt}`

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts`
- Test: add a new file `packages/agent/src/message-building/message-builder.test.ts` (or whichever exists)

**Resolution:** Change the signature of `buildProviderMessagesFromDurableEvents` to return `{messages: ProviderMessage[]; systemPrompt: string}`. All `context_injected` events become `role: 'user'` messages — they are runtime context, not session-foundational. A `system_prompt_set` event populates the returned `systemPrompt` field. Multiple `system_prompt_set` events: last one wins (defensive — should not happen in normal flow).

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/message-building/message-builder.test.ts`:

```typescript
// ABOUTME: Tests for buildProviderMessagesFromDurableEvents — system prompt
// recovery and context_injected → user-message conversion.

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildProviderMessagesFromDurableEvents } from './message-builder';

function makeSessionDir(name: string): string {
  const dir = join(tmpdir(), `lace-test-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeEvents(sessionDir: string, events: object[]): void {
  const lines = events.map((e) => JSON.stringify(e)).join('\n');
  writeFileSync(join(sessionDir, 'events.jsonl'), lines + '\n');
}

describe('buildProviderMessagesFromDurableEvents', () => {
  it('returns the system prompt text from a system_prompt_set event', () => {
    const dir = makeSessionDir('sps');
    writeEvents(dir, [
      { eventSeq: 1, type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'You are Lace.' } },
      { eventSeq: 2, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.systemPrompt).toBe('You are Lace.');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);

    rmSync(dir, { recursive: true });
  });

  it('converts context_injected events to role:user messages (not role:system)', () => {
    const dir = makeSessionDir('ci-user');
    writeEvents(dir, [
      { eventSeq: 1, type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'sys' } },
      { eventSeq: 2, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
      {
        eventSeq: 3,
        type: 'context_injected',
        data: { type: 'context_injected', content: [{ type: 'text', text: 'runtime nudge' }] },
      },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'runtime nudge' },
    ]);

    rmSync(dir, { recursive: true });
  });

  it('returns empty systemPrompt when no system_prompt_set event is present (legacy session)', () => {
    const dir = makeSessionDir('legacy');
    writeEvents(dir, [
      { eventSeq: 1, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.systemPrompt).toBe('');
    expect(result.messages).toEqual([{ role: 'user', content: 'hi' }]);

    rmSync(dir, { recursive: true });
  });

  it('uses the LAST system_prompt_set event when multiple exist (defensive)', () => {
    const dir = makeSessionDir('multi-sps');
    writeEvents(dir, [
      { eventSeq: 1, type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'first' } },
      { eventSeq: 2, type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'second' } },
      { eventSeq: 3, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.systemPrompt).toBe('second');

    rmSync(dir, { recursive: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/message-building/message-builder.test.ts`
Expected: FAIL — `result.systemPrompt` is undefined (the function currently returns just an array).

- [ ] **Step 3: Update the function signature and body**

In `packages/agent/src/message-building/message-builder.ts`, replace the function body:

```typescript
/**
 * Builds provider messages from durable events stored in a session directory.
 * Reconstructs the conversation history by reading and parsing events.jsonl.
 *
 * Returns:
 *   - `messages`: chronological list of role:user / role:assistant messages
 *   - `systemPrompt`: the bytes from the most recent `system_prompt_set` event,
 *     or '' if no such event exists (legacy session).
 *
 * `context_injected` events are converted to `role: 'user'` messages — they
 * are runtime context, not part of the session-foundational system prompt.
 * The system prompt is sourced exclusively from `system_prompt_set` so it is
 * byte-stable for the lifetime of the session.
 */
export function buildProviderMessagesFromDurableEvents(
  sessionDir: string
): { messages: ProviderMessage[]; systemPrompt: string } {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return { messages: [], systemPrompt: '' };
  }

  const messages: ProviderMessage[] = [];
  let systemPrompt = '';
  const lines = raw.split('\n');

  for (const line of lines) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};

      if (type === 'system_prompt_set') {
        const text = (data as { text?: unknown }).text;
        if (typeof text === 'string') systemPrompt = text;
        continue;
      }

      if (type === 'prompt') {
        const content = extractContentBlocks((data as Record<string, unknown>).content);
        const hasContent = typeof content === 'string' ? content.trim() : content.length > 0;
        if (hasContent) messages.push({ role: 'user', content });
        continue;
      }

      if (type === 'context_injected') {
        const eventData = data as ContextInjectedData;
        const contentArr = Array.isArray(eventData.content) ? eventData.content : [];
        const content = extractTextFromContentBlocks(contentArr);
        // PRI-1804 follow-up / 2026-05-23 plan: context_injected events
        // are RUNTIME context, not session-foundational. Emit as role:user
        // so they don't bust the system+tools cache prefix.
        if (content.trim()) messages.push({ role: 'user', content });
        continue;
      }

      // ... rest of the function (context_compacted, prompt, etc.) unchanged
      // KEEP the existing logic for all other event types verbatim.
```

Continue with the existing body for `context_compacted` and all other event types unchanged. The function's return statement at the end now returns the object: `return { messages, systemPrompt };`.

- [ ] **Step 4: Update all call sites**

Run: `grep -rn "buildProviderMessagesFromDurableEvents" packages/agent/src 2>/dev/null`

For each call site, change from:

```typescript
const messages = buildProviderMessagesFromDurableEvents(sessionDir);
```

to:

```typescript
const { messages, systemPrompt } = buildProviderMessagesFromDurableEvents(sessionDir);
```

Known call sites to update (verify with grep, this list may not be exhaustive):
- `packages/agent/src/core/conversation/runner.ts:204`
- Any other places where the function is invoked

For test files, update only the test files that destructure the result (most just check `.length`).

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest --run src/message-building/`
Expected: PASS.

Run: `npx vitest --run src/core/conversation/`
Expected: PASS (some tests may need destructuring updates).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/message-building/message-builder.ts \
        packages/agent/src/message-building/message-builder.test.ts \
        packages/agent/src/core/conversation/runner.ts
# Plus any other call sites updated in step 4
git commit -m "feat(message-builder): return frozen systemPrompt + emit context_injected as user

The message-builder now returns { messages, systemPrompt }. systemPrompt
is sourced exclusively from system_prompt_set events written at session
creation. context_injected events become role:user messages (they are
runtime context, not part of the session-foundational prompt). This
enforces the invariant that the system prompt is byte-stable for the
lifetime of a session.
"
```

---

### Task 2D: Runner reads frozen systemPrompt and calls setSystemPrompt

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` (around line 204 where `buildProviderMessagesFromDurableEvents` is called, and around line 179 where `createProvider` is called)
- Test: covered by the runner's existing tests; add one assertion to a regression test if needed

- [ ] **Step 1: Read current runner code**

Look at lines 175-220 to understand the flow.

- [ ] **Step 2: Update the runner**

Replace the line `let providerMessages = buildProviderMessagesFromDurableEvents(sessionDir);` with:

```typescript
    const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
      buildProviderMessagesFromDurableEvents(sessionDir);
    let providerMessages = rebuiltMessages;

    // PRI-1804 invariant: the system prompt is computed once at session
    // creation and never changes for the session lifetime. Push it into
    // the provider here; it stays in `_systemPrompt` for every turn.
    if (frozenSystemPrompt) {
      provider.setSystemPrompt(frozenSystemPrompt);
    }
```

(Put the `setSystemPrompt` call AFTER `provider = await this.deps.createProvider();` — i.e., after line 179.)

- [ ] **Step 3: Run runner tests**

Run: `npx vitest --run src/core/conversation/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts
git commit -m "feat(runner): push frozen systemPrompt to provider once per run

Runner now reads the frozen systemPrompt from buildProviderMessagesFromDurableEvents
and calls provider.setSystemPrompt() before any turn. The provider's
_systemPrompt is set once and never changes for the session lifetime.
"
```

---

### Task 2E: `getEffectiveSystemPrompt` returns only `_systemPrompt`

**Files:**
- Modify: `packages/agent/src/providers/base-provider.ts:571-599`
- Test: existing tests in `src/providers/__tests__/anthropic-provider.test.ts` — particularly the multi-system-message test added in PRI-1804

- [ ] **Step 1: Update the multi-system-message test expectation**

In `packages/agent/src/providers/__tests__/anthropic-provider.test.ts`, find the test added in PRI-1804 (search for `concatenates multiple role:system`). After this plan's changes, role:system messages are no longer the source of truth — `_systemPrompt` is. Update the test:

```typescript
    it('uses _systemPrompt (set via setSystemPrompt) and ignores any role:system messages in input (PRI-1804 invariant)', async () => {
      mockCreateResponse.mockResolvedValue({
        content: [{ type: 'text', text: 'r' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      provider.setSystemPrompt('Frozen prompt set at session start.');

      // role:system messages in the input must NOT influence the request's system block.
      await provider.createResponse(
        [
          { role: 'system', content: 'This must be ignored.' },
          { role: 'system', content: 'This too.' },
          { role: 'user', content: 'Hello' },
        ],
        [],
        'claude-sonnet-4-20250514'
      );

      const callArgs = mockCreateResponse.mock.calls[0][0] as Anthropic.Messages.MessageCreateParams;
      const sysBlocks = callArgs.system as Array<{ text: string }>;
      expect(sysBlocks[0].text).toBe('Frozen prompt set at session start.');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/providers/__tests__/anthropic-provider.test.ts -t "uses _systemPrompt"`
Expected: FAIL — current `getEffectiveSystemPrompt` concatenates the two `role:system` messages and ignores `_systemPrompt`.

- [ ] **Step 3: Rewrite `getEffectiveSystemPrompt`**

In `packages/agent/src/providers/base-provider.ts`, replace the entire `getEffectiveSystemPrompt` method (around lines 571-599):

```typescript
  // System prompt handling.
  //
  // The system prompt is the bytes set via setSystemPrompt() at session
  // start. It is byte-invariant for the lifetime of the session — this is
  // what makes the system+tools cache prefix actually reusable across
  // requests. role:'system' messages in the input are IGNORED here (they
  // are session-foundational context handled at the storage layer; see
  // buildProviderMessagesFromDurableEvents which sources systemPrompt from
  // the system_prompt_set event).
  //
  // If neither setSystemPrompt() has been called nor _systemPrompt is set,
  // we log loudly and return a stable fallback string. The fallback is
  // byte-stable so the cache still works in tests/edge cases.
  protected getEffectiveSystemPrompt(_messages: ProviderMessage[]): string {
    if (this._systemPrompt) return this._systemPrompt;

    logger.warn(
      '[base-provider] getEffectiveSystemPrompt called with no _systemPrompt — caller must setSystemPrompt() at session start. ' +
        'Returning stable fallback so the cache stays warm, but production telemetry should surface this as a real bug.'
    );
    return 'You are a helpful assistant.';
  }
```

- [ ] **Step 4: Run tests to check what broke**

Run: `npx vitest --run src/providers/`
Expected: most tests still pass, but tests that relied on `role:system` messages in `messages` may now fail because they don't call `setSystemPrompt` and end up using the fallback. Update those tests to call `setSystemPrompt` explicitly.

Likely affected tests:
- `anthropic-provider.test.ts` — `should filter out system messages correctly` and the multi-system test from PRI-1804
- Any other provider test that constructs `{ role: 'system', ... }` messages

For each affected test, add `provider.setSystemPrompt('Test system prompt');` (or whatever value the test expects) in the `beforeEach` or in the test body before `provider.createResponse(...)`.

- [ ] **Step 5: Run full provider suite to confirm green**

Run: `npx vitest --run src/providers/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/providers/base-provider.ts \
        packages/agent/src/providers/__tests__/anthropic-provider.test.ts
# Plus any other test files updated in step 4
git commit -m "feat(base-provider): getEffectiveSystemPrompt returns only _systemPrompt

Per the invariant established by this plan: the system prompt is set
once at session start via setSystemPrompt() and never changes. Ignore
role:system messages in the input — they have been handled at the
storage layer (system_prompt_set event). Fallback retained for tests
and edge cases but warns loudly.
"
```

---

### Task 2F: Legacy session migration

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts`
- Test: `packages/agent/src/message-building/message-builder.test.ts` (add a new test)

**Resolution:** A legacy session has no `system_prompt_set` event but has one or two `context_injected` events at the beginning (before the first `prompt` event). Detect this pattern and use the concatenation of those pre-prompt context_injected events as the legacy system prompt. After the first `prompt` event, all `context_injected` events become `role:'user'` messages as normal.

- [ ] **Step 1: Add the failing test**

In `packages/agent/src/message-building/message-builder.test.ts`, add to the describe block:

```typescript
  it('legacy session — uses pre-prompt context_injected events as systemPrompt when no system_prompt_set exists', () => {
    const dir = makeSessionDir('legacy-with-ci');
    writeEvents(dir, [
      // Two pre-prompt context_injected events: legacy persona + userInstructions
      { eventSeq: 1, type: 'context_injected', data: { type: 'context_injected', content: [{ type: 'text', text: 'Legacy persona.' }] } },
      { eventSeq: 2, type: 'context_injected', data: { type: 'context_injected', content: [{ type: 'text', text: 'Legacy user instructions.' }] } },
      // First prompt event ends the "system prompt" run
      { eventSeq: 3, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
      // Post-prompt context_injected → role:user
      { eventSeq: 4, type: 'context_injected', data: { type: 'context_injected', content: [{ type: 'text', text: 'runtime nudge' }] } },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.systemPrompt).toBe('Legacy persona.\n\nLegacy user instructions.');
    expect(result.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'runtime nudge' },
    ]);

    rmSync(dir, { recursive: true });
  });

  it('legacy migration is bypassed when a system_prompt_set event is present (new session takes precedence)', () => {
    const dir = makeSessionDir('new-session');
    writeEvents(dir, [
      { eventSeq: 1, type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'New session sys prompt.' } },
      { eventSeq: 2, type: 'context_injected', data: { type: 'context_injected', content: [{ type: 'text', text: 'Should NOT become system.' }] } },
      { eventSeq: 3, type: 'prompt', data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] } },
    ]);

    const result = buildProviderMessagesFromDurableEvents(dir);
    expect(result.systemPrompt).toBe('New session sys prompt.');
    expect(result.messages).toEqual([
      { role: 'user', content: 'Should NOT become system.' },
      { role: 'user', content: 'hi' },
    ]);

    rmSync(dir, { recursive: true });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/message-building/message-builder.test.ts -t "legacy session"`
Expected: FAIL — first test fails because legacy sessions return `systemPrompt: ''`.

- [ ] **Step 3: Implement the legacy migration**

In `packages/agent/src/message-building/message-builder.ts`, refactor the function to do two passes:

```typescript
export function buildProviderMessagesFromDurableEvents(
  sessionDir: string
): { messages: ProviderMessage[]; systemPrompt: string } {
  const eventsPath = join(sessionDir, 'events.jsonl');
  let raw = '';
  try {
    raw = readFileSync(eventsPath, 'utf8');
  } catch {
    return { messages: [], systemPrompt: '' };
  }

  const lines = raw.split('\n').filter((l) => l.length > 0);
  const parsedEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
      const type = typeof parsed.type === 'string' ? parsed.type : '';
      const data = typeof parsed.data === 'object' && parsed.data ? parsed.data : {};
      parsedEvents.push({ type, data });
    } catch {
      // skip malformed line
    }
  }

  // PRI-1804 invariant: source the system prompt from system_prompt_set
  // events. The LAST such event wins (defensive — should normally be just
  // one at session start).
  let systemPrompt = '';
  let hasSystemPromptSet = false;
  for (const e of parsedEvents) {
    if (e.type === 'system_prompt_set') {
      const text = (e.data as { text?: unknown }).text;
      if (typeof text === 'string') {
        systemPrompt = text;
        hasSystemPromptSet = true;
      }
    }
  }

  // Legacy session migration: if no system_prompt_set, fall back to the
  // run of context_injected events BEFORE the first prompt event. These
  // represent the persona + userInstructions written at session creation
  // by the pre-2026-05-23 code path.
  if (!hasSystemPromptSet) {
    const legacyTexts: string[] = [];
    for (const e of parsedEvents) {
      if (e.type === 'prompt') break;
      if (e.type === 'context_injected') {
        const contentArr = Array.isArray((e.data as { content?: unknown }).content)
          ? ((e.data as { content: unknown[] }).content as ContentBlock[])
          : [];
        const text = extractTextFromContentBlocks(contentArr);
        if (text.trim()) legacyTexts.push(text);
      }
    }
    systemPrompt = legacyTexts.join('\n\n');
  }

  // Second pass: build the messages array. Pre-prompt context_injected
  // events are SKIPPED in legacy sessions (they're now the systemPrompt)
  // but emitted as role:user in new sessions where system_prompt_set
  // handled the system block.
  const messages: ProviderMessage[] = [];
  let sawFirstPrompt = false;
  for (const e of parsedEvents) {
    if (e.type === 'system_prompt_set') continue;

    if (e.type === 'prompt') {
      const content = extractContentBlocks((e.data as Record<string, unknown>).content);
      const hasContent = typeof content === 'string' ? content.trim() : content.length > 0;
      if (hasContent) messages.push({ role: 'user', content });
      sawFirstPrompt = true;
      continue;
    }

    if (e.type === 'context_injected') {
      // Legacy sessions: pre-prompt context_injected events were the system
      // prompt — already consumed above, skip here.
      if (!hasSystemPromptSet && !sawFirstPrompt) continue;

      const eventData = e.data as ContextInjectedData;
      const contentArr = Array.isArray(eventData.content) ? eventData.content : [];
      const content = extractTextFromContentBlocks(contentArr);
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }

    // ... handle the other event types (context_compacted, message, tool_use, etc.)
    // KEEP the existing handling for these; just adapt to the loop variable name.
    // Refactor the original switch/if-chain to operate on `e` instead of re-parsing JSON.
  }

  return { messages, systemPrompt };
}
```

(Adapt the body to include all the existing event handlers. The existing function has logic for `context_compacted`, `message`, `tool_use`, etc. — preserve all of that, just change the iteration variable from `line` parse to `e: ParsedEvent`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest --run src/message-building/`
Expected: PASS (all message-builder tests including the two new legacy tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/message-building/message-builder.ts \
        packages/agent/src/message-building/message-builder.test.ts
git commit -m "feat(message-builder): legacy session migration for system_prompt_set

Sessions created before this plan landed have only context_injected
events for the persona/userInstructions. When rebuilding such sessions,
treat the run of context_injected events BEFORE the first prompt as
the legacy system prompt. New sessions (with system_prompt_set) bypass
this migration entirely.
"
```

---

# Phase 3: Cache Prefix Robustness

These tasks close the remaining determinism holes — locale-dependent sorting, the placeholder-on-empty-assistant problem, Bedrock substring matching, the whitelist gap.

---

### Task 3A: Expand cacheable-block whitelist

**Files:**
- Modify: `packages/agent/src/providers/cache-control.ts` (`CACHEABLE_BLOCK_TYPES`)
- Test: `packages/agent/src/providers/__tests__/cache-control.test.ts`

**Resolution:** Add `server_tool_use`, `web_search_tool_result`, `search_result` to the whitelist. SDK 0.60's type defs at `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts` confirm these accept `cache_control`.

- [ ] **Step 1: Verify SDK types**

Run: `grep -B2 "cache_control" node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts | grep "interface" | head -20`

Confirm the three types `ServerToolUseBlockParam`, `WebSearchToolResultBlockParam`, `SearchResultBlockParam` are listed.

- [ ] **Step 2: Write the failing test**

Add to `packages/agent/src/providers/__tests__/cache-control.test.ts` (in the whitelist describe block):

```typescript
  it('treats SDK-cacheable block types beyond the original 5 as cacheable (PRI-1806 #5 follow-up)', () => {
    // SDK 0.60 confirms cache_control is accepted on:
    //   - server_tool_use
    //   - web_search_tool_result
    //   - search_result
    // The previous whitelist excluded these, leaving cache reach on the floor.
    const messages: Anthropic.MessageParam[] = [
      user(text('hi')),
      assistant(text('thinking')),
      user(text('go')),
      assistant({ type: 'server_tool_use', id: 'st1', name: 'web_search', input: {} } as unknown as Anthropic.ContentBlockParam),
      user({ type: 'web_search_tool_result', tool_use_id: 'st1', content: [] } as unknown as Anthropic.ContentBlockParam),
      user(text('final question')),
    ];

    const out = attachMessageCacheBreakpoints(messages, OPTIONS_1H);
    const flat = flattenBlocks(out);
    const markers = flat.filter((b) => b.cache_control !== undefined);

    // Should have a tail marker on the final 'text' block at minimum.
    expect(markers.length).toBeGreaterThan(0);

    // The server_tool_use and web_search_tool_result blocks should be
    // ELIGIBLE as anchor targets — not skipped as if they were thinking blocks.
    // Verify by ensuring neither is the LAST block in the cacheable position list
    // accidentally, and by verifying the helper doesn't bail.
    expect(out).not.toBe(messages); // helper modified the input
  });
```

- [ ] **Step 3: Run test to verify it fails or passes accidentally**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts -t "PRI-1806 #5 follow-up"`
Expected: this might already pass since the helper just produces a tail marker on the final text block. The test verifies the helper doesn't BAIL on the new block types — which it might or might not. Add a stronger assertion:

Replace the last `expect(out).not.toBe(messages)` with:

```typescript
    // Stronger: confirm the new block types are considered cacheable by the
    // helper's internal logic — assert the anchor (if placed) didn't skip
    // over them due to whitelist exclusion. Build a conversation where
    // these blocks are the ONLY candidates at the anchor distance:
    const longMessages: Anthropic.MessageParam[] = [
      user(text('start')),
      assistant(text('1'), text('2'), text('3'), text('4'), text('5')),
      assistant({ type: 'server_tool_use', id: 'st1', name: 'web_search', input: {} } as unknown as Anthropic.ContentBlockParam),
      user({ type: 'web_search_tool_result', tool_use_id: 'st1', content: [] } as unknown as Anthropic.ContentBlockParam),
      assistant(text('a'), text('b'), text('c')),
      user(text('final')),
    ];
    const longOut = attachMessageCacheBreakpoints(longMessages, OPTIONS_1H);
    const longFlat = flattenBlocks(longOut);
    const longMarkers = longFlat.filter((b) => b.cache_control !== undefined);
    // 2 markers (anchor + tail) once we're at >= 10 cacheable blocks.
    expect(longMarkers).toHaveLength(2);
```

- [ ] **Step 4: Update the whitelist**

In `packages/agent/src/providers/cache-control.ts`, expand `CACHEABLE_BLOCK_TYPES`:

```typescript
const CACHEABLE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'text',
  'image',
  'document',
  'tool_use',
  'tool_result',
  // PRI-1806 #5 follow-up: SDK 0.60 confirms these accept cache_control too.
  'server_tool_use',
  'web_search_tool_result',
  'search_result',
]);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/providers/cache-control.ts \
        packages/agent/src/providers/__tests__/cache-control.test.ts
git commit -m "feat(cache-control): expand cacheable-block whitelist (PRI-1806 #5 follow-up)

SDK 0.60 types confirm server_tool_use, web_search_tool_result, and
search_result accept cache_control. The original whitelist excluded
them defensively, leaving cache reach on the floor for hosted-tool
workloads. Add them.
"
```

---

### Task 3B: Replace `localeCompare` with byte-stable comparison

**Files:**
- Modify: `packages/agent/src/tools/executor.ts:107-115`
- Test: `packages/agent/src/tools/executor.test.ts` (or add new test if no executor test exists)

**Problem:** `localeCompare()` without a locale arg uses the host's default locale. On machines with non-default locales (Turkish, German with ß, etc.), sort order can differ for the same input.

**Resolution:** Use binary comparison: `a.name < b.name ? -1 : a.name > b.name ? 1 : 0`.

- [ ] **Step 1: Find existing executor tests**

Run: `find packages/agent/src/tools -name "executor*.test.ts" -type f`

If a test file exists, add to it. Otherwise create a new minimal one.

- [ ] **Step 2: Write the failing test**

Either to existing executor.test.ts or to a new file `packages/agent/src/tools/executor-tool-ordering.test.ts`:

```typescript
// ABOUTME: Tests for getAllTools() deterministic byte-stable ordering
// (PRI-1804 #2 follow-up after adversarial review).

import { describe, it, expect } from 'vitest';
import { ToolExecutor } from './executor';
import { Tool } from './tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from './types';

class MockTool extends Tool {
  constructor(public name: string) {
    super();
    this.description = `Tool ${name}`;
    this.schema = z.object({});
  }
  description: string;
  schema: z.ZodObject<{}>;
  protected async executeValidated(
    _args: object,
    _context: ToolContext
  ): Promise<ToolResult> {
    return Promise.resolve(this.createResult('ok'));
  }
}

describe('ToolExecutor.getAllTools — byte-stable ordering (PRI-1804 #2)', () => {
  it('sorts tools using byte-stable comparison, not localeCompare', () => {
    const executor = new ToolExecutor();
    // Names chosen to expose locale-dependent collation differences.
    // In Turkish locale, 'I' sorts after 'i' (not before). In default
    // ICU, 'I' sorts before 'i'. Byte comparison: 'I' < 'i'.
    executor.registerTool(new MockTool('Ipsum'));
    executor.registerTool(new MockTool('alpha'));
    executor.registerTool(new MockTool('Beta'));
    executor.registerTool(new MockTool('charlie'));

    const sorted = executor.getAllTools().map((t) => t.name);
    // Byte order: uppercase before lowercase, so 'Beta' < 'Ipsum' < 'alpha' < 'charlie'.
    expect(sorted).toEqual(['Beta', 'Ipsum', 'alpha', 'charlie']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run src/tools/`
Expected: FAIL — current `localeCompare` produces a different order (case-insensitive in default ICU).

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/tools/executor.ts`, replace lines 107-115 (the `getAllTools` body):

```typescript
  getAllTools(): Tool[] {
    // PRI-1804 #2 (revised after adversarial review): use BYTE-STABLE
    // comparison, not localeCompare. localeCompare without an explicit
    // locale arg uses the host's default locale; on machines with Turkish
    // or other non-English locales, sort order shifts and the tools-array
    // cache prefix becomes machine-dependent.
    const byName = (a: Tool, b: Tool): number =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    const nativeTools = this.getNativeTools().sort(byName);
    const mcpTools = this.getMCPTools().sort(byName);
    return [...nativeTools, ...mcpTools];
  }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest --run src/tools/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/tools/executor.ts \
        packages/agent/src/tools/executor-tool-ordering.test.ts
git commit -m "fix(executor): byte-stable tool ordering (PRI-1804 #2 follow-up)

localeCompare without an explicit locale arg uses the host's default
locale. Machines with Turkish or other non-English locales produced
a different sort order, busting the cross-machine tools-array cache.
Use binary comparison instead.
"
```

---

### Task 3C: Anchor Bedrock substring matching with delimiter

**Files:**
- Modify: `packages/agent/src/providers/cache-control.ts:48-62`
- Test: `packages/agent/src/providers/__tests__/cache-control.test.ts`

**Problem:** `modelId.includes('claude-opus-4-5')` also matches `claude-opus-4-50-future-v1:0` (hypothetical). And misses future versions like `claude-opus-4-6`, `claude-opus-5-0`.

**Resolution:** Anchor with a trailing delimiter. Use word-boundary regex.

- [ ] **Step 1: Add failing tests**

In `packages/agent/src/providers/__tests__/cache-control.test.ts` (in the `bedrockCacheTtlFor` describe block):

```typescript
  it('rejects hypothetical bad substring matches (PRI-1806 #5 follow-up)', () => {
    // 'claude-opus-4-50' should NOT match the 'claude-opus-4-5' substring.
    expect(bedrockCacheTtlFor('anthropic.claude-opus-4-50-future-v1:0')).toBe('5m');
    // Reverse — 'claude-opus-4-5-something' SHOULD match.
    expect(bedrockCacheTtlFor('anthropic.claude-opus-4-5-newvariant-v2:0')).toBe('1h');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts -t "rejects hypothetical"`
Expected: FAIL — substring match wrongly returns `'1h'` for `claude-opus-4-50`.

- [ ] **Step 3: Update the matcher**

In `packages/agent/src/providers/cache-control.ts`, replace `bedrockCacheTtlFor`:

```typescript
// Match Bedrock model IDs that support 1h TTL. Use word-boundary anchoring
// (delimiter at end of substring) so e.g. `claude-opus-4-50-…` does NOT
// match `claude-opus-4-5`. The allowed delimiters are `-` (the version
// separator continues) or end-of-string.
const BEDROCK_1H_TTL_MODEL_REGEX = /(?:claude-opus-4-5|claude-sonnet-4-5|claude-haiku-4-5)(?:-|$)/;

/**
 * Pick the longest cache TTL the given Bedrock model accepts. Bedrock 1h
 * TTL is GA only on a specific allowlist (Opus/Sonnet/Haiku 4.5); other
 * models silently fall back to the default 5m if 1h is sent — and at 2×
 * write cost that fallback is a real waste. Gate per-model.
 */
export function bedrockCacheTtlFor(modelId: string): CacheTtl {
  return BEDROCK_1H_TTL_MODEL_REGEX.test(modelId) ? '1h' : '5m';
}
```

Remove the now-unused `BEDROCK_1H_TTL_MODEL_SUBSTRINGS` constant.

- [ ] **Step 4: Run tests**

Run: `npx vitest --run src/providers/__tests__/cache-control.test.ts -t "bedrockCacheTtlFor"`
Expected: PASS — both the original allowlist tests and the new substring-edge-case test pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/providers/cache-control.ts \
        packages/agent/src/providers/__tests__/cache-control.test.ts
git commit -m "fix(cache-control): anchor Bedrock model match with delimiter (PRI-1806 #5 follow-up)

Substring match without anchoring would treat hypothetical future model
IDs like claude-opus-4-50 as if they were claude-opus-4-5 family. Use
word-boundary regex (substring + '-' or end-of-string).
"
```

---

### Task 3D: Drop `(no response)` placeholder; reject empty assistant content

**Files:**
- Modify: `packages/agent/src/providers/format-converters.ts:121-130`
- Test: `packages/agent/src/providers/__tests__/format-converters.test.ts`

**Problem:** The `(no response)` placeholder is now permanently embedded in the cached prefix and the model will learn to mimic it. Also: the with-toolCalls branch handles empty-text by OMITTING the text block; the no-toolCalls branch with empty-text shouldn't exist at all (an assistant message with no text and no tools is semantically empty — upstream should not emit it).

**Resolution:** Drop the placeholder. If the assistant message has no tool calls AND no text content, OMIT the entire message rather than emitting a placeholder. Upstream code paths that produce such messages should be flagged as bugs.

- [ ] **Step 1: Find existing format-converters tests**

Run: `find packages/agent/src/providers -name "format-converters*.test.ts"`

- [ ] **Step 2: Write the failing test**

In `packages/agent/src/providers/__tests__/format-converters.test.ts`, add (or in `enhanced-provider-conversion.test.ts` if that's where similar tests live):

```typescript
import { convertToAnthropicFormat } from '../format-converters';
import type { ProviderMessage } from '../base-provider';

describe('convertToAnthropicFormat — empty assistant content (PRI-1806 #6 follow-up)', () => {
  it('drops the (no response) placeholder; omits empty assistant turns entirely', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   ' }, // whitespace only, no tool calls
      { role: 'user', content: 'are you there?' },
    ];

    const out = convertToAnthropicFormat(messages);

    // The empty assistant turn is omitted entirely.
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: 'user', content: 'hi' });
    expect(out[1]).toEqual({ role: 'user', content: 'are you there?' });

    // Placeholder text must not appear anywhere.
    expect(JSON.stringify(out)).not.toContain('(no response)');
  });

  it('preserves assistant messages with non-empty text', () => {
    const messages: ProviderMessage[] = [
      { role: 'assistant', content: 'Hello there.' },
    ];
    const out = convertToAnthropicFormat(messages);
    expect(out).toEqual([{ role: 'assistant', content: 'Hello there.' }]);
  });

  it('preserves assistant messages with tool calls but no text', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'tool', arguments: {} }],
      },
    ];
    const out = convertToAnthropicFormat(messages);
    expect(out).toHaveLength(1);
    expect((out[0].content as Array<{ type: string }>)[0]?.type).toBe('tool_use');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest --run src/providers/__tests__/format-converters.test.ts -t "PRI-1806 #6"`
Expected: FAIL — current code emits `(no response)`.

- [ ] **Step 4: Update the converter**

In `packages/agent/src/providers/format-converters.ts`, replace the no-toolCalls branch (the `else` around line 120-130):

```typescript
        } else {
          // Pure text assistant message. Empty / whitespace-only content
          // means an upstream bug (the agent shouldn't emit an empty turn).
          // Returning a placeholder permanently pollutes the cached prefix
          // — the model will learn to mimic it. Better: return a sentinel
          // that the upper layer must filter out.
          const trimmed = textContent.trim();
          if (trimmed.length === 0) {
            return null; // signal to drop this message entirely
          }
          return {
            role: 'assistant',
            content: trimmed,
          };
        }
```

Then update the outer `.map()` call to filter out nulls. Find the call (around line 50): `return messages.filter(...).map(...)`. Change to:

```typescript
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((msg): Anthropic.MessageParam | null => {
      // ... existing body, returning null for empty assistant turns
    })
    .filter((m): m is Anthropic.MessageParam => m !== null);
```

You'll need to adjust the return-type annotation on the inner arrow function to allow `null`.

- [ ] **Step 5: Run tests**

Run: `npx vitest --run src/providers/`
Expected: PASS. The PRI-1806 smoke and earlier tests should also still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/providers/format-converters.ts \
        packages/agent/src/providers/__tests__/format-converters.test.ts
git commit -m "fix(format-converters): drop (no response) placeholder; omit empty assistant turns

Per adversarial review: the placeholder embeds in the cached prefix and
the model learns to mimic it. Better to omit the empty assistant turn
entirely and treat upstream code that emits one as a bug.
"
```

---

### Task 3E: Calibration uses explicit system prompt; no more warn spam

**Files:**
- Modify: `packages/agent/src/providers/anthropic-provider.ts:124-160` (`_calibrateTokenCostsImpl`)

**Problem:** `_calibrateTokenCostsImpl` calls `countTokensExplicit([], systemPrompt, [], model)` with empty messages. That eventually calls `getEffectiveSystemPrompt(messages=[])` which warns. Tests and production calibration both spam the warning.

**Resolution:** `countTokensExplicit` already takes `systemPrompt` as a parameter. It currently calls `_countTokensImpl` for the empty-messages case which re-resolves through `getEffectiveSystemPrompt`. Just thread the explicit `systemPrompt` directly into the SDK call — no re-resolution needed.

- [ ] **Step 1: Read the current code**

Look at `countTokensExplicit` in `anthropic-provider.ts`. It already takes `systemPrompt` and passes it to `beta.messages.countTokens({ system: systemWithCaching, ... })`. So this is already correct — the warn spam came from `_countTokensImpl` (`anthropic-provider.ts:107-118`) which calls `getEffectiveSystemPrompt`.

Actual fix location: `_countTokensImpl` calls `getEffectiveSystemPrompt(messages)`. If messages is empty AND no system prompt is set, it warns. The fix is in `getEffectiveSystemPrompt`: don't warn when called with empty messages — that's the legitimate calibration path.

- [ ] **Step 2: Update `getEffectiveSystemPrompt`**

In `packages/agent/src/providers/base-provider.ts`, modify the fallback path:

```typescript
  protected getEffectiveSystemPrompt(messages: ProviderMessage[]): string {
    if (this._systemPrompt) return this._systemPrompt;

    // Calibration paths intentionally call us with empty messages and
    // already-resolved-or-empty prompts. Only warn when we're actually
    // serving a request that's about to send to the model.
    if (messages.length > 0) {
      logger.warn(
        '[base-provider] getEffectiveSystemPrompt called with no _systemPrompt — caller must setSystemPrompt() at session start. ' +
          'Returning stable fallback so the cache stays warm, but production telemetry should surface this as a real bug.'
      );
    }
    return 'You are a helpful assistant.';
  }
```

- [ ] **Step 3: Verify no tests broke**

Run: `npx vitest --run src/providers/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/providers/base-provider.ts
git commit -m "fix(base-provider): suppress getEffectiveSystemPrompt warn on calibration path

Calibration calls getEffectiveSystemPrompt with empty messages — that
is the legitimate empty case, not a missed-setSystemPrompt bug. Only
warn when messages is non-empty (i.e., we're actually about to send a
real request).
"
```

---

# Phase 4: Test Coverage

These tests close the gaps the adversarial reviewers found in the smoke / property coverage.

---

### Task 4A: Streaming cache_control smoke test

**Files:**
- Create: `packages/agent/src/providers/__tests__/cache-control-streaming.test.ts`

**Problem:** The smoke probes test `createResponse` only. The runner uses `createStreamingResponse` exclusively. The cache_control shape on the stream path has never been verified at the HTTP layer.

- [ ] **Step 1: Write the smoke test**

Create `packages/agent/src/providers/__tests__/cache-control-streaming.test.ts`:

```typescript
// ABOUTME: Smoke test for the STREAMING path — captures the actual HTTP body
// that AnthropicProvider.createStreamingResponse sends and asserts the
// cache_control breakpoints land in the same positions as the non-streaming
// path. (Adversarial review found this path was untested at the wire layer.)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '../anthropic-provider';

interface RequestBody {
  system?: Array<{ cache_control?: unknown }>;
  tools?: Array<{ cache_control?: unknown }>;
  messages: Array<{ role: string; content: unknown }>;
}

describe('PRI-1804/1806 streaming smoke — cache_control on the stream path', () => {
  let server: Server;
  let baseURL: string;
  const captured: { body: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        captured.push({ body });
        // Return a minimal SSE stream for the SDK to consume.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_smoke',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-20250514',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'ok' },
        })}\n\n`);
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  });

  it('streaming request body has the same cache_control markers as non-streaming', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are an agentic assistant.');

    // Long enough conversation to trigger anchor
    const messages: Parameters<typeof provider.createStreamingResponse>[0] = [];
    for (let i = 0; i < 6; i++) {
      messages.push({ role: 'user', content: `q${i}` });
      messages.push({
        role: 'assistant',
        content: `ok ${i}`,
        toolCalls: [{ id: `t${i}`, name: 'tool', arguments: { x: `${i}` } }],
      });
      messages.push({
        role: 'user',
        content: '',
        toolResults: [{ id: `t${i}`, content: [{ type: 'text', text: `r${i}` }], status: 'completed' }],
      });
    }
    messages.push({ role: 'user', content: 'final' });

    // Drive the streaming API. Listen for the 'complete' event and resolve.
    await new Promise<void>((resolve) => {
      provider.once('complete', () => resolve());
      void provider.createStreamingResponse(messages, [
        // Minimal tool to exercise the tool-cache path
        new (class extends (require('@lace/agent/tools/tool').Tool as new () => {
          name: string;
          description: string;
          schema: object;
          executeValidated: (a: unknown, b: unknown) => Promise<{ content: { type: string; text: string }[] }>;
        })() {
          name = 'tool';
          description = 'A test tool';
          schema = { _def: { typeName: 'ZodObject' }, parse: (x: unknown) => x } as object;
          async executeValidated(_a: unknown, _b: unknown) {
            return { content: [{ type: 'text', text: 'ok' }] };
          }
        })() as unknown as Parameters<typeof provider.createStreamingResponse>[1][number],
      ], 'claude-sonnet-4-20250514');
    });

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body) as RequestBody;

    // Same invariants as the non-streaming smoke probe:
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system![0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const lastTool = body.tools![body.tools!.length - 1];
    expect(lastTool.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    // 4 markers expected on this long conversation (system + last-tool + anchor + tail).
    const total = (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
    expect(total).toBe(4);
  });
});
```

(The tool construction in this test is awkward because we're avoiding pulling in the full Tool class machinery. If that block fails to compile, simplify by importing Tool and creating a proper subclass like the other test files do.)

- [ ] **Step 2: Run the test**

Run: `npx vitest --run src/providers/__tests__/cache-control-streaming.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/providers/__tests__/cache-control-streaming.test.ts
git commit -m "test(providers): streaming-path cache_control smoke probe

Adversarial review found the smoke probes only tested createResponse
(non-streaming). The runner uses createStreamingResponse exclusively
— that path had no wire-level cache_control verification. Add it.
"
```

---

### Task 4B: Two-turn byte-compare cache-invariance test

**Files:**
- Create: `packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts`

**Problem:** No test verifies that consecutive turns produce a byte-identical message PREFIX. Any non-determinism leak (e.g., a future regression of PRI-1804 #1 / #2) would silently bust cache without breaking any test.

- [ ] **Step 1: Write the test**

Create `packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts`:

```typescript
// ABOUTME: Asserts that two consecutive provider requests with the same
// session-foundational state produce byte-identical message PREFIXES.
// This is the core property that makes caching useful — any future
// regression that introduces nondeterminism in the messages array (e.g.
// a re-run of variable providers, a non-byte-stable sort, a timestamp
// embedded in a tool description) would silently bust cache without
// breaking any other test. This test catches it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';

class EchoTool extends Tool {
  name = 'echo';
  description = 'Echo a value';
  schema = z.object({ v: z.string() });
  protected async executeValidated(
    args: { v: string },
    _context: ToolContext
  ): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.v));
  }
}

describe('PRI-1804 invariant — message prefix is byte-stable across consecutive turns', () => {
  let server: Server;
  let baseURL: string;
  const captured: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        captured.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: `msg_${captured.length}`,
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('no address');
    baseURL = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  });

  it('shared message prefix is byte-identical across two consecutive turns (only the tail changes)', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-test', baseURL });
    provider.setSystemPrompt('You are Lace. Cached system block.');

    const baseHistory = [
      { role: 'user' as const, content: 'turn 1 question' },
      { role: 'assistant' as const, content: 'turn 1 answer' },
      { role: 'user' as const, content: 'turn 2 question' },
      { role: 'assistant' as const, content: 'turn 2 answer' },
    ];

    // Turn 1: history + one new user message
    await provider.createResponse(
      [...baseHistory, { role: 'user', content: 'NEW question 1' }],
      [new EchoTool()],
      'claude-sonnet-4-20250514'
    );

    // Turn 2: history + the previous turn's assistant reply (synthetic) + another new user message
    await provider.createResponse(
      [
        ...baseHistory,
        { role: 'user', content: 'NEW question 1' },
        { role: 'assistant', content: 'NEW answer 1' },
        { role: 'user', content: 'NEW question 2' },
      ],
      [new EchoTool()],
      'claude-sonnet-4-20250514'
    );

    expect(captured).toHaveLength(2);
    const body1 = JSON.parse(captured[0]) as { system: unknown; tools: unknown; messages: unknown[] };
    const body2 = JSON.parse(captured[1]) as { system: unknown; tools: unknown; messages: unknown[] };

    // system block must be byte-identical
    expect(JSON.stringify(body1.system)).toBe(JSON.stringify(body2.system));

    // tools array must be byte-identical
    expect(JSON.stringify(body1.tools)).toBe(JSON.stringify(body2.tools));

    // Shared message prefix (first 4 messages = baseHistory + the user "NEW question 1" message
    // that's present in both turns) — note turn 1 stamped the LAST block with cache_control,
    // so compare AFTER stripping cache_control from those positions to verify the underlying
    // message content is identical.
    const stripCacheControl = (s: string) =>
      s.replace(/,?"cache_control":\{[^}]*\}/g, '');

    const prefix1 = JSON.stringify(body1.messages.slice(0, body1.messages.length - 1));
    const prefix2 = JSON.stringify(body2.messages.slice(0, body1.messages.length - 1));
    expect(stripCacheControl(prefix1)).toBe(stripCacheControl(prefix2));
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest --run src/providers/__tests__/cache-control-byte-stable.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/providers/__tests__/cache-control-byte-stable.test.ts
git commit -m "test(providers): byte-stable message prefix across consecutive turns

Asserts the core invariant that makes caching work: the shared prefix
between two consecutive turns is byte-identical. Catches future
regressions that introduce non-determinism (sort order changes,
variable-provider re-runs, timestamps embedded in tool descriptions, etc.)
"
```

---

### Task 4C: countTokensExplicit shape parity test

**Files:**
- Create: `packages/agent/src/providers/__tests__/anthropic-provider-count-tokens.test.ts`

**Problem:** PRI-1806 #2 made `countTokensExplicit` mirror the wire shape of `_createRequestPayload`. There's no test that asserts the parity.

- [ ] **Step 1: Write the test**

Create `packages/agent/src/providers/__tests__/anthropic-provider-count-tokens.test.ts`:

```typescript
// ABOUTME: Asserts that countTokensExplicit (used by calibration and budget
// estimation) ships the SAME cache_control shape as the live request path
// (_createRequestPayload). PRI-1806 #2 introduced this parity; this test
// guards against regression.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import { Tool } from '@lace/agent/tools/tool';
import { ToolContext, ToolResult } from '@lace/agent/tools/types';
import { z } from 'zod';

const mockCreate = vi.fn();
const mockCountTokens = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate, stream: vi.fn() };
    beta = { messages: { countTokens: mockCountTokens } };
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

class TestTool extends Tool {
  name = 'tool';
  description = 'A tool';
  schema = z.object({ x: z.string() });
  protected async executeValidated(args: { x: string }, _c: ToolContext): Promise<ToolResult> {
    return Promise.resolve(this.createResult(args.x));
  }
}

describe('countTokensExplicit shape parity with _createRequestPayload (PRI-1806 #2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountTokens.mockResolvedValue({ input_tokens: 100 });
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } });
  });

  it('countTokens and create receive the same cache_control structure', async () => {
    const provider = new AnthropicProvider({ apiKey: 'k' });
    provider.setSystemPrompt('Sys prompt');

    const messages = [{ role: 'user' as const, content: 'hi' }];
    const tools = [new TestTool()];
    const model = 'claude-sonnet-4-20250514';

    await provider.countTokens(messages, tools, model);
    await provider.createResponse(messages, tools, model);

    expect(mockCountTokens).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const countArgs = mockCountTokens.mock.calls[0][0];
    const createArgs = mockCreate.mock.calls[0][0];

    // Both must wrap the system prompt in a TextBlockParam array with cache_control.
    expect(countArgs.system).toEqual(createArgs.system);

    // Both must stamp the last (only) tool with cache_control.
    expect(countArgs.tools).toEqual(createArgs.tools);

    // Both must have identical messages (cache_control on the last block).
    expect(countArgs.messages).toEqual(createArgs.messages);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest --run src/providers/__tests__/anthropic-provider-count-tokens.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/providers/__tests__/anthropic-provider-count-tokens.test.ts
git commit -m "test(providers): assert countTokens and createResponse use the same cache_control shape

Regression guard for PRI-1806 #2: the wire shape sent to the
beta.messages.countTokens helper must match _createRequestPayload's
shape exactly, so token estimates reflect what we actually send.
"
```

---

# Phase 5: Polish (optional, do if time permits)

These are nice-to-have improvements flagged by the adversarial review. None are correctness-critical.

---

### Task 5A: Anchor placement bias improvement (optional)

Per Reviewer C #3: place the anchor mid-history (at `min(ANCHOR_OFFSET_RAW_BLOCKS, cacheable.length/2)`) rather than at the exact threshold, so there's more margin against a big-Δ next turn.

Skip unless explicitly requested — current placement is correct just suboptimal.

---

### Task 5B: `isMessageEmpty` cleanup

Per Reviewer D #9: the current ternary `typeof msg.content === 'string' ? msg.content.length === 0 : msg.content.length === 0` is dead code (same expression on both branches). Replace with a clearer form.

- [ ] Edit `packages/agent/src/providers/cache-control.ts`:

```typescript
function isMessageEmpty(msg: Anthropic.MessageParam): boolean {
  return msg.content.length === 0;
}
```

(`String.length` and `Array.length` both work; the ternary added no value.)

- [ ] Run tests, commit.

---

### Task 5C: `sessionDate` documentation in persona template

Per Reviewer D #15: `sessionDate` is computed in UTC. The persona template doesn't say so. Update the env section:

- [ ] Edit `packages/agent/config/agent-personas/sections/environment.md`:

```markdown
- Current Date (UTC): {{{system.sessionDate}}}
```

(Adding "(UTC)" makes the convention explicit so the model handles the cutover correctly.)

- [ ] Update the PRI-1674 baselines accordingly:

```bash
sed -i '' 's|- Current Date:|- Current Date (UTC):|g' tests/scenarios/pri-1674-baseline/helper-agent.md tests/scenarios/pri-1674-baseline/lace.md
```

- [ ] Run tests, commit.

---

# Phase 6: Final Verification

### Task 6A: Run full provider + storage + conversation test suites

- [ ] `cd packages/agent && npx vitest --run src/providers src/storage src/core/conversation src/tools src/message-building src/config 2>&1 | tail -10`

Expected: all green.

- [ ] `npx tsc --noEmit` — clean.

- [ ] `npx eslint --max-warnings 0 src/providers/cache-control.ts src/providers/anthropic-provider.ts src/providers/bedrock-provider.ts src/providers/base-provider.ts src/providers/openai-provider.ts src/providers/format-converters.ts src/core/conversation/runner.ts src/message-building/message-builder.ts src/storage/event-types.ts src/rpc/handlers/session.ts src/tools/executor.ts src/providers/__tests__/cache-control.test.ts src/providers/__tests__/cache-control-streaming.test.ts src/providers/__tests__/cache-control-byte-stable.test.ts src/providers/__tests__/anthropic-provider-count-tokens.test.ts` — clean.

### Task 6B: Push and FF-merge to main

- [ ] `git push -u origin <branch-name>`
- [ ] `git push origin <branch-name>:main`

### Task 6C: Mark all related Linear tickets resolved

The fix touches issues raised against PRI-1799 / PRI-1802 / PRI-1804 / PRI-1806. File a single new ticket "Cache-control hardening (2026-05-23)" linking to this plan and mark closed after merge.
