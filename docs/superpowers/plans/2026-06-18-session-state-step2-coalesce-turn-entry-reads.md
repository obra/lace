# Session-State Architecture — Step 2: Coalesce Turn-Entry Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the per-turn cost of reading the durable event log by reading and parsing it **once** at turn entry and deriving the three things the turn needs from that single parsed array — instead of three independent full reads, each re-parsing the whole log.

**Architecture:** Separate I/O from derivation. A new `readParsedSessionEvents(sessionDir)` reads the log and parses every line **once** into a sorted `ParsedSessionEvent[]`. Three existing turn-entry derivers (`buildProviderMessagesFromDurableEvents`, `deriveFilesReadFromDurableEvents`, `findLastTurnEndEventSeq`) gain pure `*FromParsedEvents` cores that operate on that array; their original I/O signatures stay for non-hot-path callers. A single `loadTurnEntryProjection(sessionDir, cwd)` does one read + the three pure derivations, and the runner calls it once. **No wire bytes, no durable format, no seq assignment changes** — purely where parsing happens.

**Tech Stack:** TypeScript, vitest 3.x, `@lace/agent`.

**Why this is safe and why now:** This is the spec's Step 2 ("buy time — make Ada usable"), restricted to the byte-safe subset. The dominant per-turn costs (the per-append `deriveNextEventSeqAcrossSessionFiles` scan and the per-iteration inject read) are deliberately **not** touched here — they require the durable index and cross-process seq authority of Step 3. Step 2 is the low-risk read-coalescing that also establishes the "parse once, derive many" shape the projection (Step 4) builds on.

---

## Background the implementer needs

**Read first:** `docs/design/session-state-architecture.md` (Step 2 and Invariant 2), `docs/architecture/prompt-cache-stability.md`.

**The three independent turn-entry reads today** (all in `packages/agent/src/core/conversation/runner.ts`, turn setup ~lines 410–490) — each calls `readAllSessionEventLines` and parses the whole log separately:

1. `buildProviderMessagesFromDurableEvents(sessionDir)` — `packages/agent/src/message-building/message-builder.ts:212`. Returns `{ messages: ProviderMessage[]; systemPrompt: string }` (type `BuiltProviderMessages`). Internally: `readAllSessionEventLines` (which itself parses every line to sort by `eventSeq`), then re-parses every line into `parsedEvents`, then a system-prompt pass and a fold pass. Called at `runner.ts:431`.
2. `deriveFilesReadFromDurableEvents(sessionDir, cwd)` — `packages/agent/src/message-building/files-from-events.ts:18` (confirm exact path/signature). Reads the log, scans `tool_use` events with a `file_read`/completed outcome, returns a `Set<string>` or `string[]` of file paths. Called at `runner.ts:413`.
3. `findLastTurnEndEventSeq(sessionDir)` — `packages/agent/src/storage/event-log.ts:365`. Reads the log, returns the `eventSeq` of the most recent `turn_end` (or `undefined`). Called at `runner.ts:490`.

**The reader:** `readAllSessionEventLines(sessionDir): string[]` — `packages/agent/src/storage/event-log.ts:102`. Reads legacy `events.jsonl` + the new-layout transcript shards, then **sorts the lines by parsing each line's `eventSeq`**. So every caller that then re-parses pays for two parses of the whole log.

**Durable event shape on disk** (one JSON object per line): at minimum `{ eventSeq: number, timestamp: string, type: string, turnId?, turnSeq?, data: object }`. The three derivers only need `eventSeq`, `type`, and `data`.

**Non-hot-path callers that must keep working unchanged:** `buildProviderMessagesFromDurableEvents` is also called from `packages/agent/src/rpc/handlers/session-operations.ts:185,205,211` (RPC handlers). Keep its `(sessionDir) => BuiltProviderMessages` signature intact (it will delegate to the new pure core).

**What is explicitly OUT of scope for Step 2** (do not touch — Step 3): `deriveNextEventSeqAcrossSessionFiles` (the per-append seq scan), `readImmediateInjectsSince` / `readDurableEvents` (the per-iteration inject read), `appendDurableEvent` seq assignment, `writeAndAdvance` state read/write, and `loadSession`'s repair. Reads/parsing/derivation only.

**Test command:** `cd packages/agent && npx vitest run <path>`. Typecheck/lint from repo root: `npm run typecheck && npm run lint`.

---

## File Structure

**Create:**
- `packages/agent/src/message-building/parsed-events.ts` — the `ParsedSessionEvent` type and `readParsedSessionEvents(sessionDir)` (read + parse + sort once). One responsibility: turn the durable log into a parsed, sorted event array.
- `packages/agent/src/message-building/turn-entry-projection.ts` — `loadTurnEntryProjection(sessionDir, cwd)`: one read, three pure derivations, returns the bundle the runner needs. The single hot-path entry.
- `packages/agent/src/message-building/__tests__/parsed-events.test.ts`
- `packages/agent/src/message-building/__tests__/turn-entry-projection.test.ts`

**Modify:**
- `packages/agent/src/message-building/message-builder.ts` — add `buildProviderMessagesFromParsedEvents(events)`; make `buildProviderMessagesFromDurableEvents(sessionDir)` delegate to it.
- `packages/agent/src/message-building/files-from-events.ts` — add `deriveFilesReadFromParsedEvents(events, cwd)`; make the I/O version delegate.
- `packages/agent/src/storage/event-log.ts` — add `findLastTurnEndSeqFromParsedEvents(events)`; make `findLastTurnEndEventSeq(sessionDir)` delegate.
- `packages/agent/src/core/conversation/runner.ts` — replace the three turn-entry calls (413, 431, 490) with one `loadTurnEntryProjection`.

---

## Task 1: `readParsedSessionEvents` — read + parse + sort once

**Files:**
- Create: `packages/agent/src/message-building/parsed-events.ts`
- Create: `packages/agent/src/message-building/__tests__/parsed-events.test.ts`
- Reference: `packages/agent/src/storage/event-log.ts:102` (`readAllSessionEventLines`) and `:194` (how it reads shards + legacy).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readParsedSessionEvents } from '@lace/agent/message-building/parsed-events';

describe('readParsedSessionEvents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-pe-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads, parses, and sorts events by eventSeq from the legacy log', () => {
    // Intentionally out of order on disk; a malformed line must be skipped.
    const lines = [
      JSON.stringify({ eventSeq: 2, timestamp: 't', type: 'message', data: { content: 'b' } }),
      'not json',
      JSON.stringify({ eventSeq: 1, timestamp: 't', type: 'prompt', data: { content: 'a' } }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const events = readParsedSessionEvents(dir);
    expect(events.map((e) => e.eventSeq)).toEqual([1, 2]);
    expect(events.map((e) => e.type)).toEqual(['prompt', 'message']);
    expect(events[0].data).toEqual({ content: 'a' });
  });

  it('returns [] for an empty/missing log', () => {
    expect(readParsedSessionEvents(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect RED** (`cd packages/agent && npx vitest run src/message-building/__tests__/parsed-events.test.ts`) — module not found.

- [ ] **Step 3: Implement**

The file read must cover the SAME files `readAllSessionEventLines` covers (legacy `events.jsonl` + new-layout shards). Reuse the existing file-listing helpers from `event-log.ts` rather than reimplementing shard discovery. Read `event-log.ts:102-148` and use the same `listTranscriptFiles(getLaceDir(), sessionId)` + legacy-path logic.

```ts
// ABOUTME: Reads the durable session event log and parses every line ONCE into a
// sorted ParsedSessionEvent[]. The turn-entry derivers (messages, files-read,
// last-turn-end) all fold over this single parse instead of each re-reading and
// re-parsing the whole log. I/O + parse only — no wire bytes, no seq assignment.

import { readAllSessionEventLines } from '@lace/agent/storage/event-log';

export type ParsedSessionEvent = {
  eventSeq: number;
  type: string;
  data: Record<string, unknown>;
};

export function readParsedSessionEvents(sessionDir: string): ParsedSessionEvent[] {
  const lines = readAllSessionEventLines(sessionDir); // already shard+legacy aware, sorted
  const events: ParsedSessionEvent[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const p = JSON.parse(line) as { eventSeq?: unknown; type?: unknown; data?: unknown };
      events.push({
        eventSeq: typeof p.eventSeq === 'number' ? p.eventSeq : 0,
        type: typeof p.type === 'string' ? p.type : '',
        data: typeof p.data === 'object' && p.data ? (p.data as Record<string, unknown>) : {},
      });
    } catch {
      // skip malformed
    }
  }
  return events;
}
```

> NOTE: `readAllSessionEventLines` already returns lines sorted by `eventSeq`, so this parses each line exactly once more (down from the 2× the hot path pays today: the sort-parse plus each deriver's own parse). A later refinement could expose the raw lines without the sort-parse, but that touches `readAllSessionEventLines`'s many callers — out of scope here. The win in this plan is collapsing **three** parses (one per deriver) into **one**.

- [ ] **Step 4: Run — expect GREEN.**

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/message-building/parsed-events.ts packages/agent/src/message-building/__tests__/parsed-events.test.ts
git commit -m "feat(session-state): readParsedSessionEvents — parse the durable log once"
```

---

## Task 2: Pure `*FromParsedEvents` derivers (with delegating I/O wrappers)

**Files:**
- Modify: `packages/agent/src/message-building/message-builder.ts`
- Modify: `packages/agent/src/message-building/files-from-events.ts`
- Modify: `packages/agent/src/storage/event-log.ts`
- Test: `packages/agent/src/message-building/__tests__/parsed-events.test.ts` (extend) or a new equivalence test file.

- [ ] **Step 1: Extract `buildProviderMessagesFromParsedEvents`**

In `message-builder.ts`, split the existing `buildProviderMessagesFromDurableEvents` so the pure logic takes the parsed array. Keep the public I/O signature delegating:

```ts
import { readParsedSessionEvents, type ParsedSessionEvent } from './parsed-events';

export function buildProviderMessagesFromParsedEvents(
  parsedEvents: ParsedSessionEvent[]
): BuiltProviderMessages {
  // ... the existing body AFTER `const lines = readAllSessionEventLines(...)` and
  // AFTER the local re-parse loop — i.e. use `parsedEvents` directly as the
  // `parsedEvents` the two passes already iterate. The system-prompt pass and the
  // fold pass are unchanged.
}

export function buildProviderMessagesFromDurableEvents(sessionDir: string): BuiltProviderMessages {
  return buildProviderMessagesFromParsedEvents(readParsedSessionEvents(sessionDir));
}
```

> The current function's local `ParsedEvent` type is `{ type: string; data: Record<string, unknown> }` — a structural subset of `ParsedSessionEvent`, so the existing two passes work unchanged on `ParsedSessionEvent[]`. Delete the now-redundant local read + re-parse loop.

- [ ] **Step 2: Extract `deriveFilesReadFromParsedEvents`**

In `files-from-events.ts`, do the same split:

```ts
import { readParsedSessionEvents, type ParsedSessionEvent } from './parsed-events';

export function deriveFilesReadFromParsedEvents(
  parsedEvents: ParsedSessionEvent[],
  cwd: string
): /* the existing return type — confirm Set<string> vs string[] */ {
  // existing scan body, iterating parsedEvents instead of re-reading+re-parsing
}

export function deriveFilesReadFromDurableEvents(sessionDir: string, cwd: string) {
  return deriveFilesReadFromParsedEvents(readParsedSessionEvents(sessionDir), cwd);
}
```

> Open `files-from-events.ts` and match the REAL signature/return type exactly. The scan currently reads each line and `JSON.parse`s — replace that with iterating `parsedEvents`.

- [ ] **Step 3: Extract `findLastTurnEndSeqFromParsedEvents`**

In `event-log.ts`:

```ts
export function findLastTurnEndSeqFromParsedEvents(
  parsedEvents: { eventSeq: number; type: string }[]
): number | undefined {
  let last: number | undefined;
  for (const e of parsedEvents) {
    if (e.type === 'turn_end') last = e.eventSeq; // events are sorted ascending
  }
  return last;
}

export function findLastTurnEndEventSeq(sessionDir: string): number | undefined {
  // keep its current behavior, but it MAY import readParsedSessionEvents to delegate.
  // If importing parsed-events into event-log.ts creates a cycle (parsed-events
  // imports readAllSessionEventLines FROM event-log.ts), DO NOT delegate here —
  // instead leave findLastTurnEndEventSeq's body as-is and only ADD the pure
  // function. The runner will use the pure function via loadTurnEntryProjection.
}
```

> **Cycle warning:** `parsed-events.ts` imports from `event-log.ts`. So `event-log.ts` importing `parsed-events.ts` would cycle. Resolve by NOT having `findLastTurnEndEventSeq` delegate — just add the pure `findLastTurnEndSeqFromParsedEvents` (no import needed; it takes an array). Confirm the existing `findLastTurnEndEventSeq` still works unchanged.

- [ ] **Step 4: Write equivalence tests**

For a fixture log written to a temp dir, assert each pure deriver fed `readParsedSessionEvents(dir)` equals the original I/O function on the same `dir`:

```ts
it('pure derivers equal their I/O counterparts on the same log', () => {
  // write a realistic events.jsonl: system_prompt_set, prompt, message(+thinking),
  // tool_use(file_read completed), tool_use(other), turn_end, prompt, turn_end
  // ...writeFileSync...
  const events = readParsedSessionEvents(dir);

  expect(JSON.stringify(buildProviderMessagesFromParsedEvents(events)))
    .toBe(JSON.stringify(buildProviderMessagesFromDurableEvents(dir)));
  expect([...deriveFilesReadFromParsedEvents(events, cwd)])
    .toEqual([...deriveFilesReadFromDurableEvents(dir, cwd)]);
  expect(findLastTurnEndSeqFromParsedEvents(events))
    .toBe(findLastTurnEndEventSeq(dir));
});
```

> Build the fixture with a `tool_use` whose `data` matches what `deriveFilesReadFromDurableEvents` scans for (a `file_read` kind / completed outcome with a path). Read `files-from-events.ts` for the exact event shape it keys on so the fixture exercises a non-empty files-read set.

- [ ] **Step 5: Run — expect GREEN; full message-building suite green**

Run: `cd packages/agent && npx vitest run src/message-building && npx tsc --noEmit`
Expected: PASS (existing message-builder tests unchanged; goldens unaffected — same outputs).

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/message-building/message-builder.ts packages/agent/src/message-building/files-from-events.ts packages/agent/src/storage/event-log.ts packages/agent/src/message-building/__tests__/parsed-events.test.ts
git commit -m "refactor(session-state): pure *FromParsedEvents derivers over one parse"
```

---

## Task 3: `loadTurnEntryProjection` — one read, three derivations

**Files:**
- Create: `packages/agent/src/message-building/turn-entry-projection.ts`
- Create: `packages/agent/src/message-building/__tests__/turn-entry-projection.test.ts`

- [ ] **Step 1: Write the failing test (incl. the read-count gate)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as parsedEvents from '@lace/agent/message-building/parsed-events';
import { loadTurnEntryProjection } from '@lace/agent/message-building/turn-entry-projection';
import { buildProviderMessagesFromDurableEvents } from '@lace/agent/message-building/message-builder';

describe('loadTurnEntryProjection', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lace-tep-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

  it('reads the log exactly once and returns all three derivations', () => {
    const lines = [
      JSON.stringify({ eventSeq: 1, timestamp: 't', type: 'system_prompt_set', data: { type: 'system_prompt_set', text: 'sys' } }),
      JSON.stringify({ eventSeq: 2, timestamp: 't', type: 'prompt', data: { content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ eventSeq: 3, timestamp: 't', type: 'message', data: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ eventSeq: 4, timestamp: 't', type: 'turn_end', data: { stopReason: 'end_turn' } }),
    ];
    writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n', 'utf8');

    const spy = vi.spyOn(parsedEvents, 'readParsedSessionEvents');
    const proj = loadTurnEntryProjection(dir, '/work');

    expect(spy).toHaveBeenCalledTimes(1); // the whole point: ONE read+parse
    expect(proj.systemPrompt).toBe('sys');
    expect(proj.lastTurnEndSeq).toBe(4);
    expect(Array.isArray(proj.filesRead) || proj.filesRead instanceof Set).toBe(true);
    // messages equivalence with the standalone builder:
    expect(JSON.stringify(proj.messages)).toBe(
      JSON.stringify(buildProviderMessagesFromDurableEvents(dir).messages)
    );
  });
});
```

> `vi.spyOn` on a module export requires `loadTurnEntryProjection` to call `readParsedSessionEvents` via the module namespace import (`import * as parsedEvents` then `parsedEvents.readParsedSessionEvents(...)`) OR the spy must target the right binding. Simplest: have `turn-entry-projection.ts` import the namespace and call `pe.readParsedSessionEvents`. Confirm the spy registers a call; if module-binding makes the spy not fire, count `fs.readFileSync` calls scoped to the session file instead.

- [ ] **Step 2: Run — expect RED.**

- [ ] **Step 3: Implement**

```ts
// ABOUTME: The single turn-entry projection load. Reads + parses the durable log
// ONCE and derives everything a turn needs to start: the provider message prefix +
// system prompt, the files-read set, and the last turn_end seq (the inject
// watermark). Replaces three independent full-log reads at runner turn entry.

import * as pe from './parsed-events';
import { buildProviderMessagesFromParsedEvents, type BuiltProviderMessages } from './message-builder';
import { deriveFilesReadFromParsedEvents } from './files-from-events';
import { findLastTurnEndSeqFromParsedEvents } from '@lace/agent/storage/event-log';

export type TurnEntryProjection = BuiltProviderMessages & {
  filesRead: /* match deriveFilesReadFromParsedEvents return type */;
  lastTurnEndSeq: number | undefined;
};

export function loadTurnEntryProjection(sessionDir: string, cwd: string): TurnEntryProjection {
  const events = pe.readParsedSessionEvents(sessionDir);
  const { messages, systemPrompt } = buildProviderMessagesFromParsedEvents(events);
  const filesRead = deriveFilesReadFromParsedEvents(events, cwd);
  const lastTurnEndSeq = findLastTurnEndSeqFromParsedEvents(events);
  return { messages, systemPrompt, filesRead, lastTurnEndSeq };
}
```

> Match `filesRead`'s real type (Set vs array) to `deriveFilesReadFromParsedEvents`. Confirm `BuiltProviderMessages` is exported from `message-builder.ts` (if not, export it).

- [ ] **Step 4: Run — expect GREEN; commit**

```bash
git add packages/agent/src/message-building/turn-entry-projection.ts packages/agent/src/message-building/__tests__/turn-entry-projection.test.ts
git commit -m "feat(session-state): loadTurnEntryProjection — one read, three derivations"
```

---

## Task 4: Wire into the runner + verify byte-safety

**Files:**
- Modify: `packages/agent/src/core/conversation/runner.ts` (turn setup ~410–490)

- [ ] **Step 1: Replace the three calls with one**

Read `runner.ts:410-495`. Today (approximately):
```ts
const filesRead = deriveFilesReadFromDurableEvents(sessionDir, runtimeBinding.toolRuntime.cwd); // ~413
// ...
const { messages: rebuiltMessages, systemPrompt: frozenSystemPrompt } =
  buildProviderMessagesFromDurableEvents(sessionDir); // ~431
// ...
let lastSeenEventSeq = findLastTurnEndEventSeq(sessionDir) ?? 0; // ~490
```
Replace with a single load near the top of turn setup (before the first use), preserving the exact downstream variable names and the `frozenSystemPrompt` empty-check that follows line 431:
```ts
const turnEntry = loadTurnEntryProjection(sessionDir, runtimeBinding.toolRuntime.cwd);
const filesRead = turnEntry.filesRead;
const rebuiltMessages = turnEntry.messages;
const frozenSystemPrompt = turnEntry.systemPrompt;
let providerMessages = rebuiltMessages;
let lastSeenEventSeq = turnEntry.lastTurnEndSeq ?? 0;
```
Keep the existing `if (!frozenSystemPrompt) throw ...` corruption guard. Remove the three now-unused imports if nothing else in the file uses them (check — `buildProviderMessagesFromDurableEvents` may be imported for other reasons; only remove if truly unused). Add the `loadTurnEntryProjection` import (top-level).

> Be careful about ORDER: `filesRead` was derived at ~413 (before the messages at ~431) and may be used between 413 and 431. Moving all three to one call at the top preserves every downstream use as long as the single load happens before the earliest use (line ~413). Verify nothing between the old 413 and 490 mutates the session log in a way that would change what the later reads saw — it does not (turn setup is read-only before the agentic loop starts).

- [ ] **Step 2: Verify the byte-safety gates are untouched**

Run the full sent==rebuilt / golden / cross-turn / reducer suites + the runner suite:
```bash
cd packages/agent && npx vitest run src/message-building src/providers/__tests__ src/core/conversation
```
Expected: PASS (the known `ollama-integration.test.ts` env failures excluded). The message output is identical (same parse, same derivers), so goldens and sent-vs-rebuilt are unaffected.

- [ ] **Step 3: typecheck + lint**

Run (repo root): `npm run typecheck && npm run lint` → clean.

- [ ] **Step 4: Document in the evergreen doc**

Add a short paragraph to `docs/architecture/prompt-cache-stability.md` (or the session-state architecture doc) — present-tense, no refs: that turn entry reads and parses the durable log once via `loadTurnEntryProjection`, deriving the message prefix, files-read, and last-turn-end watermark from that single parse, and that the per-append seq scan and the per-iteration inject read remain (addressed by the durable index). Keep it factual.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/core/conversation/runner.ts docs/architecture/prompt-cache-stability.md
git commit -m "perf(session-state): turn entry reads the durable log once (loadTurnEntryProjection)"
```

---

## Self-review notes (for the executor)

- **Byte-safety is the contract:** the message output of the new path must be identical to the old (it is — same parse, same derivers). The golden + sent-vs-rebuilt + cross-turn suites are the proof; they must stay green with zero golden changes.
- **The win is collapsing three turn-entry reads/parses into one.** It does NOT remove the per-append `deriveNextEventSeqAcrossSessionFiles` scan or the per-iteration inject read — those are Step 3 (the durable index), and touching them here would mean cross-process seq work that is explicitly deferred.
- **No invented details:** confirm `deriveFilesReadFromDurableEvents`'s real path/signature/return type, `BuiltProviderMessages` export, and the runner's exact turn-setup variable names and ordering before finalizing. The import-cycle note in Task 2 Step 3 is load-bearing — do not make `event-log.ts` import `parsed-events.ts`.
- **Out of scope:** seq assignment, injects, state read/write, loadSession, compaction.
