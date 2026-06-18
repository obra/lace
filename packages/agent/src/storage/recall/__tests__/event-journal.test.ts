// ABOUTME: Tests for the event_journal store — verbatim-line recall over real SQLite
// ABOUTME: Covers schema, unfiltered writer, write-through on append, backfill, and recall return

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex } from '../index-db';

describe('event_journal schema', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lace-ej-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates event_journal with the verbatim-line column', () => {
    const db = openRecallIndex(join(dir, 'index.sqlite'));
    try {
      const cols = db.prepare(`PRAGMA table_info(event_journal)`).all() as { name: string }[];
      const names = cols.map((c) => c.name).sort();
      expect(names).toEqual(['event_seq', 'line', 'session_id', 'ts', 'type'].sort());
    } finally {
      db.close();
    }
  });
});
