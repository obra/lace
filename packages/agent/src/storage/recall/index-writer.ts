// ABOUTME: Insert recall rows into the FTS index; idempotent on event_id
// ABOUTME: FTS5 cannot enforce UNIQUE so we check existence before inserting

import type { Db } from './index-db';
import type { RecallRow } from './event-to-row';

export function insertRow(db: Db, row: RecallRow): void {
  const exists = db.prepare(`SELECT 1 FROM events WHERE event_id = ? LIMIT 1`).get(row.event_id);
  if (exists) return;
  db.prepare(
    `INSERT INTO events (event_id, session_id, ts, persona, kind, content) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.event_id, row.session_id, row.ts, row.persona, row.kind, row.content);
}
