// ABOUTME: Tests for index-db.ts — SQLite FTS5 opener for the recall index
// ABOUTME: Verifies schema creation, idempotency, and FTS round-trip on real SQLite

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex } from '../index-db';

describe('openRecallIndex', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('creates the events FTS5 table on first open', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain('events');
    } finally {
      db.close();
    }
  });

  it('creates the parent directory if missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const dbPath = join(dir, 'nested', 'subdir', 'index.sqlite');
    const db = openRecallIndex(dbPath);
    try {
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('is idempotent on re-open (no throw, no duplicate table)', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const dbPath = join(dir, 'index.sqlite');
    openRecallIndex(dbPath).close();
    const db = openRecallIndex(dbPath);
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('uses WAL journal mode', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const mode = db.pragma('journal_mode', { simple: true });
      expect(mode).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('roundtrips a row through FTS (insert + MATCH returns expected row)', () => {
    dir = mkdtempSync(join(tmpdir(), 'recall-idx-'));
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      db.prepare(
        `INSERT INTO events (event_id, session_id, ts, persona, kind, content) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('sess_x:1', 'sess_x', '2026-05-23T00:00:00Z', 'ada', 'user_message', 'hello world');
      const rows = db
        .prepare(`SELECT event_id FROM events WHERE content MATCH 'hello'`)
        .all() as Array<{ event_id: string }>;
      expect(rows).toEqual([{ event_id: 'sess_x:1' }]);
    } finally {
      db.close();
    }
  });
});
