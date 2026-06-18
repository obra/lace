// ABOUTME: Insert recall rows into the FTS index; idempotent on event_id
// ABOUTME: FTS5 cannot enforce UNIQUE so we check existence before inserting

import type { Db } from './index-db';
import type { RecallRow } from './event-to-row';

/**
 * Insert one row into the FTS index, no-op if `event_id` already present.
 *
 * Serialization across processes: subagent containers share LACE_DIR and
 * write to the same index.sqlite. The SELECT-then-INSERT check is racy under
 * concurrent writers — both connections can pass the existence check and
 * both INSERT, producing duplicate FTS rows (FTS5 can't enforce UNIQUE so we
 * have no fallback). We acquire SQLite's write lock upfront with
 * `BEGIN IMMEDIATE`, which serializes check-then-insert across processes.
 * `busy_timeout` (set in index-db.ts) handles the wait for the lock.
 *
 * If the caller is already inside a transaction (e.g. backfill batches
 * inserts under its own IMMEDIATE transaction for atomicity), we skip the
 * BEGIN/COMMIT here — the caller's transaction provides serialization.
 * Nesting a `BEGIN IMMEDIATE` inside another transaction is an error in
 * SQLite.
 */
export function insertRow(db: Db, row: RecallRow): void {
  if (db.inTransaction) {
    insertRowInner(db, row);
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    insertRowInner(db, row);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function insertRowInner(db: Db, row: RecallRow): void {
  const exists = db.prepare(`SELECT 1 FROM events WHERE event_id = ? LIMIT 1`).get(row.event_id);
  if (exists) return;
  db.prepare(
    `INSERT INTO events (event_id, session_id, ts, persona, kind, content, track) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.event_id, row.session_id, row.ts, row.persona, row.kind, row.content, row.track);
}

/**
 * One row for the verbatim-line journal: every event type (NOT the FTS
 * `eventToRow` filter), `line` is the exact JSONL bytes for the event.
 */
export type JournalRow = {
  session_id: string;
  event_seq: number;
  type: string;
  ts: string;
  line: string;
};

/**
 * Insert one event into the verbatim `event_journal`, idempotent on the
 * (session_id, event_seq) primary key. Mirrors insertRow's transaction
 * discipline: skip BEGIN/COMMIT when the caller already holds a transaction
 * (the backfill batches per-session under its own IMMEDIATE transaction), else
 * acquire the write lock upfront with BEGIN IMMEDIATE so the dedup is
 * serialized across the processes that share index.sqlite. The PK makes the
 * dedup atomic via INSERT OR IGNORE — no separate existence check needed.
 */
export function insertJournalRow(db: Db, row: JournalRow): void {
  if (db.inTransaction) {
    insertJournalRowInner(db, row);
    return;
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    insertJournalRowInner(db, row);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function insertJournalRowInner(db: Db, row: JournalRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO event_journal (session_id, event_seq, type, ts, line) VALUES (?, ?, ?, ?, ?)`
  ).run(row.session_id, row.event_seq, row.type, row.ts, row.line);
}
