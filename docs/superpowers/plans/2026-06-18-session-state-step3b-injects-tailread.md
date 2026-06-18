# Session-State Step 3.2 — Injects Byte-Offset Tail-Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the per-loop-iteration **full-log scan** for immediate injects with an
incremental **byte-offset tail-read** of the JSONL shards — reading only newly-appended
bytes. This removes the second per-turn bottleneck and, crucially, **keeps reading the
source of truth** (the JSONL), so a cross-process inject is seen the instant its line
lands — never lagged by a derived index.

**Architecture:** A stateful `InjectTailer` holds, per shard file, the byte offset read
so far (advanced only to the last complete newline, so a concurrently-appended partial
line is never mis-parsed). Each `readNew()` reads `[offset, EOF)` of each shard, parses
complete lines, filters `context_injected` events with `priority='immediate'` and
`eventSeq > watermark`, returns their texts, and advances offsets + watermark. The runner
creates one tailer per turn and calls it where it calls `readImmediateInjectsSince` today.

**Tech Stack:** TypeScript, vitest, `node:fs`.

**Why safe:** reads the JSONL (truth), append-only ⇒ new content is always at the end ⇒
no lag, no missed cross-process inject. The only hazard is a partial trailing line, which
the last-newline offset rule rules out.

---

## Background (verified facts — confirm against source before finalizing)

- Today: `readImmediateInjectsSince(sessionDir, afterEventSeq): { injections: string[];
  newWatermark: number }` (`packages/agent/src/core/conversation/runner.ts:~321-340`).
  It calls `readDurableEvents(sessionDir, { afterEventSeq, limit: MAX_SAFE_INTEGER })`
  → `readAllSessionEventLines` (a **full read of all shards**, parsed + sorted), then
  filters `type==='context_injected'` AND `data.priority==='immediate'`, extracting text
  via `extractInjectedText(data.content)`. Returns texts + the max seq seen.
- Called **per loop iteration** at `runner.ts:~546` with `lastSeenEventSeq`; the runner
  threads the returned `newWatermark` back into `lastSeenEventSeq`.
- Shards: `<laceDir>/transcripts/<persona>/<YYYY-MM-DD>/<sessionId>.jsonl` plus the legacy
  `<sessionDir>/events.jsonl`. `listTranscriptFiles(laceDir, sessionId)`
  (`storage/transcript-paths.ts`) enumerates the new-layout shards; legacy path via the
  existing helper in `event-log.ts`. (Reuse the SAME file set `readAllSessionEventLines`
  reads — do not reinvent shard discovery.)
- The append writes `${JSON.stringify(written)}\n` and has a newline-guard that prepends
  `\n` if a prior write lacked one — so the file is `\n`-delimited.
- `extractInjectedText` and the `priority==='immediate'` filter — reuse the EXACT existing
  predicates so behavior is identical.

**Test command:** `cd packages/agent && npx vitest run <path>`.

---

## File Structure

**Create:**
- `packages/agent/src/storage/inject-tailer.ts` — `InjectTailer` class / factory + the
  partial-line-safe per-shard offset reader.
- `packages/agent/src/storage/__tests__/inject-tailer.test.ts`

**Modify:**
- `packages/agent/src/core/conversation/runner.ts` — create one `InjectTailer` per turn
  (at turn setup, seeded so it only surfaces injects after the turn-entry watermark) and
  call `tailer.readNew()` where `readImmediateInjectsSince` is called today.

---

## Task 1: The partial-line-safe shard offset reader

**Files:** `inject-tailer.ts`, test

- [ ] **Step 1: Failing test — reads only complete new lines, holds back a partial tail.**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNewCompleteLines } from '@lace/agent/storage/inject-tailer';

describe('readNewCompleteLines', () => {
  let f: string;
  beforeEach(() => { f = join(mkdtempSync(join(tmpdir(), 'lace-tail-')), 'events.jsonl'); });
  afterEach(() => rmSync(f, { recursive: true, force: true }));

  it('returns only newline-terminated lines and advances the offset past them', () => {
    writeFileSync(f, 'a\nb\n', 'utf8');
    const r1 = readNewCompleteLines(f, 0);
    expect(r1.lines).toEqual(['a', 'b']);
    expect(r1.offset).toBe(4);

    // A partial line (no trailing newline yet) is NOT returned and does not advance.
    appendFileSync(f, 'c', 'utf8');
    const r2 = readNewCompleteLines(f, r1.offset);
    expect(r2.lines).toEqual([]);
    expect(r2.offset).toBe(r1.offset); // held back

    // Once the partial line completes, it is returned exactly once.
    appendFileSync(f, '\nd\n', 'utf8');
    const r3 = readNewCompleteLines(f, r2.offset);
    expect(r3.lines).toEqual(['c', 'd']);
    expect(r3.offset).toBe(8);
  });

  it('returns {lines:[], offset} for a missing file', () => {
    expect(readNewCompleteLines(join(f, 'nope'), 0)).toEqual({ lines: [], offset: 0 });
  });
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `readNewCompleteLines(file, offset)`** — read `[offset, EOF)`,
  find the last `\n`, return complete lines, advance offset only to just past the last
  `\n` (the trailing partial stays unread):

```ts
// ABOUTME: Incremental, partial-line-safe tail reader for the durable JSONL shards.
// Reads only the bytes appended since a given offset and returns only newline-
// terminated lines, so a concurrently-appended (cross-process) partial line is never
// mis-parsed. Backs the injects tail-read: it reads the source of truth (the JSONL),
// so it never lags a derived index.
import * as fs from 'node:fs';

export function readNewCompleteLines(file: string, offset: number): { lines: string[]; offset: number } {
  let fd: number;
  try { fd = fs.openSync(file, 'r'); } catch { return { lines: [], offset }; }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= offset) return { lines: [], offset }; // nothing new (or truncated — see note)
    const len = size - offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { lines: [], offset }; // no complete line yet; hold back
    const complete = text.slice(0, lastNl); // excludes the trailing partial (if any)
    const lines = complete.split('\n').filter((l) => l.length > 0);
    return { lines, offset: offset + Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}
```

> **Note (truncation):** if `size < offset` (the file shrank — shouldn't happen for an
> append-only log, but be defensive), reset to read from 0. Decide and implement: the
> safest is to treat `size < offset` as "re-read from 0" so a rotated/replaced file is
> not silently skipped; document the choice. Use BYTE offsets (`Buffer.byteLength`) not
> char offsets, since multibyte UTF-8 makes char ≠ byte.

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/inject-tailer.ts packages/agent/src/storage/__tests__/inject-tailer.test.ts
git commit -m "feat(session-state): partial-line-safe JSONL tail reader"
```

---

## Task 2: `InjectTailer` over all shards (incl. new-shard rotation)

**Files:** `inject-tailer.ts`, test

- [ ] **Step 1: Failing test** — a tailer surfaces an immediate inject appended after
  creation, across the SAME shard and a NEW shard, exactly once, with the right
  watermark; non-immediate injects and non-inject events are ignored.

```ts
import { createInjectTailer } from '@lace/agent/storage/inject-tailer';
// Build a fake laceDir with transcript shards; confirm the real shard layout helpers.
it('surfaces only new immediate injects, across shards, once', () => {
  // ... write an initial shard with some events (seq up to 5) ...
  const tailer = createInjectTailer(laceDir, sessionId, /*afterEventSeq*/ 5);
  // append an immediate inject (seq 6) + a non-immediate inject (seq 7) + a tool_use (seq 8)
  const a = tailer.readNew();
  expect(a.injections).toEqual(['<the immediate inject text>']);
  // a second call with nothing new returns []
  expect(tailer.readNew().injections).toEqual([]);
  // a NEW shard (next day) with an immediate inject (seq 9) is picked up
  // ... write the new-date shard ...
  expect(tailer.readNew().injections).toEqual(['<seq9 inject text>']);
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `createInjectTailer(laceDir, sessionId, afterEventSeq)`** —
  holds a `Map<filePath, offset>` and a `watermark = afterEventSeq`. `readNew()`:
  enumerate the current shard file set (the SAME set `readAllSessionEventLines` uses:
  legacy + `listTranscriptFiles`); for each file, `readNewCompleteLines(file, offset)`,
  parse each line, and for events with `type==='context_injected'`,
  `data.priority==='immediate'`, and `eventSeq > watermark`, collect
  `extractInjectedText(data.content)` (reuse the existing helper) and raise the
  watermark; update the offset map. A **new** shard file not in the map starts at offset
  0. Return `{ injections, newWatermark }`.

> Reuse `extractInjectedText` and the exact predicates from the current
> `readImmediateInjectsSince` so behavior is identical. The watermark filter
> (`eventSeq > watermark`) is what dedups across shards and makes re-reads idempotent —
> keep it even though offsets already prevent re-reading bytes (belt-and-suspenders, and
> it handles a brand-new shard whose early events are ≤ watermark).

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/inject-tailer.ts packages/agent/src/storage/__tests__/inject-tailer.test.ts
git commit -m "feat(session-state): InjectTailer — incremental immediate-inject reader across shards"
```

---

## Task 3: Differential test vs the full-scan + wire into the runner

**Files:** `inject-tailer.test.ts`, `runner.ts`

- [ ] **Step 1: Differential test** — for a corpus of shard states (incl. a cross-process
  inject appended between two `readNew()` calls, a cross-date shard, interleaved
  tool_use/turn events, a non-immediate inject), assert the union of `tailer.readNew()`
  results over the sequence equals what the OLD `readImmediateInjectsSince` would return
  for the same watermark. (Import the old function; it still exists.)

> This pins behavioral equivalence: the tail-read returns exactly the injects the full
> scan would, in order, with no misses and no dups.

- [ ] **Step 2: RED/GREEN as you build the test** (it should pass once Task 2 is correct;
  if it reveals a discrepancy, fix the tailer — the full scan is the oracle).

- [ ] **Step 3: Wire into the runner.** At turn setup, create one tailer seeded with the
  turn-entry watermark (`lastSeenEventSeq` from `loadTurnEntryProjection`):
  `const injectTailer = createInjectTailer(getLaceDir(), sessionId, lastSeenEventSeq);`
  Replace the per-iteration `readImmediateInjectsSince(sessionDir, lastSeenEventSeq)` call
  (~runner.ts:546) with `const { injections, newWatermark } = injectTailer.readNew();`
  and keep threading `lastSeenEventSeq = newWatermark`. Leave the injection-application
  logic (how injections become messages) unchanged.

> Confirm `sessionId`/`getLaceDir()` are in scope at the call site (sessionId =
> `path.basename(sessionDir)`). The tailer is per-turn (recreated each turn), so offsets
> reset each turn — correct, because each turn re-seeds from the turn-entry watermark.

- [ ] **Step 4: Verify — full runner + storage suites green, byte gates untouched.**

Run: `cd packages/agent && npx vitest run src/core/conversation src/storage src/providers/__tests__/golden && npx tsc --noEmit`
Expected: PASS (the env-only `ollama-integration` excluded). Injects behave identically;
no golden/sent-vs-rebuilt change (this is a read-path change only).

- [ ] **Step 5: Commit.**

```bash
git add packages/agent/src/storage/inject-tailer.ts packages/agent/src/storage/__tests__/inject-tailer.test.ts packages/agent/src/core/conversation/runner.ts
git commit -m "perf(session-state): runner reads immediate injects via incremental tail-read (no per-iteration full scan)"
```

---

## Self-review notes (for the executor)

- **Reads the truth, never an index:** the tailer reads the JSONL shards directly, so a
  cross-process inject is seen as soon as its line lands. Do NOT route this through the
  `event_journal` (it lags — that was the rejected rev1 design).
- **Partial-line safety is load-bearing:** advance the offset only to the last complete
  `\n`. A concurrently-appended partial line must be held back and read next time, never
  parsed partially.
- **Behavioral equivalence is the gate:** the differential test (Task 3 Step 1) proves
  the tail-read returns exactly what the full scan returned. If it ever diverges, the
  full scan is the oracle — fix the tailer.
- **Out of scope:** seq assignment / the flock + head file (Step 3.3); the `event_journal`
  (Step 3.1, done). This step changes only the inject read path.
- **Confirm against source:** the exact shard file set, `extractInjectedText`, the
  `priority==='immediate'` predicate, and the runner call site + in-scope variables.
