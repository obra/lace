# Cache-Control Hardening — Round 3 Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the legitimate bugs surfaced by the third round of adversarial
review of the cache-control branch — bugs introduced or exposed by Round 1/2
fixes that need targeted correction.

**Architecture:** Eight small, independent fixes. Two share a helper
(`composeAndWriteSystemPromptSet` and `appendOrMergeUser`) that get extracted on
first use and reused. No new infrastructure beyond those helpers.

**Tech Stack:** TypeScript 5.6+, Vitest, Anthropic SDK 0.60, `@lace/agent`
monorepo package.

---

## Background

Two rounds of adversarial review + fixes landed on the cache-control branch.
Round 3 surfaced more issues — most introduced by Round 2's "fail loud" runner
throw on empty `systemPrompt` (which broke `/clear` and exposed
`Session.create`'s gap), plus pre-existing issues the earlier rounds didn't
catch.

The legitimate bugs (after filtering speculative ones):

1. **CRITICAL — `/clear` writes a session with no `system_prompt_set` event;
   next prompt throws.** Round 2's runner throw made this previously-silent gap
   a hard failure.
2. **CRITICAL — `/compact` slash-command writes `type: 'compaction'`, but
   message-builder only handles `'context_compacted'`. Compaction is a silent
   no-op.**
3. **CRITICAL — Consecutive `role:'user'` messages from loop-reminder push,
   peer-injected `context_injected` events, and rebuild paths.** Three sources
   produce the same wire-violation pattern.
4. **IMPORTANT — `previousTokens` includes systemPrompt, `currentTokens`
   doesn't.** Returned values aren't comparable.
5. **IMPORTANT — Fork-with-cwd-change writes a second `system_prompt_set`;
   message-builder logs "invariant violation" on every rebuild.**
6. **IMPORTANT — Provider leak when runner throws on empty systemPrompt.**
   Constructed at line 179, throw at line 212, never cleaned up.
7. **IMPORTANT — `personaName` not persisted when `requestedPersona` is
   null/undefined.** Default-persona sessions lose this info, and `session/fork`
   can't recover it.
8. **IMPORTANT — `Session.create` library API doesn't write
   `system_prompt_set`.** Currently dormant (`Session.prompt` unimplemented) but
   the public API is broken.

Skipped per YAGNI / not actually broken / project policy:

- Legacy sessions throwing at runner (no back-compat per CLAUDE.md)
- `getEffectiveSystemPrompt` warn-spam (handled implicitly by Task 1, which
  ensures all live sessions have prompts; the warn fires only on truly corrupt
  sessions)
- `ModelPinnedProvider.setSystemPrompt` delegation (works today; future-proofing
  not warranted)
- BedrockProvider extended-cache-ttl beta header (needs separate doc check)
- `isMessageEmpty` whitespace handling (edge case, no production trigger)
- Runner watermark of 0 re-pushing pre-existing immediate injects (narrow case,
  Task 3 covers the consequences)

---

## File Structure

**New files:** none.

**Modified files:**

- `packages/agent/src/rpc/handlers/session.ts` — extract
  `composeAndWriteSystemPromptSet` helper; always persist `personaName`
- `packages/agent/src/conversation/slash-commands.ts` — `/clear` writes
  `system_prompt_set`; `/compact` writes `context_compacted` and uses Task 3's
  append-or-merge helper
- `packages/agent/src/core/conversation/runner.ts` — check empty systemPrompt
  BEFORE provider construction; use append-or-merge helper for loop reminder +
  readImmediateInjectsSince
- `packages/agent/src/message-building/message-builder.ts` — use append-or-merge
  helper for `context_injected` events
- `packages/agent/src/message-building/append-or-merge.ts` — NEW small helper
  (one file, ~15 lines)
- `packages/agent/src/rpc/handlers/session-operations.ts` — `currentTokens`
  includes systemPrompt
- `packages/agent/src/core/session.ts` — either delete `Session.create`
  (preferred) or make it write `system_prompt_set`

**Test files:**

- `packages/agent/src/conversation/__tests__/slash-commands.clear.test.ts` — new
- `packages/agent/src/conversation/__tests__/slash-commands.compact.test.ts` —
  extend (already created in Round 2 Task 3)
- `packages/agent/src/message-building/__tests__/append-or-merge.test.ts` — new
- `packages/agent/src/core/conversation/__tests__/runner.test.ts` — extend
- `packages/agent/src/message-building/message-builder.test.ts` — extend
- `packages/agent/src/rpc/handlers/__tests__/session-operations.compact-budget.test.ts`
  — extend
- `packages/agent/src/__tests__/session-fork.durable-history.test.ts` — extend
  (verify warn no longer fires)

---

## Background — what you need to know

### How to run a single Vitest file

From `packages/agent`:

```
npx vitest --run src/path/to/file.test.ts
```

### How `/clear` currently works

`packages/agent/src/conversation/slash-commands.ts:188-225` — creates a new
session via `writeSessionMeta`, `writeSessionState`, `ensureSessionFiles`, then
switches `state.activeSession` to it. It does NOT write a `system_prompt_set`
event. The next `session/prompt` triggers the runner, which throws because
`frozenSystemPrompt === ''`.

### How `session/new` writes the system_prompt_set

`packages/agent/src/rpc/handlers/session.ts:414-458` (approximately) — calls
`loadPromptConfig({persona, tools, session, skillRegistry, personaRegistry})`,
composes `fullSystemPrompt = systemPrompt + '\n\n' + userInstructions` (omitting
the join when userInstructions is empty), and appends a `system_prompt_set`
event. This logic needs to be extracted into a helper so `/clear` can call it
too.

### How `/compact` currently writes the wrong event type

`packages/agent/src/conversation/slash-commands.ts:171-178`:

```typescript
await writeAndAdvance({
  type: 'compaction',
  data: { summary: result.summary, droppedCount: providerMessages.length - 1 },
});
```

The message-builder switch handles `prompt`, `context_injected`,
`context_compacted`, `message`, `tool_use`, `system_prompt_set`. There is no
`'compaction'` branch. The summary is written to disk but never read on rebuild.
The next time the session is loaded, all the original messages replay.

### How RPC compact writes the event correctly

`packages/agent/src/rpc/handlers/session-operations.ts:546-557`:

```typescript
const { nextState } = appendDurableEvent(
  state.activeSession!.dir,
  sessionState,
  {
    type: 'context_compacted',
    data: {
      strategy,
      ...(targetTokens !== undefined ? { targetTokens } : {}),
      preserveRecent,
      messagesCompacted,
      preserved: serializedPreserved,
    },
  }
);
```

`/compact` should match this shape.

### Why consecutive `role:'user'` messages are a problem

Anthropic's API combines consecutive same-role messages, but the combination is
implementation-defined and disrupts cache-prefix stability. We had Round 2 Task
2 fix the runner's retry path by inserting an assistant placeholder. Round 3
found three more sources:

- **Loop reminder** (runner.ts:267-271): pushes
  `{role:'user', content: reminder}` after a turn that may have ended with
  `{role:'user', toolResults:[...]}`.
- **`readImmediateInjectsSince`** (runner.ts:240): pushes
  `{role:'user', content: injection}` from peer-injected `context_injected`
  events; the previous message can also be `{role:'user', toolResults:[...]}`.
- **Message-builder rebuild** (message-builder.ts ~line 230): a peer's
  `context_injected` event written between two `tool_use` events lands between
  two user messages on rebuild.

The fix is a single helper `appendOrMergeUser(messages, content)` that checks if
the last message is `role:'user'` and either appends a text block to its content
or pushes a new message. Used in all three sites.

### Why `personaName` should always be persisted

`packages/agent/src/rpc/handlers/session.ts:392` writes `personaName` only when
`requestedPersona` is truthy. When the user creates a session without specifying
persona, the handler defaults to `'lace'` at the render site (line 415) but
doesn't store it. `session/fork:611` reads
`sourceSession.state.config?.personaName ?? 'lace'` — works today, but the fork
can't tell whether the source explicitly chose lace or defaulted into it.

Fix: always store the resolved persona name (`requestedPersona ?? 'lace'`).

### About `Session.create` (library API)

`packages/agent/src/core/session.ts:52-78` exports a `Session.create` factory
that initializes session storage but doesn't write `system_prompt_set`.
`Session.prompt()` is currently unimplemented (throws), so the API is dormant.
Per CLAUDE.md "no back-compat" policy: delete the broken API rather than fix it.
If the library API is needed later, design it properly with the
system_prompt_set requirement built in.

---

# Tasks

---

### Task 1: Extract `composeAndWriteSystemPromptSet` helper; have `/clear` use it

**Files:**

- Modify: `packages/agent/src/rpc/handlers/session.ts` — extract the helper from
  `session/new`'s body and call it
- Modify: `packages/agent/src/conversation/slash-commands.ts:188-225` (`/clear`
  case) — call the helper after session creation
- Test: `packages/agent/src/conversation/__tests__/slash-commands.clear.test.ts`
  (new)

**Why:** `/clear` creates a session without `system_prompt_set` → runner throws
on next prompt. Fix at the source by extracting the working session/new logic
and reusing it.

- [ ] **Step 1: Write the failing test**

Create `packages/agent/src/conversation/__tests__/slash-commands.clear.test.ts`.
Use the same scaffolding pattern as `slash-commands.compact.test.ts` (the
existing test file from Round 2 Task 3):

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairedPeers } from '@lace/ent-protocol/testing'; // or wherever helpers live
import {
  createAgentServerState,
  registerAgentRpcMethods,
} from '@lace/agent/server';
import { defaultInitializeParams } from './test-helpers'; // adapt to actual helper

describe('/clear writes system_prompt_set event in the new session', () => {
  it('next prompt after /clear succeeds (no throw on missing system_prompt_set)', async () => {
    const laceDir = mkdtempSync(join(tmpdir(), 'lace-clear-test-'));
    process.env.LACE_DIR = laceDir;

    const state = createAgentServerState();
    const { client, server } = createPairedPeers((peer) =>
      registerAgentRpcMethods(peer, state)
    );

    try {
      await client.request('initialize', defaultInitializeParams());

      // Create initial session.
      const sourceSession = (await client.request('session/new', {
        cwd: laceDir,
        mcpServers: [],
      })) as { sessionId: string };

      // Run /clear via the slash-commands handler. The exact RPC method depends
      // on how slash commands are invoked — read slash-commands.test.ts or the
      // existing compact test for the pattern. Likely:
      //   await client.request('session/prompt', { content: '/clear' });
      // OR direct call into the slash-commands handler via a test helper.

      // Read the new session's events.jsonl
      const newSessionId = state.activeSession!.meta.sessionId;
      const newSessionDir = state.activeSession!.dir;
      const events = readFileSync(join(newSessionDir, 'events.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string });

      // Assert: first event of new session is system_prompt_set
      expect(events[0]?.type).toBe('system_prompt_set');

      // Sanity: new session is different from the original
      expect(newSessionId).not.toBe(sourceSession.sessionId);
    } finally {
      client.close();
      server.close();
    }
  });
});
```

Read the Round 2 compact test for the exact scaffolding pattern. Adapt the
invocation of /clear to whatever invocation mechanism the slash-commands test
infrastructure uses.

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/agent && npx vitest --run src/conversation/__tests__/slash-commands.clear.test.ts
```

Expected: FAIL — events.jsonl has no `system_prompt_set` event.

- [ ] **Step 3: Extract the helper in session.ts**

In `packages/agent/src/rpc/handlers/session.ts`, find the session/new handler's
`system_prompt_set` write logic (around line 444-458). Extract into an exported
async helper. New file structure inside session.ts:

```typescript
/**
 * Render the session's system prompt via loadPromptConfig and append a
 * system_prompt_set event to the session's durable event log. Shared by
 * session/new RPC handler and the /clear slash command — both must produce
 * sessions with the system-prompt invariant satisfied (see runner.ts:212
 * which throws on missing system_prompt_set).
 */
export async function composeAndWriteSystemPromptSet(params: {
  sessionDir: string;
  sessionState: SessionState;
  persona: string;
  cwd: string;
  state: AgentServerState;
  skillDirs?: string[];
  toolScope?: string[];
}): Promise<SessionState> {
  const {
    sessionDir,
    sessionState,
    persona,
    cwd,
    state,
    skillDirs,
    toolScope,
  } = params;

  const dirs = skillDirs ?? state.skillDirs ?? getSkillDirectories(cwd);
  const skillRegistry = new SkillRegistry({ skillDirs: dirs });

  const { toolsForProvider } = await createToolExecutorForMode(
    state.config.executionMode,
    state.mcpServerManager,
    undefined, // jobManager
    skillRegistry,
    toolScope,
    state.personaRegistry
  );
  const tools = toolsForProvider.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  const promptConfig = await loadPromptConfig({
    persona,
    tools,
    session: { getWorkingDirectory: () => cwd },
    skillRegistry,
    personaRegistry: state.personaRegistry,
  });

  const fullSystemPrompt = promptConfig.userInstructions.trim()
    ? `${promptConfig.systemPrompt}\n\n${promptConfig.userInstructions}`
    : promptConfig.systemPrompt;

  const { nextState } = appendDurableEvent(sessionDir, sessionState, {
    type: 'system_prompt_set',
    data: { type: 'system_prompt_set', text: fullSystemPrompt },
  });
  return nextState;
}
```

Then update the session/new handler to call this helper instead of inlining the
logic. Keep the call site small — pass through all the same params, assign the
returned state, write it.

Also update the existing fork-with-cwd-change re-render (around line 608) to use
this helper for consistency.

Verify the existing session/new + session-fork tests still pass after this
refactor:

```
npx vitest --run src/rpc/handlers/ src/__tests__/system-prompt-injection.test.ts src/__tests__/session-fork.durable-history.test.ts
```

- [ ] **Step 4: Update `/clear` to call the helper**

In `packages/agent/src/conversation/slash-commands.ts:188-225`, after
`ensureSessionFiles(newSessionDir)`, write the system_prompt_set event:

```typescript
ensureSessionFiles(newSessionDir);

// Switch to the new session
state.activeSession = loadSession(newSessionId);

// Write the system_prompt_set event so the runner's invariant is satisfied.
// The new session inherits the previous session's persona (defaulting to 'lace').
const persona = sessionConfig.personaName ?? 'lace';
const newSessionState = readSessionState(newSessionDir);
const updatedState = await composeAndWriteSystemPromptSet({
  sessionDir: newSessionDir,
  sessionState: newSessionState,
  persona,
  cwd: workDir,
  state,
});
writeSessionState(newSessionDir, updatedState);
state.activeSession = loadSession(newSessionId);
```

Add the import at the top of slash-commands.ts:

```typescript
import { composeAndWriteSystemPromptSet } from '../rpc/handlers/session';
import { readSessionState } from '../storage/session-store'; // if not already imported
```

- [ ] **Step 5: Run tests to verify pass**

```
npx vitest --run src/conversation/__tests__/slash-commands.clear.test.ts
```

Expected: PASS.

Then broader regression check:

```
npx vitest --run src/conversation/ src/rpc/ src/__tests__/
```

Expected: pre-existing MCP failure only.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/rpc/handlers/session.ts \
        packages/agent/src/conversation/slash-commands.ts \
        packages/agent/src/conversation/__tests__/slash-commands.clear.test.ts
git commit -m "fix(slash-commands): /clear writes system_prompt_set in the new session

Round 2's runner throw on empty systemPrompt exposed that /clear creates
sessions without the required system_prompt_set event, bricking the next
prompt. Extract the session/new event-write logic into a
composeAndWriteSystemPromptSet helper and call it from /clear too.

Also refactors session/fork's cwd-refresh path to use the same helper
for consistency.
"
```

---

### Task 2: `/compact` writes `context_compacted` (not `'compaction'`)

**Files:**

- Modify: `packages/agent/src/conversation/slash-commands.ts:171-178`
- Test: extend
  `packages/agent/src/conversation/__tests__/slash-commands.compact.test.ts`

**Why:** `/compact` writes `type: 'compaction'`, which message-builder doesn't
recognize. The summary is shown to the user but discarded on the next rebuild.
Match the RPC handler's `context_compacted` shape so message-builder picks it
up.

- [ ] **Step 1: Read the existing compact test**

Read `packages/agent/src/conversation/__tests__/slash-commands.compact.test.ts`
(added in Round 2 Task 3) to see the scaffolding.

- [ ] **Step 2: Add a failing test**

Extend the file with:

```typescript
describe('/compact writes context_compacted event the message-builder recognizes', () => {
  it('rebuild after /compact shows summary, NOT the original messages', async () => {
    // Set up a session, push enough messages to trigger compaction, run /compact,
    // then call buildProviderMessagesFromDurableEvents and assert:
    //   - The rebuilt messages array reflects the compaction (summary is present)
    //   - The original pre-compaction messages are NOT all replayed
    // Adapt to the scaffolding pattern of the file.

    // After /compact runs, read the session's events.jsonl directly:
    const events = readFileSync(join(sessionDir, 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line) as { type: string; data: Record<string, unknown> }
      );

    const compactEvent = events.find((e) => e.type === 'context_compacted');
    expect(compactEvent).toBeDefined();
    expect(compactEvent!.data.strategy).toBe('summarize');
    expect(compactEvent!.data.preserved).toBeDefined();

    // No 'compaction'-typed events (the old wrong type)
    expect(events.find((e) => e.type === 'compaction')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```
npx vitest --run src/conversation/__tests__/slash-commands.compact.test.ts -t "context_compacted"
```

Expected: FAIL — the written event has `type: 'compaction'`, not
`'context_compacted'`.

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/conversation/slash-commands.ts:171-178`, replace:

```typescript
if (result.summary) {
  // Write compaction event
  await writeAndAdvance({
    type: 'compaction',
    data: {
      summary: result.summary,
      droppedCount: providerMessages.length - 1,
    },
  });
  return finishTurn(`Context compacted. Summary:\n\n${result.summary}`);
}
```

with:

```typescript
if (result.summary) {
  // The last message is preserved verbatim (the user's most recent prompt);
  // everything else is replaced by the summary. Match the wire shape used by
  // ent/session/compact (session-operations.ts:548) so message-builder picks
  // it up on rebuild.
  const preserved = providerMessages.slice(-1).map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : '',
    ...(Array.isArray(m.toolCalls) ? { toolCalls: m.toolCalls } : {}),
    ...(Array.isArray(m.toolResults) ? { toolResults: m.toolResults } : {}),
  }));
  await writeAndAdvance({
    type: 'context_compacted',
    data: {
      strategy: 'summarize',
      preserveRecent: 1,
      messagesCompacted: providerMessages.length - 1,
      preserved,
    },
  });
  return finishTurn(`Context compacted. Summary:\n\n${result.summary}`);
}
```

The `summary` field — note that the RPC handler writes the strategy's output via
`compactDroppedMessagesWithCore` and the summary text is rebuilt by
message-builder from the `preserved` array. Verify by reading message-builder's
`context_compacted` handler: if the summary needs to be IN the preserved array
(e.g., as a synthetic user message with the `<previous-context-summary>` tag —
wait, we reverted those tags in Round 2; the summary is now a plain text
message), match what the RPC writes.

Actually re-read `session-operations.ts:546-557` carefully to see exactly what
gets written. The plan says "preserved: serializedPreserved" — where does the
summary text live? It may be that the strategy writes it INTO
`serializedPreserved` as a message. Read `summarize-strategy.ts` to confirm.
Whatever the RPC does, mirror it.

- [ ] **Step 5: Run tests to verify pass**

```
npx vitest --run src/conversation/__tests__/slash-commands.compact.test.ts
npx vitest --run src/message-building/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/conversation/slash-commands.ts \
        packages/agent/src/conversation/__tests__/slash-commands.compact.test.ts
git commit -m "fix(slash-commands): /compact writes context_compacted event

The /compact handler wrote type:'compaction' but message-builder only
handles 'context_compacted'. The summary was discarded on every rebuild,
making /compact a silent no-op. Match the wire shape used by the RPC
ent/session/compact handler so the event is read on rebuild.
"
```

---

### Task 3: Create `appendOrMergeUser` helper and use it in three sites

**Files:**

- Create: `packages/agent/src/message-building/append-or-merge.ts`
- Test: `packages/agent/src/message-building/__tests__/append-or-merge.test.ts`
- Modify: `packages/agent/src/core/conversation/runner.ts:240`
  (readImmediateInjectsSince site) and `:267-271` (loop reminder)
- Modify: `packages/agent/src/message-building/message-builder.ts`
  (context_injected emit site)
- Test: extend `packages/agent/src/message-building/message-builder.test.ts` and
  `runner.test.ts`

**Why:** Three call sites push `{role:'user', content: text}` to a messages
array without checking if the last entry is already `role:'user'`. Adjacent
same-role messages disrupt cache reach and Anthropic combines them in
implementation-defined ways. Single helper handles all three.

- [ ] **Step 1: Write the failing helper tests**

Create `packages/agent/src/message-building/__tests__/append-or-merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { appendOrMergeUser } from '../append-or-merge';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

describe('appendOrMergeUser', () => {
  it('appends new user message when last is assistant', () => {
    const messages: ProviderMessage[] = [{ role: 'assistant', content: 'hi' }];
    const result = appendOrMergeUser(messages, 'hello');
    expect(result).toEqual([
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('merges text into last user message (string content) by joining with newline', () => {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'first' }];
    const result = appendOrMergeUser(messages, 'second');
    expect(result).toEqual([{ role: 'user', content: 'first\nsecond' }]);
  });

  it('appends text block to last user message (array content)', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'first' }] },
    ];
    const result = appendOrMergeUser(messages, 'second');
    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    ]);
  });

  it('appends text block to last user message that has toolResults (mixed content)', () => {
    // The runner produces { role:'user', content:'', toolResults:[...] } messages
    // for tool results. When the loop reminder fires, the reminder text should
    // merge into this message — promote content to array form with a text block.
    const messages: ProviderMessage[] = [
      {
        role: 'user',
        content: '',
        toolResults: [
          {
            id: 't1',
            content: [{ type: 'text', text: 'r1' }],
            status: 'completed',
          },
        ],
      },
    ];
    const result = appendOrMergeUser(messages, 'reminder');
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].toolResults).toEqual(messages[0].toolResults);
    // content was promoted to include the reminder text
    expect(result[0].content).toBe('reminder');
  });

  it('appends new user message to empty array', () => {
    const result = appendOrMergeUser([], 'first');
    expect(result).toEqual([{ role: 'user', content: 'first' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (file not yet created)**

```
npx vitest --run src/message-building/__tests__/append-or-merge.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `packages/agent/src/message-building/append-or-merge.ts`:

```typescript
// ABOUTME: Helper that appends a user text into a ProviderMessage[] either as
// a new role:'user' entry OR by merging into the last entry when it's already
// role:'user'. Used by runner (loop reminder, immediate inject re-read) and
// message-builder (context_injected events) to prevent consecutive same-role
// messages from disrupting cache reach or being implementation-defined-merged
// by Anthropic.

import type { ProviderMessage } from '@lace/agent/providers/base-provider';

/**
 * Returns a new array with `text` appended as a user message. If the last
 * existing message is already role:'user', merges `text` into it instead of
 * pushing a new entry. The merge preserves any toolResults the last message
 * has — only the .content field gets the text added (joined with newline for
 * string content, appended as a text block for array content).
 */
export function appendOrMergeUser(
  messages: ProviderMessage[],
  text: string
): ProviderMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') {
    return [...messages, { role: 'user', content: text }];
  }

  // Last is role:'user' — merge.
  const merged: ProviderMessage = { ...last };
  if (typeof last.content === 'string') {
    // For string content, join with newline. If existing content is empty
    // (tool-results-only message), the result is just the new text.
    merged.content =
      last.content.length > 0 ? `${last.content}\n${text}` : text;
  } else {
    // For array content, append a text block.
    merged.content = [...last.content, { type: 'text', text }];
  }
  return [...messages.slice(0, -1), merged];
}
```

- [ ] **Step 4: Run helper tests to verify pass**

```
npx vitest --run src/message-building/__tests__/append-or-merge.test.ts
```

Expected: PASS (all 5 tests).

- [ ] **Step 5: Use the helper in runner.ts (loop reminder)**

In `packages/agent/src/core/conversation/runner.ts` around line 267-271, find
the loop-check reminder push:

```typescript
if (
  completedTurns > 0 &&
  completedTurns % ConversationRunner.LOOP_CHECK_INTERVAL === 0
) {
  const reminder =
    '<system-reminder>You have completed many agentic turns. ...</system-reminder>';
  providerMessages = [
    ...providerMessages,
    { role: 'user' as const, content: reminder },
  ];
}
```

Replace with:

```typescript
if (
  completedTurns > 0 &&
  completedTurns % ConversationRunner.LOOP_CHECK_INTERVAL === 0
) {
  const reminder =
    '<system-reminder>You have completed many agentic turns. ...</system-reminder>';
  // Use append-or-merge so the reminder folds into the previous user
  // message when one exists (typically user[toolResults] from the last
  // turn). Prevents consecutive role:'user' messages on the wire.
  providerMessages = appendOrMergeUser(providerMessages, reminder);
}
```

Add the import at the top of runner.ts:

```typescript
import { appendOrMergeUser } from '@lace/agent/message-building/append-or-merge';
```

- [ ] **Step 6: Use the helper in runner.ts (readImmediateInjectsSince)**

In the same file around line 240, find the loop that processes immediate
injects:

```typescript
        const { injections, newWatermark } = readImmediateInjectsSince(...);
        if (injections.length > 0) {
          providerMessages = [
            ...providerMessages,
            ...injections.map((content) => ({ role: 'user' as const, content })),
          ];
        }
```

Replace with:

```typescript
        const { injections, newWatermark } = readImmediateInjectsSince(...);
        for (const content of injections) {
          providerMessages = appendOrMergeUser(providerMessages, content);
        }
```

- [ ] **Step 7: Use the helper in message-builder context_injected emission**

In `packages/agent/src/message-building/message-builder.ts`, find the
`context_injected` event handler (search for
`if (e.type === 'context_injected')`). It currently does something like
`messages.push({ role: 'user', content })`. Replace with the helper.

Read the current code first; the exact form depends on whether the function uses
`messages.push(...)` or returns a new array. Adapt the helper call accordingly:

```typescript
// If using push:
//   const merged = appendOrMergeUser(messages, content);
//   messages.length = 0;
//   messages.push(...merged);
// If accumulating differently, just call appendOrMergeUser and reassign.
```

The simplest version: replace `messages.push({role:'user', content})` with:

```typescript
const last = messages[messages.length - 1];
if (last && last.role === 'user') {
  // Merge in-place to avoid array recreation in the loop hot path.
  if (typeof last.content === 'string') {
    last.content =
      last.content.length > 0 ? `${last.content}\n${content}` : content;
  } else {
    last.content = [...last.content, { type: 'text', text: content }];
  }
} else {
  messages.push({ role: 'user', content });
}
```

(If the loop already uses push semantics, the in-place merge above is cheaper
than calling the helper which copies the whole array. Either approach is fine;
pick whichever fits the surrounding style.)

- [ ] **Step 8: Add integration tests**

Add to `packages/agent/src/core/conversation/__tests__/runner.test.ts`:

```typescript
describe('runner — loop reminder merges into previous user message', () => {
  it('does NOT produce consecutive user messages at the LOOP_CHECK_INTERVAL boundary', async () => {
    // Drive the runner past LOOP_CHECK_INTERVAL turns with tool calls so the
    // previous message is user[toolResults]. Assert the captured providerMessages
    // at iteration LOOP_CHECK_INTERVAL+1 does NOT have two consecutive role:'user'
    // entries — the reminder should have merged into the existing user message.

    // ... (reuse the existing loop-reminder test scaffolding)

    const captured = /* the request providerMessages captured */;
    for (let i = 1; i < captured.length; i++) {
      const consecutive = captured[i].role === captured[i - 1].role;
      const bothUser = captured[i].role === 'user' && captured[i - 1].role === 'user';
      expect(bothUser).toBe(false);
    }
    // And the reminder text appears in one of the user messages
    const reminderFound = captured.some((m) =>
      typeof m.content === 'string'
        ? m.content.includes('system-reminder')
        : m.content.some((b) => b.type === 'text' && b.text.includes('system-reminder'))
    );
    expect(reminderFound).toBe(true);
  });
});
```

Add to `packages/agent/src/message-building/message-builder.test.ts`:

```typescript
describe('message-builder — context_injected merges into adjacent user message', () => {
  it('peer-inject between two tool_use events does NOT produce consecutive user messages', () => {
    // events.jsonl: prompt(user), tool_use(asst+user[toolResult]), context_injected, tool_use(asst+user[toolResult])
    // Rebuild and assert no consecutive role:'user' entries.
    // ... (adapt to existing test fixture pattern)
  });
});
```

- [ ] **Step 9: Run all affected tests**

```
npx vitest --run src/message-building/ src/core/conversation/ src/conversation/
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/agent/src/message-building/append-or-merge.ts \
        packages/agent/src/message-building/__tests__/append-or-merge.test.ts \
        packages/agent/src/message-building/message-builder.ts \
        packages/agent/src/message-building/message-builder.test.ts \
        packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "fix: prevent consecutive role:user messages via appendOrMergeUser helper

Three sites pushed user text into the messages array without checking the
last entry's role: loop-check reminder, readImmediateInjectsSince
re-read, and message-builder context_injected emission. Each can land
after a user[toolResults] entry, producing consecutive role:user that
Anthropic combines in implementation-defined ways and that disrupts
cache reach.

New appendOrMergeUser helper checks and merges. Used in all three sites.
"
```

---

### Task 4: `currentTokens` includes systemPrompt to be comparable to `previousTokens`

**Files:**

- Modify: `packages/agent/src/rpc/handlers/session-operations.ts` (around line
  528, the `currentTokens` calculation)
- Test: extend
  `packages/agent/src/rpc/handlers/__tests__/session-operations.compact-budget.test.ts`

**Why:** Round 2 Task 4 added `+ systemPromptTokens` to `previousTokens`
(line 470) and to the preserveRecent budget loop (line 478), but missed the
final `currentTokens` calculation. Consumers subtracting
`previousTokens - currentTokens` see the systemPrompt's tokens as if they were
freed — misleading by 2-5k tokens for typical personas.

- [ ] **Step 1: Read the current code**

In `packages/agent/src/rpc/handlers/session-operations.ts`, find the
`currentTokens` calculation (search "currentTokens"). Note where it's computed
and what variables are in scope.

- [ ] **Step 2: Add the failing test**

Extend
`packages/agent/src/rpc/handlers/__tests__/session-operations.compact-budget.test.ts`:

```typescript
it('previousTokens and currentTokens are both inclusive of systemPrompt for comparability', async () => {
  // Set up a session with a known-large system prompt and several messages.
  // Run ent/session/compact with strategy:'truncate' (no LLM needed).
  // Assert: response.currentTokens >= systemPromptTokens.
  // This proves currentTokens includes the system prompt, matching previousTokens.

  const largePrompt = 'You are a test assistant. '.repeat(50); // ~250 tokens
  // ... setup session with this prompt + 5 message pairs ...
  // ... invoke ent/session/compact ...

  const expectedSystemTokens = estimateTokens(largePrompt);
  expect(response.currentTokens).toBeGreaterThanOrEqual(expectedSystemTokens);
});
```

Adapt to the existing test scaffolding pattern in the file.

- [ ] **Step 3: Run test to verify it fails**

```
npx vitest --run src/rpc/handlers/__tests__/session-operations.compact-budget.test.ts -t "comparability"
```

Expected: FAIL — currentTokens doesn't include systemPromptTokens.

- [ ] **Step 4: Apply the fix**

In `packages/agent/src/rpc/handlers/session-operations.ts`, find the line that
sets `currentTokens`. It currently looks something like:

```typescript
const currentTokens = estimateProviderTokens(nextProviderMessages);
```

Change to:

```typescript
const currentTokens =
  estimateProviderTokens(nextProviderMessages) + systemPromptTokens;
```

`systemPromptTokens` is already in scope from Round 2 Task 4.

- [ ] **Step 5: Run tests**

```
npx vitest --run src/rpc/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/rpc/handlers/session-operations.ts \
        packages/agent/src/rpc/handlers/__tests__/session-operations.compact-budget.test.ts
git commit -m "fix(session-operations): currentTokens includes systemPrompt for comparability

Round 2 added systemPromptTokens to previousTokens but missed currentTokens.
Consumers subtracting previousTokens - currentTokens to display 'tokens
freed' were over-reporting by the system prompt size (~2-5k tokens
typical). Both values now include the system prompt; the diff is the
actual freed message tokens.
"
```

---

### Task 5: Fork-with-cwd-change rewrites events.jsonl to single system_prompt_set

**Files:**

- Modify: `packages/agent/src/rpc/handlers/session.ts:586-631` (the
  fork-with-cwd-change branch)
- Test: extend
  `packages/agent/src/__tests__/session-fork.durable-history.test.ts`

**Why:** The current fork-cwd-change writes a SECOND `system_prompt_set` event.
The message-builder treats `count > 1` as an invariant violation and logs a WARN
every rebuild. The cleanest fix: replace (not append) the source's
system_prompt_set when forking to a different cwd. The fork is creating a new
events.jsonl anyway; just skip copying the source's system_prompt_set when we're
going to re-render.

- [ ] **Step 1: Add the failing test**

Add to `packages/agent/src/__tests__/session-fork.durable-history.test.ts`:

```typescript
describe('session/fork with changed cwd writes exactly one system_prompt_set event', () => {
  it('does NOT trigger the message-builder invariant-violation warn on rebuild', async () => {
    const warnSpy = vi
      .spyOn(logger, 'warn')
      .mockImplementation(() => undefined);
    try {
      // Create a source session, fork to a different cwd, then build the
      // forked session's messages (which scans events and would warn).
      // ... (adapt to existing fork test scaffolding) ...

      buildProviderMessagesFromDurableEvents(forkedSessionDir);

      // Assert: no "invariant violation" warns
      const violationWarns = warnSpy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes('invariant violation')
      );
      expect(violationWarns).toHaveLength(0);

      // Assert: exactly one system_prompt_set event in forked events.jsonl
      const events = readFileSync(
        join(forkedSessionDir, 'events.jsonl'),
        'utf8'
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string });
      const systemPromptEvents = events.filter(
        (e) => e.type === 'system_prompt_set'
      );
      expect(systemPromptEvents).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest --run src/__tests__/session-fork.durable-history.test.ts -t "exactly one system_prompt_set"
```

Expected: FAIL — current fork-cwd writes two.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/rpc/handlers/session.ts:586-631`, before the "copy source
events" loop, intercept system_prompt_set events when we know we'll re-render:

```typescript
const willRerenderSystemPrompt = forkedCwd !== sourceSession.meta.workDir;

const forkedEventsPath = join(forkedSessionDir, 'events.jsonl');
for (const event of sourceEvents) {
  // When we'll re-render the system prompt (cwd change), skip copying the
  // source's system_prompt_set event so the forked session ends up with
  // exactly one. Otherwise message-builder warns "invariant violation"
  // on every rebuild for a designed-in pattern.
  if (willRerenderSystemPrompt && event.type === 'system_prompt_set') continue;
  appendFileSync(forkedEventsPath, JSON.stringify(event) + '\n', {
    encoding: 'utf8',
  });
}

if (willRerenderSystemPrompt) {
  // ... existing re-render + appendDurableEvent logic ...
}
```

(Adapt to the surrounding code's style; the key change is the `continue` in the
loop.)

NOTE: dropping events.jsonl entries shifts `nextEventSeq` since the appended
re-render event gets the next seq from where the source's last event was. If you
`continue` on the source's system_prompt_set (which had seq=1), the next event
copied (seq=2) lands at position 0 in the new file but keeps eventSeq=2. That
should be fine for message-builder (it reads eventSeq from the event itself),
but verify by reading the existing fork's state-management to make sure nothing
breaks.

Alternative simpler approach if the above proves complex: drop the entire "copy
all events" + "append new system_prompt_set" pattern and instead rewrite the
events.jsonl from scratch: write the new system_prompt_set first (with
eventSeq=1), then copy all source events EXCEPT system_prompt_set with
renumbered eventSeqs starting from 2. The downside: renumbering means the forked
session's eventSeqs don't match the source. If anything depends on eventSeq
stability across forks, this breaks it.

Use the "continue and keep original seqs" approach unless something downstream
breaks. Test thoroughly.

- [ ] **Step 4: Run tests**

```
npx vitest --run src/__tests__/session-fork.durable-history.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/rpc/handlers/session.ts \
        packages/agent/src/__tests__/session-fork.durable-history.test.ts
git commit -m "fix(session-fork): cwd-change writes exactly one system_prompt_set

The fork-with-cwd-change path copied the source's system_prompt_set
then appended a fresh one — relying on message-builder's last-wins
semantics. But the builder also warns 'invariant violation' on every
rebuild for count > 1. Skip copying the source's system_prompt_set
when we'll re-render anyway; the forked session ends up with exactly
one, and the warn no longer fires.
"
```

---

### Task 6: Move runner's empty-systemPrompt throw BEFORE provider construction

**Files:**

- Modify: `packages/agent/src/core/conversation/runner.ts:179-217`
- Test: extend `packages/agent/src/core/conversation/__tests__/runner.test.ts`

**Why:** The runner constructs the provider at line 179 (`createProvider()`),
then throws at line 212 if `frozenSystemPrompt` is empty. The throw escapes
WITHOUT calling `provider.cleanup()` because the try/finally that cleans up
starts at line 241. Repeated throws (e.g. on a corrupt session) leak
EventEmitter listeners and HTTP sockets.

Fix: do the empty-check BEFORE constructing the provider.

- [ ] **Step 1: Add the failing test**

Add to `packages/agent/src/core/conversation/__tests__/runner.test.ts`:

```typescript
it('does not construct (or leak) a provider when systemPrompt is empty', async () => {
  // Spy on the createProvider dep; if it's called before the throw, that's
  // the bug — the provider gets allocated and never cleaned up.
  const createProviderSpy = vi.fn(async () => {
    throw new Error('createProvider should NOT have been called');
  });

  // Set up a session WITHOUT a system_prompt_set event
  const dir = mkdtempSync(join(tmpdir(), 'lace-runner-leak-'));
  writeFileSync(
    join(dir, 'events.jsonl'),
    JSON.stringify({
      eventSeq: 1,
      type: 'prompt',
      data: { type: 'prompt', content: [{ type: 'text', text: 'hi' }] },
    }) + '\n'
  );
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ nextEventSeq: 2, nextStreamSeq: 1 }));

  const config = /* ...minimal config... */;
  const deps = createMockDeps({ createProvider: createProviderSpy });
  const runner = new ConversationRunner(config, deps);

  // The runner should throw the "no system_prompt_set" error WITHOUT calling
  // createProvider, so the spy never fires.
  await expect(runner.run([])).rejects.toThrow(/no system_prompt_set/i);
  expect(createProviderSpy).not.toHaveBeenCalled();

  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest --run src/core/conversation/__tests__/runner.test.ts -t "leak"
```

Expected: FAIL — createProvider IS called before the throw.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/core/conversation/runner.ts`, move the build + check
BEFORE the provider construction. Currently roughly:

```typescript
    const provider = await this.deps.createProvider();  // line ~179
    const modelPricing = await this.deps.getModelPricing();
    // ...
    const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
      buildProviderMessagesFromDurableEvents(sessionDir);  // line ~205
    let providerMessages = rebuiltMessages;
    if (!frozenSystemPrompt) {
      throw new Error(...);  // line ~212
    }
    provider.setSystemPrompt(frozenSystemPrompt);
```

Restructure to:

```typescript
// Build + invariant check FIRST so we don't allocate a provider that
// then needs cleanup if the invariant fails. (provider.cleanup() is in
// the try/finally below; an early throw bypasses it.)
const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
  buildProviderMessagesFromDurableEvents(sessionDir);
if (!frozenSystemPrompt) {
  throw new Error(
    `Session ${sessionDir} has no system_prompt_set event; ` +
      `the session is corrupt or was created before the invariant was enforced.`
  );
}
let providerMessages = rebuiltMessages;

const provider = await this.deps.createProvider();
const modelPricing = await this.deps.getModelPricing();
// ...
provider.setSystemPrompt(frozenSystemPrompt);
```

Reorder carefully — read the surrounding 50 lines and preserve the other
initialization that happened between createProvider and the build. Move what
needs to move; keep the rest in place.

- [ ] **Step 4: Run tests**

```
npx vitest --run src/core/conversation/
```

Expected: PASS (new test + all existing).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts \
        packages/agent/src/core/conversation/__tests__/runner.test.ts
git commit -m "fix(runner): check empty systemPrompt BEFORE constructing provider

Round 2 Task 1 added a hard throw on empty frozenSystemPrompt, but
the check ran AFTER createProvider() and OUTSIDE the try/finally that
calls provider.cleanup(). Each throw leaked an EventEmitter listener
and HTTP socket on the AnthropicProvider. Move the build + check before
provider construction so the throw escapes without allocating anything.
"
```

---

### Task 7: Always persist `personaName` to session config

**Files:**

- Modify: `packages/agent/src/rpc/handlers/session.ts:392` (the conditional
  `...(requestedPersona ? {personaName: requestedPersona} : {})`)
- Test: extend `packages/agent/src/__tests__/system-prompt-injection.test.ts`
  (or wherever session-creation tests live)

**Why:** When the user creates a session without specifying `persona`, the
handler defaults to `'lace'` at render time but doesn't store it. `session/fork`
then falls back to `'lace'` at line 611 — works today, but the fork can't
faithfully replay "whatever the default was at create time." Always storing the
resolved persona means fork behavior is deterministic regardless of future
default changes.

- [ ] **Step 1: Add the failing test**

Add to `packages/agent/src/__tests__/system-prompt-injection.test.ts`:

```typescript
describe('session/new always persists personaName', () => {
  it('default-persona sessions have personaName=lace in config', async () => {
    // Create a session WITHOUT specifying persona.
    // Read the session's state.json.
    // Assert: config.personaName === 'lace'.

    const created = (await client.request('session/new', {
      cwd: laceDir,
      mcpServers: [],
    })) as { sessionId: string };

    const sessionDir = getSessionDir(created.sessionId);
    const state = JSON.parse(
      readFileSync(join(sessionDir, 'state.json'), 'utf8')
    ) as {
      config?: { personaName?: string };
    };

    expect(state.config?.personaName).toBe('lace');
  });
});
```

Adapt to existing test scaffolding.

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest --run src/__tests__/system-prompt-injection.test.ts -t "always persists personaName"
```

Expected: FAIL — current code omits personaName when requestedPersona is null.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/rpc/handlers/session.ts:392` (the conditional
config-write line), change:

```typescript
...(requestedPersona ? { personaName: requestedPersona } : {}),
```

to:

```typescript
personaName: requestedPersona ?? 'lace',
```

This unconditionally stores the resolved persona. Default-persona sessions now
have `personaName: 'lace'` explicit; user-specified sessions store their value.

- [ ] **Step 4: Run tests**

```
npx vitest --run src/__tests__/ src/rpc/
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/rpc/handlers/session.ts \
        packages/agent/src/__tests__/system-prompt-injection.test.ts
git commit -m "fix(session-new): always persist personaName (no conditional)

When the user didn't specify a persona, the session config omitted
personaName entirely. session/fork's fallback to 'lace' works today
but isn't faithful to 'whatever the default was at create time' if
the default ever changes. Always store the resolved name explicitly.
"
```

---

### Task 8: Delete `Session.create` library API

**Files:**

- Modify: `packages/agent/src/core/session.ts` — delete the broken library
  factory
- Modify: `packages/agent/src/index.ts` — drop the export
- Modify: `packages/agent/src/core/agent.ts` (if it exports a `createSession`
  wrapper) — drop that too
- Test: delete any test that exercises the broken API

**Why:** `Session.create()` doesn't write a `system_prompt_set` event, so any
caller that follows up with a runner call gets the Task 1 throw.
`Session.prompt()` is currently `throw new Error('not yet implemented')`. The
API is dormant AND broken. Per CLAUDE.md no-back-compat: delete it. If the
library API is needed later, design it with the system_prompt_set requirement
built in.

- [ ] **Step 1: Identify all references**

```
grep -rn "Session\\.create\\|createSession\\|new Session(" packages/agent/src packages/web 2>/dev/null
```

Note every site. There may be:

- The class definition in `core/session.ts`
- Re-exports in `index.ts` and possibly `server.ts`
- A wrapper in `core/agent.ts` (`Agent.createSession`)
- Tests that import it

- [ ] **Step 2: Delete the class and its dependencies**

In `packages/agent/src/core/session.ts`:

- Delete the `Session` class entirely (or just the `create` static method if
  other parts of the class are used elsewhere)
- Delete `Session.prompt()` if it's unimplemented anyway
- If the file becomes empty, delete it

In `packages/agent/src/index.ts`:

- Remove `export { Session, ... }` (and any related types)

In `packages/agent/src/core/agent.ts` (if applicable):

- Remove `Agent.createSession()` and any related Session import

Delete any tests that import `Session` directly (they're testing a now-deleted
API).

- [ ] **Step 3: Run all tests + tsc**

```
cd packages/agent && npx tsc --noEmit && npx vitest --run src/
```

Expected: TypeScript clean. All tests pass. If a test fails because it depended
on Session — delete it.

Also check `packages/web`:

```
cd ../web && npx tsc --noEmit
```

Expected: clean. If web imported Session, follow the same delete-or-update
pattern.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete Session.create library API (broken + dormant)

Session.create() created a session without writing a system_prompt_set
event, so any subsequent runner call would throw with the Round 2
hard-check. Session.prompt() was already an unimplemented stub. Per
pre-release no-back-compat: delete the broken API entirely. If/when
a library-level session API is wanted later, design it with the
system_prompt_set invariant built in from the start.
"
```

---

# Final Verification

### Task 9: Full test suite + tsc + lint + push to main

- [ ] From `packages/agent`:

  ```
  npx vitest --run src/providers src/storage src/core src/tools src/message-building src/config src/rpc src/__tests__ src/conversation src/compaction
  ```

  Expected: all green except the pre-existing
  `session-fork.durable-history.test.ts > defaults direct MCP override placement`
  failure.

- [ ] `npx tsc --noEmit` from `packages/agent` and `packages/web` — clean.

- [ ] `npx eslint --max-warnings 0` on touched files:

  ```
  npx eslint --max-warnings 0 \
    src/conversation/slash-commands.ts \
    src/core/conversation/runner.ts \
    src/rpc/handlers/session.ts \
    src/rpc/handlers/session-operations.ts \
    src/message-building/append-or-merge.ts \
    src/message-building/message-builder.ts
  ```

- [ ] From the worktree root, FF-push to main:
  ```
  git push origin cache-control-hardening-2026-05-23
  git push origin cache-control-hardening-2026-05-23:main
  ```
