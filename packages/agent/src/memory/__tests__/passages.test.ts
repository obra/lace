// ABOUTME: Real SQLite checks for passage nomination metadata and vector maintenance.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { MemoryNotes } from '../notes';
import { MemoryPassages } from '../passages';
import { MemorySources } from '../sources';
import type { MemoryEncoder } from '../encoder';
import type { Source } from '../types';

const original = {
  id: 'source',
  version: 'v1',
  reference: {
    kind: 'event',
    sessionId: 'sess_11111111-1111-4111-8111-111111111111',
    eventSeq: 1,
    file: '',
    offset: 0,
    bytes: 0,
  },
} satisfies Source;

function fixture(initialize = true, options?: Database.Options) {
  const db = new Database(':memory:', options);
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

it('seeks by generation on repeated maintenance passes over a fully current store', async () => {
  const statements: string[] = [];
  const { db, notes, passages } = fixture(true, {
    verbose(statement) {
      if (typeof statement === 'string') statements.push(statement);
    },
  });
  try {
    notes.discover(original);
    const insert = db.prepare('INSERT INTO memory_passages VALUES(?,?,?,?,?,?,?)');
    const vector = JSON.stringify(Array.from({ length: 768 }, () => 0.012345));
    for (let i = 0; i < 64; i++)
      insert.run(original.id, original.version, i, i + 1, 'body', 'current', vector);
    const encoder: MemoryEncoder = {
      generation: 'current',
      async encode() {
        throw new Error('Current passages must not be encoded again');
      },
    };
    for (let i = 0; i < 2; i++) {
      statements.length = 0;
      await passages.vectors(encoder, () => {});
      const selections = statements.filter(
        (sql) => sql.trimStart().startsWith('SELECT') && !sql.includes('sqlite_master')
      );
      const plans = selections.flatMap((sql) =>
        (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map(
          ({ detail }) => detail
        )
      );
      const passagePlans = plans.filter((detail) => !detail.includes('memory_sources'));
      expect(passagePlans.length).toBeGreaterThan(0);
      for (const detail of passagePlans) {
        expect(detail).toMatch(/^SEARCH .* USING (?:COVERING )?INDEX .* \(generation[=>]/);
      }
    }
  } finally {
    db.close();
  }
});

it('encodes missing and stale generations in bounded batches and rechecks passage admission', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lace-passage-vectors-'));
  const { db, notes, passages } = fixture();
  try {
    const file = join(dir, 'events.jsonl');
    const sessionId = original.reference.sessionId;
    const lines = [1, 2].map((eventSeq) =>
      JSON.stringify({ type: 'prompt', eventSeq, data: { content: 'retained' } })
    );
    writeFileSync(file, lines.join('\n'));
    const [source, withdrawn] = lines.map((line, i) => {
      const eventSeq = i + 1;
      const content = [
        {
          type: 'text',
          text: `Transcript event type=prompt; session=${sessionId}; seq=${eventSeq}\nretained`,
        },
      ];
      const source: Source = {
        id: `event:${sessionId}:${eventSeq}`,
        version: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
        reference: {
          kind: 'event',
          sessionId,
          eventSeq,
          file,
          offset: i === 0 ? 0 : Buffer.byteLength(lines[0]) + 1,
          bytes: Buffer.byteLength(line),
        },
      };
      notes.discover(source);
      return source;
    });

    const insert = db.prepare('INSERT INTO memory_passages VALUES(?,?,?,?,?,?,?)');
    insert.run(source.id, source.version, 0, 1, 'current', 'current', '[7]');
    insert.run(source.id, source.version, 1, 2, 'earlier', 'a-old', '[8]');
    insert.run(source.id, source.version, 2, 3, 'later', 'z-old', '[9]');
    insert.run(source.id, 'orphan', 0, 1, 'orphan', null, null);
    insert.run(withdrawn.id, withdrawn.version, 0, 1, 'withdrawn', null, null);
    for (let i = 3; i < 8; i++)
      insert.run(source.id, source.version, i, i + 1, `missing ${i}`, null, null);
    insert.run(source.id, source.version, 8, 9, 'about to change', null, null);

    const batches: string[][] = [];
    await passages.vectors(
      {
        generation: 'current',
        async encode(texts, kind) {
          expect(kind).toBe('document');
          batches.push(texts);
          if (texts.includes('withdrawn'))
            db.prepare('DELETE FROM memory_sources WHERE id=? AND version=?').run(
              withdrawn.id,
              withdrawn.version
            );
          if (texts.includes('about to change'))
            db.prepare(
              'UPDATE memory_passages SET text=? WHERE id=? AND version=? AND start=?'
            ).run('changed', source.id, source.version, 8);
          return texts.map((text) => [text.length]);
        },
      },
      () => {}
    );
    expect(Math.max(...batches.map((batch) => batch.length))).toBe(4);
    expect(batches.flat().sort()).toEqual([
      'about to change',
      'earlier',
      'later',
      'missing 3',
      'missing 4',
      'missing 5',
      'missing 6',
      'missing 7',
      'withdrawn',
    ]);
    expect(
      db.prepare('SELECT text, generation, vector FROM memory_passages ORDER BY rowid').all()
    ).toEqual([
      { text: 'current', generation: 'current', vector: '[7]' },
      { text: 'earlier', generation: 'current', vector: '[7]' },
      { text: 'later', generation: 'current', vector: '[5]' },
      { text: 'orphan', generation: null, vector: null },
      { text: 'withdrawn', generation: null, vector: null },
      { text: 'missing 3', generation: 'current', vector: '[9]' },
      { text: 'missing 4', generation: 'current', vector: '[9]' },
      { text: 'missing 5', generation: 'current', vector: '[9]' },
      { text: 'missing 6', generation: 'current', vector: '[9]' },
      { text: 'missing 7', generation: 'current', vector: '[9]' },
      { text: 'changed', generation: null, vector: null },
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
