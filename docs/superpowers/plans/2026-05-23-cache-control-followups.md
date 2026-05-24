# Cache-Control Hardening — Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five legitimate bugs surfaced by adversarial review of the cache-control hardening branch — bugs that survive after applying YAGNI and the project's "no back-compat" policy.

**Architecture:** Five independent fixes. No new abstractions, no new infrastructure. Each fix is a localized correction at a specific call site or function. Theme: the Phase 2 system-prompt invariant introduced new preconditions (must call `setSystemPrompt` OR explicitly route through a non-default prompt) that not every caller honored.

**Tech Stack:** TypeScript 5.6+, Vitest, Anthropic SDK 0.60, `@lace/agent` monorepo package.

---

## Background

The cache-control hardening branch established this invariant: **the session's system prompt is set once at session creation via `setSystemPrompt`, and `getEffectiveSystemPrompt` returns only that value (with a warn-fallback if unset).** Several call paths haven't been updated to match:

1. `runner.ts` guards `setSystemPrompt` behind `if (frozenSystemPrompt)` — silently allows the warn-fallback to fire when the session is corrupt instead of failing loudly
2. Runner's retry-with-`tool_choice` path pushes a user reminder without an assistant turn when `assistantText` is empty — creates consecutive user messages that Anthropic rejects
3. `ent/session/compact` undercounts the budget by the system prompt's tokens
4. `session/fork` cwd-refresh hardcodes `persona: 'lace'` regardless of source persona
5. Compaction code paths trigger `getEffectiveSystemPrompt`'s warn-fallback on every run, polluting logs (the compaction provider intentionally shouldn't carry the session persona — it's a different job — but it should set SOMETHING so the warn doesn't fire)

Per project policy (`CLAUDE.md`: "We NEVER leave backward-compatibility or legacy code in place. This is a pre-release v1"), we don't handle legacy events.jsonl shapes — those sessions can be discarded.

**Explicitly out of scope** (considered and rejected):

- Merging adjacent `role:'user'` messages in `convertToAnthropicFormat` — the runner retry fix (Task 2) is the real source; the remaining peer-inject-between-tool_use scenario needs three rare preconditions to fire. YAGNI; fix locally if/when reported.
- Setting the session persona on the compaction provider — the summarizer is functionally a different job and shouldn't inhabit the agent persona.

---

## File Structure

**Modified files:**

- `packages/agent/src/core/conversation/runner.ts` — throw on empty `frozenSystemPrompt`; always push assistant turn in retry path
- `packages/agent/src/conversation/slash-commands.ts` — set summarizer prompt on compaction provider
- `packages/agent/src/rpc/handlers/session-operations.ts` — include `systemPrompt` tokens in compaction budget; set summarizer prompt on compaction provider
- `packages/agent/src/rpc/handlers/session.ts` — fork re-render uses source persona

**Test files:**

- `packages/agent/src/core/conversation/__tests__/runner.test.ts` — add empty-systemPrompt throw test, retry-path alternation test
- `packages/agent/src/conversation/__tests__/slash-commands.test.ts` (existing or new) — assert dedicated summarizer prompt is set
- `packages/agent/src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts` — extend with compact-path coverage
- `packages/agent/src/__tests__/session-fork.durable-history.test.ts` — assert non-lace source persona is preserved

---

## Background — what you need to know

### How to run a single Vitest file

From `packages/agent`:
```
npx vitest --run src/path/to/file.test.ts
```

### How session state stores the persona

The session config schema at `packages/agent/src/storage/session-store.ts:42` defines `personaName?: string`. The fork handler can read it via `sourceSession.state.config.personaName`. Fallback to `'lace'` if unset.

### How `loadPromptConfig` works

`packages/agent/src/config/prompts.ts` exports `loadPromptConfig({ persona, tools, session, skillRegistry, personaRegistry })`. The `persona` arg is the persona name string. It returns `{ systemPrompt, userInstructions }` which the caller concatenates with `\n\n`.

### How the runner's retry path works

In `runner.ts` around line 437, when the model returns empty text and no tool calls (and `completedTurns > 0` and we haven't retried yet), the code:
- Conditionally pushes an assistant turn (only if `assistantText.trim().length > 0`)
- Always pushes a user message with `<system-reminder>` content
- Sets `nextRequestOptions = { toolChoice: 'required' }`
- `continue`s the loop

When `assistantText` is empty, no assistant is pushed but the user reminder is. The previous iteration's last entry in `providerMessages` is a `user[toolResults]` message (or the original user prompt). Two consecutive user messages result → Anthropic 400.

### How compaction calls the provider

`compactDroppedMessagesWithCore(strategyId: 'summarize', ...)` invokes the summarize strategy in `packages/agent/src/compaction/summarize-strategy.ts`. The strategy constructs a synthetic user message asking the model to summarize the dropped messages, then calls `provider.createResponse(...)`. The model needs a system prompt different from the session's agent persona — a generic "you summarize conversations" prompt is the right framing.

The compaction provider is throwaway (one call, then discarded). It does NOT participate in the session's cache prefix (different `_systemPrompt`, different conversation shape). Setting the summarizer prompt has no impact on the session's cache-control behavior.

### Why the previousTokens fix matters

`ent/session/compact` computes `previousTokens = estimateProviderTokens(beforeMessages)` (excluding system prompt). It uses this number both for the response payload AND for the budget loop that decides how many recent messages to preserve. If the system prompt is large (~2-5k tokens typical), the budget loop preserves more recent messages than fits, so the post-compaction context still overflows.

The compaction provider doesn't need to know the session's system prompt (Task 3+5 use a summarizer prompt) — but the BUDGET calculation needs to account for it because the session's continuing runtime will keep using the full system prompt.

---

# Tasks

---

### Task 1: Throw on empty `frozenSystemPrompt` in runner

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts:205-212`
- Test: `packages/agent/src/core/conversation/__tests__/runner.test.ts` (new test in existing file)

**Why:** Currently `if (frozenSystemPrompt) { provider.setSystemPrompt(frozenSystemPrompt); }` silently allows the warn-fallback path. The session is in an invalid state (no `system_prompt_set` event) — fail loudly so the bug surfaces immediately rather than letting the model receive `'You are a helpful assistant.'` on every request.

- [ ] **Step 1: Write the failing test**

Append to `packages/agent/src/core/conversation/__tests__/runner.test.ts`. Use the existing `createMockDeps()` helper:

```typescript
describe('runner — empty systemPrompt is a hard error', () => {
  it('throws when buildProviderMessagesFromDurableEvents returns systemPrompt=""', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lace-runner-empty-sp-'));
    // Seed events.jsonl with a prompt event but NO system_prompt_set event
    writeFileSync(
      join(dir, 'events.jsonl'),
      JSON.stringify({
        eventSeq: 1,
        type: 'prompt',
        data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
      }) + '\n'
    );
    writeFileSync(
      join(dir, 'state.json'),
      JSON.stringify({ nextEventSeq: 2, nextStreamSeq: 1 })
    );

    const config = {
      sessionDir: dir,
      sessionId: 'test-session',
      modelId: 'claude-sonnet-4-20250514',
      connectionId: 'test-conn',
    };
    const deps = createMockDeps();
    const runner = new ConversationRunner(config, deps);

    await expect(runner.run([])).rejects.toThrow(/no system_prompt_set/i);

    rmSync(dir, { recursive: true, force: true });
  });
});
```

You'll need to import `mkdtempSync, writeFileSync, rmSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path` if they aren't already imported. Check existing imports at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

From `packages/agent`:
```
npx vitest --run src/core/conversation/__tests__/runner.test.ts -t "empty systemPrompt"
```
Expected: FAIL — current code silently falls through, doesn't throw.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/core/conversation/runner.ts` around line 205-212, replace:

```typescript
    const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
      buildProviderMessagesFromDurableEvents(sessionDir);
    let providerMessages = rebuiltMessages;

    if (frozenSystemPrompt) {
      provider.setSystemPrompt(frozenSystemPrompt);
    }
```

with:

```typescript
    const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
      buildProviderMessagesFromDurableEvents(sessionDir);
    let providerMessages = rebuiltMessages;

    // The system prompt is invariant for the session lifetime and is written
    // by session/new as a system_prompt_set event. An empty result means the
    // session is corrupt or was created without one — fail loudly rather
    // than letting the provider's fallback string silently mask the bug.
    if (!frozenSystemPrompt) {
      throw new Error(
        `Session ${sessionDir} has no system_prompt_set event; ` +
          `the session is corrupt or was created before the invariant was enforced.`
      );
    }
    provider.setSystemPrompt(frozenSystemPrompt);
```

- [ ] **Step 4: Run test to verify it passes**

```
npx vitest --run src/core/conversation/__tests__/runner.test.ts
```
Expected: PASS for the new test AND all existing runner tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "fix(runner): throw on empty systemPrompt instead of silent fallback

A session without a system_prompt_set event is corrupt or pre-invariant.
The old guard 'if (frozenSystemPrompt)' silently allowed the provider's
'You are a helpful assistant.' fallback to fire on every request,
masking the bug. Per pre-release no-back-compat policy: fail loudly.
"
```

---

### Task 2: Always push an assistant turn in runner's retry path

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` around line 437 (the retry block)
- Test: `packages/agent/src/core/conversation/__tests__/runner.test.ts`

**Why:** Anthropic requires alternating user/assistant roles. The retry-with-`tool_choice` path conditionally pushed an assistant turn (only when `assistantText` was non-empty), then unconditionally pushed a user reminder. When `assistantText` is empty, the previous message in `providerMessages` is `user[toolResults]` and the new push is also `user` — two consecutive user messages → 400.

Fix: always push an assistant turn (with a `'(no response)'` placeholder when empty). The placeholder is in-memory only; durable events.jsonl is untouched.

- [ ] **Step 1: Read the current retry block**

In `packages/agent/src/core/conversation/runner.ts` around line 437, locate the `if (!retriedWithToolChoice && completedTurns > 0)` block. Verify it currently has a conditional assistant push (only when `assistantText.trim().length > 0`) followed by an unconditional user push.

- [ ] **Step 2: Write the failing test**

Append to `packages/agent/src/core/conversation/__tests__/runner.test.ts`. Use the existing `TestAgentProvider` pattern:

```typescript
describe('runner — retry path role alternation', () => {
  it('emits an assistant turn before the retry reminder even when model returns empty text', async () => {
    const captured: ProviderMessage[][] = [];
    let callCount = 0;
    // First call: model returns one tool call.
    // Second call: model returns empty text + no tools → retry fires.
    // Third call (the retry): we capture the providerMessages and assert
    // they alternate.
    const provider = new TestAgentProvider({
      createResponse: (messages: ProviderMessage[]) => {
        callCount++;
        captured.push([...messages]);
        if (callCount === 1) {
          return Promise.resolve({
            content: [{ type: 'text', text: '' }],
            toolCalls: [{ id: 't1', name: 'noop', arguments: {} }],
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        }
        if (callCount === 2) {
          return Promise.resolve({
            content: [{ type: 'text', text: '' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        }
        return Promise.resolve({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });

    // Set up a real session dir with a system_prompt_set event + initial prompt.
    // Wire up deps: createProvider returns this provider; tool executor has a 'noop'
    // that returns immediately.
    // Run runner.run([{type:'text', text:'hi'}]) to completion.
    // ... (adapt to match existing runner test scaffolding for session dir setup)

    // The third request (captured[2]) is the retry. Its last three messages
    // must be: user[toolResults], assistant[*], user[reminder].
    const retryRequest = captured[2];
    const lastThree = retryRequest.slice(-3);
    expect(lastThree[0].role).toBe('user');
    expect(lastThree[1].role).toBe('assistant');
    expect(lastThree[2].role).toBe('user');
    const reminderContent =
      typeof lastThree[2].content === 'string' ? lastThree[2].content : '';
    expect(reminderContent).toContain('system-reminder');
  });
});
```

Read the existing `TestAgentProvider` usage in `runner.test.ts` for the exact wiring pattern. The session-dir seeding and dep construction follow established patterns; adapt this sketch to match them.

- [ ] **Step 3: Run the test to verify it fails**

```
npx vitest --run src/core/conversation/__tests__/runner.test.ts -t "retry path role alternation"
```
Expected: FAIL — `lastThree[1].role` is `'user'` (the reminder), not `'assistant'`.

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/core/conversation/runner.ts` around line 437, replace the conditional assistant push with an unconditional one. The new block:

```typescript
if (!retriedWithToolChoice && completedTurns > 0) {
  retriedWithToolChoice = true;
  // Always push an assistant turn before the user reminder, even if the
  // model returned empty text — Anthropic requires alternating roles, and
  // the previous message in providerMessages is user[toolResults]. Without
  // a placeholder, we'd ship consecutive user messages and 400. The
  // placeholder is in-memory only; durable events.jsonl is untouched.
  const assistantPlaceholder = assistantText.trim().length > 0 ? assistantText : '(no response)';
  providerMessages = [
    ...providerMessages,
    { role: 'assistant' as const, content: assistantPlaceholder },
    {
      role: 'user' as const,
      content: '<system-reminder>The previous turn produced no tool call. Please use a tool to make progress, or respond with text if the task is complete.</system-reminder>',
    },
  ];
  nextRequestOptions = { toolChoice: 'required' };
  continue;
}
```

Adapt the exact reminder text to match what's already in the file — read it first; only change the structural logic (always-push assistant) and the placeholder.

- [ ] **Step 5: Run tests to verify pass**

```
npx vitest --run src/core/conversation/__tests__/runner.test.ts
```
Expected: PASS (new test + all existing runner tests).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "fix(runner): always push assistant turn before retry reminder

When the model returns empty text + no tool calls after a tool round-trip,
the retry-with-toolChoice path used to skip the assistant push and
inject a lone user reminder — creating consecutive user messages that
Anthropic rejects with 400. Always push an assistant turn (with '(no response)'
placeholder when empty) so the in-memory providerMessages alternates correctly.
The placeholder is runtime-only; durable events.jsonl is untouched.
"
```

---

### Task 3: `/compact` and `ent/session/compact` set a summarizer prompt on the compaction provider

**Files:**
- Modify: `packages/agent/src/conversation/slash-commands.ts:154` (before the `compactDroppedMessagesWithCore` call)
- Modify: `packages/agent/src/rpc/handlers/session-operations.ts:501` (same pattern at the RPC handler)
- Test: extend one existing compaction test OR add a focused one

**Why:** Both compaction paths construct a throwaway provider, hand it to `compactDroppedMessagesWithCore`, then discard it. Neither calls `setSystemPrompt`. The summarize strategy invokes `provider.createResponse(...)` which calls `getEffectiveSystemPrompt(messages)` → `_systemPrompt` is empty → warn fires and fallback string is used.

We do NOT want to set the session's agent persona on the summarizer (that's the wrong framing — the summarizer's job is to summarize, not to BE Ada). We DO want to suppress the warn-spam by explicitly setting a dedicated summarizer prompt.

Use a constant: `const SUMMARIZER_SYSTEM_PROMPT = 'You produce concise, faithful summaries of conversations between users and AI assistants.';`

- [ ] **Step 1: Create the summarizer prompt constant**

In `packages/agent/src/compaction/summarize-strategy.ts` (or wherever the summarize strategy lives — grep `strategyId === 'summarize'` to find the right file), add an exported constant near the top:

```typescript
/** System prompt set on the throwaway provider used for compaction summarization.
 *  Avoids triggering getEffectiveSystemPrompt's warn-fallback while keeping the
 *  summarizer's role distinct from any session persona. */
export const SUMMARIZER_SYSTEM_PROMPT =
  'You produce concise, faithful summaries of conversations between users and AI assistants.';
```

If `summarize-strategy.ts` doesn't exist (the strategy code may live elsewhere), put the constant in `packages/agent/src/compaction/compact-dropped-messages.ts` alongside the helper that callers use. Use grep to locate.

- [ ] **Step 2: Write the failing test**

Find or create `packages/agent/src/conversation/__tests__/slash-commands.test.ts` and the existing RPC compact test. Add a regression test that spies on `setSystemPrompt`:

```typescript
// In whichever test file covers /compact:
import { SUMMARIZER_SYSTEM_PROMPT } from '@lace/agent/compaction/summarize-strategy'; // or wherever you put it

it('/compact sets the summarizer prompt on the throwaway provider', async () => {
  const setSystemPromptSpy = vi.fn();
  // Mock createProviderForTurn to return a provider that records setSystemPrompt.
  // ... (use the test file's existing mock pattern)

  // ... invoke /compact ...

  expect(setSystemPromptSpy).toHaveBeenCalledWith(SUMMARIZER_SYSTEM_PROMPT);
  expect(setSystemPromptSpy).toHaveBeenCalledTimes(1);
});
```

Repeat for the RPC handler in `session-operations.context-breakdown.test.ts` (or a sibling file).

The test wiring (createProviderForTurn mock, AgentServerState setup) follows existing patterns in those files. Read the existing tests first to copy the right boilerplate.

- [ ] **Step 3: Run the tests to verify they fail**

```
npx vitest --run src/conversation/ src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts -t "summarizer prompt"
```
Expected: FAIL — `setSystemPromptSpy` was not called.

- [ ] **Step 4: Apply the fix in both call sites**

In `packages/agent/src/conversation/slash-commands.ts` around line 154, between `createProviderForTurn(...)` and the `compactDroppedMessagesWithCore(...)` call:

```typescript
const provider = await createProviderForTurn({
  connectionId: effectiveConfig.connectionId,
  modelId: effectiveConfig.modelId,
});
provider.setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT);

const result = await compactDroppedMessagesWithCore({
  strategyId: 'summarize',
  // ... existing args
});
```

Add the import for `SUMMARIZER_SYSTEM_PROMPT` at the top of the file.

In `packages/agent/src/rpc/handlers/session-operations.ts` around line 501, do the same: insert `provider.setSystemPrompt(SUMMARIZER_SYSTEM_PROMPT);` after the provider construction, before the `compactDroppedMessagesWithCore` call.

- [ ] **Step 5: Run tests to verify pass**

```
npx vitest --run src/conversation/ src/rpc/ src/compaction/
```
Expected: PASS for the new tests AND all existing tests (no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/conversation/slash-commands.ts \
        packages/agent/src/rpc/handlers/session-operations.ts \
        packages/agent/src/compaction/ \
        packages/agent/src/conversation/__tests__/ \
        packages/agent/src/rpc/handlers/__tests__/
git commit -m "fix(compaction): set dedicated summarizer prompt on throwaway providers

Both /compact (slash-command) and ent/session/compact (RPC) construct
a throwaway provider for the summarize strategy and never call
setSystemPrompt. After the system-prompt invariant was added, every
compaction triggered the warn-fallback path, polluting logs.

Set an explicit SUMMARIZER_SYSTEM_PROMPT — distinct from any session
persona since the summarizer's job is to summarize, not to inhabit
the agent's role. Silences the warn and gives the summarizer a
purpose-built framing.
"
```

---

### Task 4: `ent/session/compact` counts system prompt tokens in `previousTokens`

**Files:**
- Modify: `packages/agent/src/rpc/handlers/session-operations.ts:465-476`
- Test: `packages/agent/src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts`

**Why:** The RPC handler destructures only `{ messages: beforeMessages }` and computes `previousTokens = estimateProviderTokens(beforeMessages)` — excluding the system prompt's tokens. The system prompt continues to consume context in the session's runtime; the budget loop at line 474 (which uses `estimateProviderTokens(...) > targetTokens` to decide how many recent messages to preserve) makes the wrong decision. Result: post-compaction context can still exceed target by the system prompt size (~2-5k tokens typical), causing subsequent requests to 413.

The compaction PROVIDER doesn't need the session's system prompt (Task 3 sets a summarizer prompt instead). The BUDGET CALCULATION does, because it reflects the session's continuing runtime cost.

- [ ] **Step 1: Write the failing test**

Add to `packages/agent/src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts`:

```typescript
describe('ent/session/compact — previousTokens includes systemPrompt', () => {
  it('returned previousTokens >= estimateTokens(systemPrompt) + estimateProviderTokens(messages)', async () => {
    // Set up a session with a known-large system_prompt_set event text.
    const largeSystemPrompt = 'You are a test assistant. '.repeat(50); // ~400+ tokens

    // Seed the session, then call ent/session/compact with strategy='summarize'.
    // The wiring pattern matches the existing context-breakdown test in this file.

    // ... setup ...
    // const response = await peer.request('ent/session/compact', { strategy: 'summarize' });

    const expectedSystemTokens = estimateTokens(largeSystemPrompt);
    expect(response.previousTokens).toBeGreaterThanOrEqual(expectedSystemTokens);
  });
});
```

Read the existing context-breakdown test for the AgentServerState + paired-peer setup pattern. Adapt to invoke `ent/session/compact` instead of `ent/session/context_breakdown`.

If invoking the compaction handler in a unit test is too invasive (it expects a real provider for the summarize strategy), use `strategy: 'truncate'` instead — that path doesn't need a provider but still goes through the same `previousTokens` calculation, so the test exercises the bug fix.

- [ ] **Step 2: Run the test to verify it fails**

```
npx vitest --run src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts -t "previousTokens includes systemPrompt"
```
Expected: FAIL — `previousTokens` excludes systemPrompt tokens.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/rpc/handlers/session-operations.ts:465`, change:

```typescript
const { messages: beforeMessages } = buildProviderMessagesFromDurableEvents(
  state.activeSession!.dir
);
const previousTokens = estimateProviderTokens(beforeMessages);
```

to:

```typescript
const { messages: beforeMessages, systemPrompt } = buildProviderMessagesFromDurableEvents(
  state.activeSession!.dir
);
const systemPromptTokens = estimateTokens(systemPrompt);
const previousTokens = estimateProviderTokens(beforeMessages) + systemPromptTokens;
```

Also update the budget loop a few lines below (around line 474) so it includes the system prompt cost in its comparison:

```typescript
if (targetTokens !== undefined) {
  while (
    preserveRecent > 0 &&
    systemPromptTokens + estimateProviderTokens(beforeMessages.slice(-preserveRecent)) > targetTokens
  ) {
    preserveRecent -= 1;
  }
}
```

`estimateTokens` is already imported at line 25; no new import needed. The `systemPrompt` variable is the same one Task 3 uses to pass to the (also-modified) compaction provider.

- [ ] **Step 4: Run tests to verify pass**

```
npx vitest --run src/rpc/
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/rpc/handlers/session-operations.ts \
        packages/agent/src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts
git commit -m "fix(session-operations): include systemPrompt in compact budget calculation

ent/session/compact computed previousTokens without the system prompt's
tokens. The budget loop that decides how many recent messages to preserve
made the wrong call: post-compaction context could still exceed target
by the system prompt size (~2-5k tokens), causing follow-up requests to 413.

The compaction provider doesn't need the session's system prompt
(Task 3 uses a dedicated summarizer prompt) — but the budget reflects
the session's continuing runtime cost, which DOES include it.
"
```

---

### Task 5: `session/fork` re-render preserves source persona

**Files:**
- Modify: `packages/agent/src/rpc/handlers/session.ts:608-614`
- Test: `packages/agent/src/__tests__/session-fork.durable-history.test.ts`

**Why:** The cwd-refresh path in `session/fork` hardcodes `persona: 'lace'`. If the source session was created with a non-lace persona, the fork's re-rendered `system_prompt_set` event uses lace and overrides via the message-builder's last-wins semantics.

- [ ] **Step 1: Verify the source persona lookup**

From `packages/agent`:
```
grep -n "personaName" src/storage/session-store.ts src/rpc/handlers/session.ts
```

Expected:
- `src/storage/session-store.ts:42` defines `personaName?: string` on the session config schema
- `src/rpc/handlers/session.ts` writes it during session creation (around line 282 or wherever the config is composed)

Confirm `sourceSession.state.config.personaName` is the right read path.

- [ ] **Step 2: Write the failing test**

Add to `packages/agent/src/__tests__/session-fork.durable-history.test.ts`:

```typescript
describe('session/fork preserves source persona on cwd-refresh', () => {
  it('uses sourceSession.state.config.personaName, not hardcoded "lace"', async () => {
    // 1. Pick a non-lace persona name that exists in the test fixtures' personaRegistry.
    //    Check available personas: ls packages/agent/config/agent-personas/personas/
    //    Use one that loadPromptConfig can resolve in the test environment.
    // 2. Create a session with that persona via session/new.
    // 3. Fork it with a different cwd via session/fork.
    // 4. Read the forked session's events.jsonl directly via readDurableEvents.
    // 5. Assert: two system_prompt_set events exist.
    // 6. Assert: the SECOND event's data.text matches the non-lace persona's
    //    distinctive text (e.g., a unique substring from that persona's md file)
    //    and does NOT match lace's.
    //
    // If only 'lace' is available in test fixtures, fall back to spying on
    // loadPromptConfig (mock it) and asserting the second invocation receives
    // persona: '<source-persona-name>', not 'lace'.
  });
});
```

Read the existing fork tests in this file for the session/new + session/fork wiring pattern, the personaRegistry test fixtures, and the readDurableEvents helper usage. Adapt the sketch to match.

- [ ] **Step 3: Run the test to verify it fails**

```
npx vitest --run src/__tests__/session-fork.durable-history.test.ts -t "preserves source persona"
```
Expected: FAIL — persona is hardcoded to 'lace'.

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/rpc/handlers/session.ts` around line 608-614, replace:

```typescript
const promptConfig = await loadPromptConfig({
  persona: 'lace',
  tools,
  session: { getWorkingDirectory: () => forkedCwd },
  skillRegistry,
  personaRegistry: state.personaRegistry,
});
```

with:

```typescript
// Preserve the source session's persona; fall back to 'lace' only if the
// source has none recorded (corrupt session or non-persona creation path).
const sourcePersona = sourceSession.state.config?.personaName ?? 'lace';
const promptConfig = await loadPromptConfig({
  persona: sourcePersona,
  tools,
  session: { getWorkingDirectory: () => forkedCwd },
  skillRegistry,
  personaRegistry: state.personaRegistry,
});
```

- [ ] **Step 5: Run tests to verify pass**

```
npx vitest --run src/__tests__/session-fork.durable-history.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/rpc/handlers/session.ts \
        packages/agent/src/__tests__/session-fork.durable-history.test.ts
git commit -m "fix(session-fork): preserve source persona in cwd-refresh

The cwd-refresh path hardcoded persona='lace' when re-rendering the
system prompt, silently overriding any non-lace source persona via
the message-builder's last-wins semantics. Read sourceSession's
personaName instead, falling back to 'lace' only when none is recorded.
"
```

---

# Final Verification

### Task 6: Full test suite + lint + push to main

- [ ] From `packages/agent`:
  ```
  npx vitest --run src/providers src/storage src/core/conversation src/tools src/message-building src/config src/rpc src/__tests__ src/conversation src/compaction
  ```
  Expected: all green except the pre-existing `session-fork.durable-history.test.ts > defaults direct MCP override placement` failure (unrelated to this work).

- [ ] `npx tsc --noEmit` from `packages/agent` and `packages/web` — clean.

- [ ] `npx eslint --max-warnings 0` on the touched files:
  ```
  npx eslint --max-warnings 0 \
    src/core/conversation/runner.ts \
    src/core/conversation/__tests__/runner.test.ts \
    src/conversation/slash-commands.ts \
    src/rpc/handlers/session.ts \
    src/rpc/handlers/session-operations.ts \
    src/rpc/handlers/__tests__/session-operations.context-breakdown.test.ts \
    src/__tests__/session-fork.durable-history.test.ts \
    src/compaction/summarize-strategy.ts
  ```

- [ ] From the worktree root, FF-push to main:
  ```
  git push origin cache-control-hardening-2026-05-23
  git push origin cache-control-hardening-2026-05-23:main
  ```
