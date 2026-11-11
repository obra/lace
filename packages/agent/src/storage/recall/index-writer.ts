// ABOUTME: Insert recall rows into the FTS index; idempotent on event_id
// ABOUTME: Uses indexed identifiers to prevent duplicate FTS rows

import type { Db } from './index-db';
import type { RecallRow } from './event-to-row';
import { reconcileEventKeys, recordExaminedEventRowid } from './event-keys';

/**
 * Insert one row into the FTS index, no-op if `event_id` already present.
 *
 * BEGIN IMMEDIATE serializes reconciliation and duplicate checks across
 * processes sharing index.sqlite. Inside backfill's write transaction,
 * better-sqlite3 uses a savepoint so a caught row failure cannot leave FTS
 * and its derived identifiers out of sync.
 */
export function insertRow(db: Db, row: RecallRow): void {
  db.transaction(() => {
    reconcileEventKeys(db);
    const exists = db.prepare('SELECT 1 FROM event_keys WHERE event_id = ?').get(row.event_id);
    if (exists) return;

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content, track) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .safeIntegers()
      .run(row.event_id, row.session_id, row.ts, row.persona, row.kind, row.content, row.track);
    db.prepare('INSERT INTO event_keys (event_id, session_id) VALUES (?, ?)').run(
      row.event_id,
      row.session_id
    );
    recordExaminedEventRowid(db, lastInsertRowid);
  }).immediate();
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
 * (session_id, event_seq) primary key. Use the caller's transaction
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
