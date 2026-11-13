// ABOUTME: Real SQLite checks for the bounded pending extraction queue.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { MemoryNotes } from '../notes';
import type { Source } from '../types';

function original(discovery: number): Source {
  const sessionId = 'sess_11111111-1111-4111-8111-111111111111';
  // Discover the originals in reverse event order so event sequence cannot determine priority.
  const eventSeq = 1000 - discovery;
  return {
    id: `event:${sessionId}:${eventSeq}`,
    version: 'v1',
    reference: { kind: 'event', sessionId, eventSeq, file: 'events.jsonl', offset: 0, bytes: 1 },
  };
}

it('returns at most 128 pending originals in newest discovery order', () => {
  const db = new Database(':memory:');
  try {
    const notes = new MemoryNotes(db);
    for (let discovery = 1; discovery <= 134; discovery++) notes.discover(original(discovery));
    notes.status(original(132), 'completed');
    notes.status(original(133), 'omitted', 'Source unavailable');

    const batch = notes.pending();
    expect(batch).toHaveLength(128);
    expect(batch[0]).toEqual(original(134));
    expect(batch.at(-1)).toEqual(original(5));
    expect(batch).not.toContainEqual(original(132));
    expect(batch).not.toContainEqual(original(133));
  } finally {
    db.close();
  }
});

it('retains pending priority and handled statuses across reopening the store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lace-pending-notes-'));
  const path = join(dir, 'memory.sqlite');
  let db = new Database(path);
  try {
    const notes = new MemoryNotes(db);
    for (let discovery = 1; discovery <= 130; discovery++) notes.discover(original(discovery));
    for (const source of notes.pending()) notes.status(source, 'completed');
    expect(notes.pending()).toEqual([original(2), original(1)]);

    notes.discover(original(131));
    const expected = [original(131), original(2), original(1)];
    expect(notes.pending()).toEqual(expected);

    db.close();
    db = new Database(path);
    expect(new MemoryNotes(db).pending()).toEqual(expected);
  } finally {
    if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
