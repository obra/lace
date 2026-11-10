// ABOUTME: Publishes a durable SQLite outbox to the owned derived memory search collection.
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { assertMemoryAccess, MemoryAccessDenied } from './authority';
import type { MemoryNotes } from './notes';
import type { MemorySearchIdentity, MemorySearchIndex, MemorySearchPoint } from './search-index';

const PAGE_SIZE = 128;
const activeGeneration = '(SELECT generation FROM memory_search_state WHERE singleton=1)';

function passageIdentity(row: string, from = '') {
  return `SELECT json_array('passage',${row}.id,${row}.version,${row}.start,${row}.end)
    ${from} WHERE ${row}.generation=${activeGeneration} AND ${row}.vector IS NOT NULL`;
}

function noteIdentity(row: string, from = '') {
  return `SELECT json_array('note',${row}.note_id,${row}.revision)
    ${from} WHERE ${row}.generation=${activeGeneration}`;
}

function capture(name: string, event: string, table: string, identities: string) {
  // Delete explicitly so the enclosing writer's conflict policy cannot reuse a pending sequence.
  return `CREATE TRIGGER IF NOT EXISTS memory_search_${name} ${event} ON ${table} BEGIN
    DELETE FROM memory_search_pending WHERE identity IN (${identities});
    INSERT INTO memory_search_pending(identity) ${identities};
  END;`;
}

const passageTriggers = [
  capture(
    'passage_replace',
    'BEFORE INSERT',
    'memory_passages',
    `${passageIdentity('p', 'FROM memory_passages AS p')}
     AND p.id=NEW.id AND p.version=NEW.version AND p.start=NEW.start`
  ),
  capture('passage_insert', 'AFTER INSERT', 'memory_passages', passageIdentity('NEW')),
  capture(
    'passage_update',
    'AFTER UPDATE OF id,version,start,end,generation,vector',
    'memory_passages',
    `${passageIdentity('OLD')} UNION ${passageIdentity('NEW')}`
  ),
  capture('passage_delete', 'AFTER DELETE', 'memory_passages', passageIdentity('OLD')),
].join('\n');

const noteVectorTriggers = [
  capture(
    'note_vector_replace',
    'BEFORE INSERT',
    'memory_vectors',
    `${noteIdentity('v', 'FROM memory_vectors AS v')} AND v.note_id=NEW.note_id`
  ),
  capture('note_vector_insert', 'AFTER INSERT', 'memory_vectors', noteIdentity('NEW')),
  capture(
    'note_vector_update',
    'AFTER UPDATE OF note_id,revision,generation,vector',
    'memory_vectors',
    `${noteIdentity('OLD')} UNION ${noteIdentity('NEW')}`
  ),
  capture('note_vector_delete', 'AFTER DELETE', 'memory_vectors', noteIdentity('OLD')),
].join('\n');

const noteVector = noteIdentity('v', 'FROM memory_vectors AS v');
const noteHead = (row: string) =>
  `${noteVector} AND v.note_id=${row}.id AND v.revision=${row}.revision`;
const noteHeadTriggers = [
  // REPLACE removes the old head without reliably firing its DELETE trigger.
  capture(
    'note_head_replace',
    'BEFORE INSERT',
    'memory_notes',
    `${noteIdentity('v', 'FROM memory_vectors AS v JOIN memory_notes AS n ON n.id=v.note_id AND n.revision=v.revision')}
     AND n.id=NEW.id`
  ),
  capture('note_head_insert', 'AFTER INSERT', 'memory_notes', noteHead('NEW')),
  capture(
    'note_head_update',
    'AFTER UPDATE OF id,revision',
    'memory_notes',
    `${noteHead('OLD')} UNION ${noteHead('NEW')}`
  ),
  capture('note_head_delete', 'AFTER DELETE', 'memory_notes', noteHead('OLD')),
].join('\n');

const schema = `
  CREATE TABLE IF NOT EXISTS memory_search_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    generation TEXT NOT NULL, incarnation TEXT,
    passage_after INTEGER DEFAULT 0, note_after INTEGER DEFAULT 0, seed_done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS memory_search_pending (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL UNIQUE
  );
  ${passageTriggers}
  ${noteVectorTriggers}
  ${noteHeadTriggers}
`;

const seedPassages = `
  SELECT p.rowid, json_array('passage',p.id,p.version,p.start,p.end) AS identity
  FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
  WHERE p.rowid>? AND p.generation=? AND p.vector IS NOT NULL ORDER BY p.rowid LIMIT ?
`;
const seedNotes = `
  SELECT v.rowid, json_array('note',v.note_id,v.revision) AS identity
  FROM memory_vectors AS v JOIN memory_notes AS n ON n.id=v.note_id AND n.revision=v.revision
  WHERE v.rowid>? AND v.generation=? ORDER BY v.rowid LIMIT ?
`;

type State = {
  generation: string;
  incarnation: string | null;
  passage_after: number | null;
  note_after: number | null;
  seed_done: number;
};
type Pending = { sequence: bigint; identity: string };
type SeedRow = { rowid: number; identity: string };
type VectorRow = { vector: string };
type StoredIdentity = ['passage', string, string, number, number] | ['note', string, number];

function parseIdentity(value: string): MemorySearchIdentity {
  const row = JSON.parse(value) as StoredIdentity;
  return row[0] === 'passage'
    ? { kind: 'passage', sourceId: row[1], version: row[2], start: row[3], end: row[4] }
    : { kind: 'note', noteId: row[1], revision: row[2] };
}

export class MemorySearchPublication {
  private running?: Promise<void>;
  private verifiedIncarnation?: string;

  constructor(
    private readonly notes: MemoryNotes,
    private readonly index: MemorySearchIndex,
    private readonly binding: HostMemoryBinding,
    private readonly generation: string
  ) {
    notes.write(() => {
      this.check();
      notes.db.exec(schema);
      notes.db
        .prepare('INSERT OR IGNORE INTO memory_search_state(singleton,generation) VALUES(1,?)')
        .run(generation);
    });
  }

  partial(): boolean {
    if (this.verifiedIncarnation === undefined) return true;
    return !this.notes.db
      .prepare(
        `
      SELECT 1 FROM memory_search_state WHERE singleton=1 AND generation=? AND incarnation=? AND seed_done=1
        AND NOT EXISTS (SELECT 1 FROM memory_search_pending)
    `
      )
      .get(this.generation, this.verifiedIncarnation);
  }

  run(signal: AbortSignal): Promise<void> {
    if (this.running) return this.running;
    this.verifiedIncarnation = undefined;
    this.running = this.drain(signal).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private check(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.binding.isRoot) throw new MemoryAccessDenied('Memory root mutation required');
    assertMemoryAccess(this.notes.db, this.binding, true);
  }

  private state(): State {
    return this.notes.db
      .prepare<[], State>('SELECT * FROM memory_search_state WHERE singleton=1')
      .get()!;
  }

  private async drain(signal: AbortSignal) {
    const { db } = this.notes;
    const check = () => this.check(signal);
    check();
    const incarnation = await this.index.ensure(signal, check);
    let seedDone = this.notes.write(() => {
      check();
      const state = this.state();
      if (state.generation === this.generation && state.incarnation === incarnation)
        return state.seed_done === 1;
      db.prepare(
        `
        UPDATE memory_search_state SET generation=?,incarnation=?,passage_after=0,note_after=0,seed_done=0 WHERE singleton=1
      `
      ).run(this.generation, incarnation);
      return false;
    });
    const pending = db
      .prepare<
        [number],
        Pending
      >('SELECT sequence,identity FROM memory_search_pending ORDER BY sequence LIMIT ?')
      .safeIntegers();
    for (;;) {
      check();
      if (!seedDone) seedDone = this.seedPage(signal);
      const page = pending.all(PAGE_SIZE);
      if (page.length) await this.publishPage(page, signal);
      else if (seedDone) break;
    }
    check();
    this.verifiedIncarnation = incarnation;
  }

  private seedPage(signal: AbortSignal): boolean {
    const { db } = this.notes;
    return this.notes.write(() => {
      this.check(signal);
      const { passage_after, note_after } = this.state();
      const kind = passage_after === null ? 'note' : 'passage';
      const rows = db
        .prepare<[number, string, number], SeedRow>(kind === 'passage' ? seedPassages : seedNotes)
        .all(passage_after ?? note_after ?? 0, this.generation, PAGE_SIZE);
      const remove = db.prepare('DELETE FROM memory_search_pending WHERE identity=?');
      const enqueue = db.prepare('INSERT INTO memory_search_pending(identity) VALUES(?)');
      for (const { identity } of rows) {
        remove.run(identity);
        enqueue.run(identity);
      }
      // A null cursor means that part of the seed reached the end.
      const next = rows.length === PAGE_SIZE ? rows[rows.length - 1].rowid : null;
      const done = kind === 'note' && next === null;
      db.prepare(
        `UPDATE memory_search_state SET ${kind}_after=?,seed_done=? WHERE singleton=1`
      ).run(next, Number(done));
      return done;
    });
  }

  private async publishPage(page: Pending[], signal: AbortSignal) {
    const { db } = this.notes;
    const passage = db.prepare<[string, string, number, number, string], VectorRow>(`
      SELECT p.vector FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
      WHERE p.id=? AND p.version=? AND p.start=? AND p.end=? AND p.generation=? AND p.vector IS NOT NULL
    `);
    const note = db.prepare<[string, number, string], VectorRow>(`
      SELECT v.vector FROM memory_vectors AS v JOIN memory_notes AS n ON n.id=v.note_id AND n.revision=v.revision
      WHERE v.note_id=? AND v.revision=? AND v.generation=?
    `);
    const upserts: MemorySearchPoint[] = [];
    const removals: MemorySearchIdentity[] = [];
    for (const pending of page) {
      const identity = parseIdentity(pending.identity);
      const row =
        identity.kind === 'passage'
          ? passage.get(
              identity.sourceId,
              identity.version,
              identity.start,
              identity.end,
              this.generation
            )
          : note.get(identity.noteId, identity.revision, this.generation);
      if (row) upserts.push({ identity, vector: JSON.parse(row.vector) as number[] });
      else removals.push(identity);
    }
    if (upserts.length) {
      this.check(signal);
      await this.index.upsert(upserts, signal);
    }
    if (removals.length) {
      this.check(signal);
      await this.index.remove(removals, signal);
    }
    this.notes.write(() => {
      this.check(signal);
      const acknowledge = db.prepare('DELETE FROM memory_search_pending WHERE sequence=?');
      for (const { sequence } of page) acknowledge.run(sequence);
    });
  }
}
