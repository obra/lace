// ABOUTME: Tests for index-writer.ts — idempotent insert into the recall FTS5 index
// ABOUTME: Verifies first-write happens and duplicate event_id is a no-op

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex, type Db } from '../index-db';
import { insertRow } from '../index-writer';
import type { RecallRow } from '../event-to-row';

const ROW: RecallRow = {
  event_id: 'sess_x:1',
  session_id: 'sess_x',
  ts: '2026-05-23T00:00:00Z',
  persona: 'ada',
  kind: 'user_message',
  content: 'hello world',
};

describe('insertRow', () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recall-writer-'));
    db = openRecallIndex(join(dir, 'index.sqlite'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('inserts a new row', () => {
    insertRow(db, ROW);
    const rows = db
      .prepare(`SELECT event_id, session_id, persona, kind, content FROM events`)
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        event_id: 'sess_x:1',
        session_id: 'sess_x',
        persona: 'ada',
        kind: 'user_message',
        content: 'hello world',
      },
    ]);
  });

  it('is a no-op when event_id is already present (no duplicate, no throw)', () => {
    insertRow(db, ROW);
    insertRow(db, ROW);
    const count = (
      db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_id = ?`).get(ROW.event_id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('does not overwrite the original row when a duplicate event_id is offered', () => {
    insertRow(db, ROW);
    insertRow(db, { ...ROW, content: 'different content', persona: 'bea' });
    const row = db
      .prepare(`SELECT content, persona FROM events WHERE event_id = ?`)
      .get(ROW.event_id) as { content: string; persona: string };
    expect(row).toEqual({ content: 'hello world', persona: 'ada' });
  });

  it('handles null persona', () => {
    insertRow(db, { ...ROW, event_id: 'sess_x:2', persona: null });
    const row = db.prepare(`SELECT persona FROM events WHERE event_id = ?`).get('sess_x:2') as {
      persona: string | null;
    };
    expect(row.persona).toBeNull();
  });
});
