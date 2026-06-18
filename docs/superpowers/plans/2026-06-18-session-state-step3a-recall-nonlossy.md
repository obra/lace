# Session-State Step 3.1 — `event_journal` Non-Lossy Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a durable `event_journal` table (one row per event, with the **verbatim**
JSONL line) to the existing recall SQLite DB, so `/recall` returns original event bytes
instead of today's lossy FTS-rendered rows (#22). This is the safest sub-step of Step 3:
purely additive, **never on a correctness path**, best-effort + backfill-repaired like
today's recall index.

**Architecture:** Extend `recall/index-db.ts` (better-sqlite3, WAL) with an
`event_journal` table written by a **dedicated unfiltered writer** (every event type,
not the `eventToRow` FTS filter), best-effort write-through in `appendDurableEvent`
alongside the existing FTS insert, and repaired by the existing startup backfill. Recall
returns `event_journal.line`.

**Tech Stack:** TypeScript, better-sqlite3, vitest. Per sen-core principle: real SQLite
in tests (tempdir), never mocked.

---

## Background (verified facts)

- Recall DB: `<getLaceDir()>/recall/index.sqlite`, better-sqlite3 `@^12.10.0`, WAL,
  opened via `getRecallIndex()` singleton (`packages/agent/src/storage/recall/index-db.ts`).
  Schema applied in `applySchema` (~line 116-145); `SCHEMA_VERSION = 2` (line 21).
- FTS table `events` (virtual, FTS5) is **lossy**: only 5 event types indexed
  (`prompt`/`message`/`tool_use`/`context_injected`/`context_compacted`), content
  rendered/sanitized, no `turnId`/`turnSeq`, no verbatim line. `eventToRow`
  (`event-to-row.ts`) returns `null` for all other types (the FTS filter — **must not**
  be reused for the journal).
- Write-through today: `appendDurableEvent` (`event-log.ts:~517-522`) does
  `const row = eventToRow(written, {sessionId, persona}); if (row) insertRow(getRecallIndex(), row);`
  best-effort (try/catch, non-fatal).
- Backfill: `backfillIndex` (`recall/backfill.ts`) scans JSONL on startup, per-session
  `db.transaction(...).immediate`, dedups by `event_id` (`session_id:event_seq`).
- `insertRow` (`recall/index-writer.ts`) wraps inserts in `BEGIN IMMEDIATE`.
- The recall query path (`recall.ts`) reads FTS rows and renders results — find where it
  returns content to the caller.

**Event id convention:** `event_id = "${sessionId}:${eventSeq}"` (used by FTS dedup).
Reuse it as the journal PK so backfill dedup is consistent.

**Test command:** `cd packages/agent && npx vitest run <path>`.

---

## File Structure

**Modify:**
- `packages/agent/src/storage/recall/index-db.ts` — add the `event_journal` table to
  `applySchema`; bump `SCHEMA_VERSION` to 3.
- `packages/agent/src/storage/recall/index-writer.ts` — add `insertJournalRow(db, row)`
  (unfiltered, every event, verbatim line), `BEGIN IMMEDIATE`, dedup by PK.
- `packages/agent/src/storage/event-log.ts` — in `appendDurableEvent`, write the journal
  row best-effort alongside the existing FTS insert (verbatim line = the exact string
  appended to JSONL).
- `packages/agent/src/storage/recall/backfill.ts` — also insert `event_journal` rows
  during the per-session backfill (every event, verbatim line).
- `packages/agent/src/storage/recall/recall.ts` (or wherever recall returns content) —
  return the verbatim event (parsed from `event_journal.line`) instead of the rendered
  FTS content.

**Create:**
- `packages/agent/src/storage/recall/__tests__/event-journal.test.ts`

---

## Task 1: `event_journal` schema + migration

**Files:** `index-db.ts`

- [ ] **Step 1: Write a failing test** (open a temp DB via the real open path, assert
  the table exists with the expected columns):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex } from '@lace/agent/storage/recall/index-db';

describe('event_journal schema', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lace-ej-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates event_journal with the verbatim-line column', () => {
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    const cols = db.handle.prepare(`PRAGMA table_info(event_journal)`).all() as { name: string }[];
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['event_seq', 'line', 'session_id', 'ts', 'type'].sort());
  });
});
```

> Confirm how to reach the raw better-sqlite3 handle from the `Db` wrapper (the test
> uses `db.handle` — match the real wrapper's field/getter; read `index-db.ts`).

- [ ] **Step 2: Run — RED.**

- [ ] **Step 3: Add the table to `applySchema` + bump `SCHEMA_VERSION` to 3.**

```sql
CREATE TABLE IF NOT EXISTS event_journal (
  session_id TEXT    NOT NULL,
  event_seq  INTEGER NOT NULL,
  type       TEXT    NOT NULL,
  ts         TEXT    NOT NULL,
  line       TEXT    NOT NULL,
  PRIMARY KEY (session_id, event_seq)
);
CREATE INDEX IF NOT EXISTS ej_session ON event_journal(session_id, event_seq);
```

> Match the existing migration mechanism: `applySchema` keys off `SCHEMA_VERSION` in
> `_meta`. Bumping to 3 must ADD the table on existing DBs without dropping the FTS
> `events` table or its data. Read how `applySchema` handles a version bump (does it
> `DROP`+recreate, or `CREATE IF NOT EXISTS`?). If it drops-and-rebuilds everything on a
> version bump, that's fine — the backfill repopulates both tables from JSONL; confirm
> that's the existing behavior and that it's acceptable (it triggers a one-time
> re-backfill on upgrade).

- [ ] **Step 4: Run — GREEN. Commit.**

```bash
git add packages/agent/src/storage/recall/index-db.ts packages/agent/src/storage/recall/__tests__/event-journal.test.ts
git commit -m "feat(session-state): event_journal table (verbatim-line recall store)"
```

---

## Task 2: Unfiltered journal writer

**Files:** `index-writer.ts`, `event-journal.test.ts`

- [ ] **Step 1: Failing test** — inserting a `turn_end` (which `eventToRow` drops)
  produces a journal row; double-insert is idempotent:

```ts
import { insertJournalRow } from '@lace/agent/storage/recall/index-writer';
// ... open db ...
it('journals EVERY event type incl. turn_end, idempotently', () => {
  const db = openRecallIndex(join(dir, 'index.sqlite'));
  const line = JSON.stringify({ eventSeq: 7, timestamp: 't', type: 'turn_end', data: { stopReason: 'end_turn' } });
  insertJournalRow(db, { session_id: 's1', event_seq: 7, type: 'turn_end', ts: 't', line });
  insertJournalRow(db, { session_id: 's1', event_seq: 7, type: 'turn_end', ts: 't', line }); // dup → no-op
  const rows = db.handle.prepare(`SELECT line FROM event_journal WHERE session_id='s1'`).all() as { line: string }[];
  expect(rows).toHaveLength(1);
  expect(rows[0].line).toBe(line);
});
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `insertJournalRow`** (mirror `insertRow`'s `BEGIN IMMEDIATE` +
  in-transaction guard; PK-dedup via `INSERT OR IGNORE`):

```ts
export type JournalRow = { session_id: string; event_seq: number; type: string; ts: string; line: string };

export function insertJournalRow(db: Db, row: JournalRow): void {
  if (db.inTransaction) { insertJournalRowInner(db, row); return; }
  db.exec('BEGIN IMMEDIATE');
  try { insertJournalRowInner(db, row); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}
function insertJournalRowInner(db: Db, row: JournalRow): void {
  db.handle.prepare(
    `INSERT OR IGNORE INTO event_journal (session_id, event_seq, type, ts, line) VALUES (?, ?, ?, ?, ?)`
  ).run(row.session_id, row.event_seq, row.type, row.ts, row.line);
}
```

> Match the real `Db` wrapper API (`db.inTransaction`, `db.exec`, `db.handle.prepare` —
> confirm against `index-writer.ts`/`index-db.ts`; if the wrapper exposes `prepare`
> directly, use that).

- [ ] **Step 4: GREEN. Commit.**

```bash
git add packages/agent/src/storage/recall/index-writer.ts packages/agent/src/storage/recall/__tests__/event-journal.test.ts
git commit -m "feat(session-state): unfiltered event_journal writer (every type, verbatim line)"
```

---

## Task 3: Write-through on append + backfill

**Files:** `event-log.ts`, `backfill.ts`, test

- [ ] **Step 1: Failing test** — after `appendDurableEvent`, the journal has the
  verbatim line for the appended event (incl. a `turn_end`). (Use the real append path
  against a temp laceDir; assert `event_journal` got the row.)

> Construct the test to drive `appendDurableEvent` for a `prompt` and a `turn_end`, then
> query `event_journal`. The verbatim `line` must equal the exact string written to the
> JSONL (`JSON.stringify(written)`).

- [ ] **Step 2: RED.**

- [ ] **Step 3: Wire write-through** in `appendDurableEvent`, right after the existing
  FTS `insertRow`, best-effort (its own try/catch — a journal failure must NEVER fail the
  append):

```ts
try {
  insertJournalRow(getRecallIndex(), {
    session_id: sessionId,
    event_seq: written.eventSeq,
    type: written.type,
    ts: written.timestamp,
    line: JSON.stringify(written),   // the EXACT bytes appended to JSONL
  });
} catch (err) {
  console.error('event_journal write failed:', err);
}
```

> The `line` must be byte-identical to what was appended to the JSONL. The append writes
> `${JSON.stringify(written)}\n` — store `JSON.stringify(written)` (without the newline)
> so replaying it through the parser matches a JSONL line read. Confirm the JSONL write
> expression and match it exactly.

- [ ] **Step 4: Extend backfill** (`backfill.ts`) to also `insertJournalRow` for every
  scanned event (every type, verbatim line = the raw JSONL line read), inside the same
  per-session `.immediate` transaction. The journal dedups by PK, so re-running backfill
  is safe.

> The backfill reads raw JSONL lines; store each raw line verbatim as `line`. Parse just
> enough (`eventSeq`, `type`, `timestamp`) for the columns. Confirm the backfill's
> existing per-session transaction and add the journal insert inside it.

- [ ] **Step 5: GREEN; run the full recall suite.**

Run: `cd packages/agent && npx vitest run src/storage/recall src/storage/event-log.test.ts && npx tsc --noEmit`
Expected: PASS (existing recall/backfill tests unaffected; the journal is additive).

- [ ] **Step 6: Commit.**

```bash
git add packages/agent/src/storage/event-log.ts packages/agent/src/storage/recall/backfill.ts packages/agent/src/storage/recall/__tests__/event-journal.test.ts
git commit -m "feat(session-state): write-through + backfill event_journal (verbatim, best-effort)"
```

---

## Task 4: Recall returns the verbatim event

**Files:** `recall.ts` (the recall query/return path), test

- [ ] **Step 1: Find the recall return path.** Read `recall.ts`: the FTS search finds
  matching `event_id`s; today it returns rendered/lossy content. Change the result
  assembly to fetch `event_journal.line` for each matched `event_id`
  (`session_id`+`event_seq`) and return the **parsed verbatim event** (full `data`, all
  fields), falling back to the FTS-rendered content only when the journal row is missing
  (older sessions mid-backfill).

- [ ] **Step 2: Failing test** — a recall hit returns the original event `data` (e.g. a
  `tool_use` with its full input/result), not the `tool=…\ninput=…` rendering.

- [ ] **Step 3: Implement; keep FTS for the SEARCH (matching), journal for the
  RETURNED content.** (FTS stays the index that answers "which events match the query";
  the journal supplies the verbatim payload for the matched events.)

- [ ] **Step 4: GREEN; full recall suite + typecheck + lint.**

- [ ] **Step 5: Commit + mark #22.**

```bash
git add packages/agent/src/storage/recall/recall.ts packages/agent/src/storage/recall/__tests__/event-journal.test.ts
git commit -m "feat(session-state): recall returns verbatim events from event_journal (closes #22 non-lossy)"
```

---

## Self-review notes (for the executor)

- **Zero correctness risk:** the journal is additive and best-effort; nothing in the
  hot path or seq assignment reads it. If a journal write fails, the append still
  succeeds and backfill repairs it. Do NOT let any journal failure throw out of
  `appendDurableEvent`.
- **Verbatim is the contract:** `line` must equal the exact JSONL bytes (so a future
  reader/reducer over `line` is byte-identical to reading the JSONL). The write-through
  stores `JSON.stringify(written)`; the backfill stores the raw line read.
- **Out of scope:** seq assignment, the flock/head file, the injects tail-read — those
  are Steps 3.2/3.3. This step touches only the recall index.
- **Confirm against source:** the `Db` wrapper API, `applySchema`'s version-bump
  behavior, the JSONL write expression, and the recall return path — do not invent them.
