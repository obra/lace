// ABOUTME: Real SQLite checks for bounded passage nomination metadata lookups.
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { MemoryNotes } from '../notes';
import { MemoryPassages } from '../passages';
import { MemorySources } from '../sources';
import type { Source } from '../types';

const original: Source = {
  id: 'source',
  version: 'v1',
  reference: { kind: 'event', sessionId: 'sess_11111111-1111-4111-8111-111111111111', eventSeq: 1 },
};

function fixture(initialize = true) {
  const db = new Database(':memory:');
  const notes = new MemoryNotes(db);
  const sources = new MemorySources(notes, {
    databasePath: ':memory:',
    binding: {
      instanceId: 'instance',
      ownerGeneration: 'owner',
      role: 'root',
      actorId: 'host',
      producerId: 'persona:root',
      isRoot: true,
      canRead: true,
      canMutate: true,
      collections: [],
      writableCollections: [],
    },
  });
  return { db, notes, passages: new MemoryPassages(notes, sources, initialize) };
}

it('resolves the full admitted passage identity and observes replacement metadata without decoding vectors', () => {
  const { db, notes, passages } = fixture();
  try {
    notes.discover(original);
    const insert = db.prepare('INSERT OR REPLACE INTO memory_passages VALUES(?,?,?,?,?,?,?)');
    insert.run(original.id, original.version, 0, 5, 'first', 'old', 'not JSON');
    const identity = {
      kind: 'passage',
      sourceId: original.id,
      version: original.version,
      start: 0,
      end: 5,
    } as const;
    expect(passages.candidate(identity)).toEqual({
      source: original,
      start: 0,
      end: 5,
      text: 'first',
      rowid: 1,
      generation: 'old',
      hasVector: true,
    });
    db.prepare('UPDATE memory_passages SET generation=?, vector=?').run('new', 'still not JSON');
    expect(passages.candidate(identity)).toMatchObject({ generation: 'new', hasVector: true });
    insert.run(original.id, original.version, 0, 9, 'replaced', null, null);
    expect(passages.candidate(identity)).toBeUndefined();
    expect(passages.candidate({ ...identity, end: 9 })).toMatchObject({
      text: 'replaced',
      generation: null,
      hasVector: false,
    });
    db.prepare('DELETE FROM memory_sources WHERE id=? AND version=?').run(
      original.id,
      original.version
    );
    expect(passages.candidate({ ...identity, end: 9 })).toBeUndefined();
  } finally {
    db.close();
  }
});

it('pages an admitted source across versions by rowid and narrows an explicit version', () => {
  const { db, notes, passages } = fixture();
  try {
    notes.discover(original);
    notes.discover({ ...original, version: 'v2' });
    notes.discover({ ...original, id: 'different-source' });
    const insert = db.prepare('INSERT INTO memory_passages VALUES(?,?,?,?,?,?,?)');
    db.transaction(() => {
      insert.run(original.id, 'orphan', 0, 1, 'orphan', null, null);
      insert.run('different-source', 'v1', 0, 1, 'unrelated', null, null);
      for (let i = 0; i < 131; i++)
        insert.run(original.id, i % 2 === 0 ? 'v1' : 'v2', i, i + 1, 'body', 'gen', 'not JSON');
    })();
    const first = passages.sourcePage(original.id, undefined, 0);
    const second = passages.sourcePage(original.id, undefined, first.at(-1)!.rowid);
    expect([first.length, second.length]).toEqual([128, 3]);
    expect([...first, ...second].map(({ rowid }) => rowid)).toEqual(
      Array.from({ length: 131 }, (_, i) => i + 3)
    );
    expect(first.map(({ source }) => source.version).slice(0, 3)).toEqual(['v1', 'v2', 'v1']);
    expect(passages.sourcePage(original.id, undefined, second.at(-1)!.rowid)).toEqual([]);
    expect(passages.sourcePage(original.id, 'v2', 0).map(({ start }) => start)).toEqual(
      Array.from({ length: 65 }, (_, i) => i * 2 + 1)
    );
  } finally {
    db.close();
  }
});

it('returns no nomination candidates for a store without a passage table', () => {
  const { db, passages } = fixture(false);
  try {
    expect(
      passages.candidate({
        kind: 'passage',
        sourceId: original.id,
        version: original.version,
        start: 0,
        end: 1,
      })
    ).toBeUndefined();
    expect(passages.sourcePage(original.id, undefined, 0)).toEqual([]);
  } finally {
    db.close();
  }
});
