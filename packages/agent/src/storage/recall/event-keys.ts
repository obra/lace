// ABOUTME: Maintains indexed transcript identifiers derived from the recall FTS table
// ABOUTME: Reconciles rows appended by writers that only update FTS

import type { Db } from './index-db';

const LAST_ROWID_KEY = 'events_last_rowid';

export const EVENT_KEYS_SCHEMA = `
CREATE TABLE IF NOT EXISTS event_keys (
  event_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_keys_session ON event_keys(session_id);
`;

export function resetEventKeys(db: Db): void {
  db.exec('DELETE FROM event_keys');
  db.prepare('DELETE FROM _meta WHERE key = ?').run(LAST_ROWID_KEY);
}

export function recordExaminedEventRowid(db: Db, rowid: number | bigint): void {
  db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(
    LAST_ROWID_KEY,
    String(rowid)
  );
}

/** Call under the write lock so the FTS tail and its marker advance together. */
export function reconcileEventKeys(db: Db): void {
  const marker = db.prepare('SELECT value FROM _meta WHERE key = ?').pluck().get(LAST_ROWID_KEY) as
    | string
    | undefined;
  const lastExamined = BigInt(marker ?? '0');
  const lastRowid = db
    .prepare('SELECT rowid FROM events ORDER BY rowid DESC LIMIT 1')
    .pluck()
    .safeIntegers()
    .get() as bigint | undefined;
  if (lastRowid === undefined || lastRowid <= lastExamined) return;

  // Keep existing duplicate FTS rows while recording their identifier once.
  db.prepare(
    `INSERT OR IGNORE INTO event_keys (event_id, session_id)
     SELECT event_id, session_id FROM events WHERE rowid > ?`
  ).run(lastExamined);
  recordExaminedEventRowid(db, lastRowid);
}
