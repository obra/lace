// ABOUTME: Disposable, source-versioned passages with all-age scans and missing-original FTS.
import { setImmediate as yieldTurn } from 'node:timers/promises';
import type { Statement } from 'better-sqlite3';
import { getRecallIndex } from '../storage/recall/index-db';
import { logger } from '../utils/logger';
import { sourceText } from './source-text';
import type { MemoryNotes } from './notes';
import type { MemorySources } from './sources';
import type { MemoryEncoder } from './encoder';
import type { PassageSearchIdentity } from './search-index';
import type { Source, OriginalReference, OriginalEvidence, AutomaticRecallResult } from './types';
import { originalHandle } from './types';
export { originalHandle } from './types';

export const originalReference = (source: Source): OriginalReference =>
  source.reference.kind === 'event'
    ? { kind: 'event', sessionId: source.reference.sessionId, eventSeq: source.reference.eventSeq }
    : { kind: 'document', id: source.id, version: source.version };
export type Passage = {
  source: Source;
  start: number;
  end: number;
  text: string;
  vector?: number[];
};
export type PassageCandidate = Omit<Passage, 'vector'> & {
  rowid: number;
  generation: string | null;
  hasVector: boolean;
};
type SourceRow = { id: string; version: string; reference: string };
type PassageRow = SourceRow & {
  rowid: number;
  start: number;
  end: number;
  text: string;
  vector: string | null;
};
type CandidateRow = Omit<PassageRow, 'vector'> & { generation: string | null; hasVector: 0 | 1 };
const selectCandidate = `
  SELECT p.rowid,p.id,p.version,p.start,p.end,p.text,p.generation,p.vector IS NOT NULL AS hasVector,s.reference
  FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
`;
const sourceOf = ({ id, version, reference }: SourceRow): Source => ({
  id,
  version,
  reference: JSON.parse(reference) as Source['reference'],
});
const passageOf = ({ start, end, text, vector, ...row }: PassageRow): Passage => ({
  source: sourceOf(row),
  start,
  end,
  text,
  ...(vector ? { vector: JSON.parse(vector) as number[] } : {}),
});
const candidateOf = ({
  rowid,
  start,
  end,
  text,
  generation,
  hasVector,
  ...row
}: CandidateRow): PassageCandidate => ({
  source: sourceOf(row),
  rowid,
  start,
  end,
  text,
  generation,
  hasVector: hasVector === 1,
});
// UTF-8 bytes bound the tokenizer's worst case; reserve room for the document template.
export function splitPassages(text: string): Array<{ start: number; end: number; text: string }> {
  const result = [];
  let start = 0;
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 384) {
      result.push({ start, end, text: text.slice(start, end) });
      start = end;
      bytes = 0;
    }
    bytes += size;
    end += character.length;
  }
  if (end > start) result.push({ start, end, text: text.slice(start, end) });
  return result;
}
export class MemoryPassages {
  private lookups?: {
    point: Statement<[string, string, number, number], CandidateRow>;
    source: Statement<[string, number], CandidateRow>;
    version: Statement<[string, string, number], CandidateRow>;
  };

  constructor(
    private notes: MemoryNotes,
    private sources: MemorySources,
    initialize: boolean
  ) {
    if (initialize)
      notes.write(() =>
        notes.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_passages (
        id TEXT NOT NULL, version TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
        text TEXT NOT NULL, generation TEXT, vector TEXT, PRIMARY KEY(id,version,start)
      );
      CREATE INDEX IF NOT EXISTS memory_passages_coverage
        ON memory_passages(generation,id,version) WHERE vector IS NOT NULL;
      CREATE INDEX IF NOT EXISTS memory_passages_generation ON memory_passages(generation);
      CREATE TABLE IF NOT EXISTS memory_projected (id TEXT NOT NULL, version TEXT NOT NULL, PRIMARY KEY(id,version));
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_original_fts USING fts5(id UNINDEXED, version UNINDEXED, content, tokenize='porter unicode61');
    `)
      );
  }
  available() {
    return !!this.notes.db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='memory_passages'")
      .get();
  }
  source(id: string, version: string): Source | undefined {
    const row = this.notes.db
      .prepare('SELECT id,version,reference FROM memory_sources WHERE id=? AND version=?')
      .get(id, version) as SourceRow | undefined;
    return row && sourceOf(row);
  }

  candidate({
    sourceId,
    version,
    start,
    end,
  }: PassageSearchIdentity): PassageCandidate | undefined {
    const row = this.candidateLookups()?.point.get(sourceId, version, start, end);
    return row && candidateOf(row);
  }

  sourcePage(id: string, version: string | undefined, after: number): PassageCandidate[] {
    const lookups = this.candidateLookups();
    if (!lookups) return [];
    return (
      version === undefined
        ? lookups.source.all(id, after)
        : lookups.version.all(id, version, after)
    ).map(candidateOf);
  }

  private candidateLookups() {
    if (!this.lookups && this.available()) {
      const { db } = this.notes;
      this.lookups = {
        point: db.prepare(
          `${selectCandidate} WHERE p.id=? AND p.version=? AND p.start=? AND p.end=?`
        ),
        source: db.prepare(
          `${selectCandidate} WHERE p.id=? AND p.rowid>? ORDER BY p.rowid LIMIT 128`
        ),
        version: db.prepare(
          `${selectCandidate} WHERE p.id=? AND p.version=? AND p.rowid>? ORDER BY p.rowid LIMIT 128`
        ),
      };
    }
    return this.lookups;
  }

  sourceForOriginal({
    handle,
    source,
  }: Pick<OriginalEvidence, 'handle' | 'source'>): Source | undefined {
    if (source.kind === 'document') {
      const admitted = this.source(source.id, source.version);
      return admitted && originalHandle(admitted) === handle ? admitted : undefined;
    }
    const rows = this.notes.db
      .prepare('SELECT id,version,reference FROM memory_sources WHERE id=?')
      .iterate(`event:${source.sessionId}:${source.eventSeq}`) as Iterable<SourceRow>;
    for (const row of rows) if (originalHandle(row) === handle) return sourceOf(row);
    return undefined;
  }
  sourceForHandle(handle: string): Source | undefined {
    if (!this.notes.available()) return undefined;
    // An opaque handle supplied to recall(read) has no event or document key.
    const rows = this.notes.db
      .prepare('SELECT id,version,reference FROM memory_sources ORDER BY rowid')
      .iterate() as Iterable<SourceRow>;
    for (const row of rows) if (originalHandle(row) === handle) return sourceOf(row);
    return undefined;
  }
  async index(check: () => void): Promise<void> {
    const unprojected = this.notes.db.prepare(`
      SELECT s.rowid,s.id,s.version,s.reference FROM memory_sources AS s
      WHERE s.rowid > ? AND NOT EXISTS (
        SELECT 1 FROM memory_projected AS p WHERE p.id=s.id AND p.version=s.version
      ) ORDER BY s.rowid LIMIT 128
    `);
    let after = 0;
    while (true) {
      check();
      const page = unprojected.all(after) as Array<SourceRow & { rowid: number }>;
      if (!page.length) return;
      after = page.at(-1)!.rowid;
      for (const row of page) {
        check();
        await this.project(sourceOf(row), check);
        await yieldTurn();
      }
    }
  }
  private async project(source: Source, check: () => void): Promise<void> {
    try {
      const input = await this.sources.load(source, true);
      check();
      this.sources.validateAtAcceptance([{ ...input, sourceStatus: 'current' }]);
      const text = sourceText(input.content);
      let covered = '';
      if (source.reference.kind === 'event') {
        covered =
          (
            getRecallIndex()
              .prepare('SELECT content FROM events WHERE event_id=?')
              .get(`${source.reference.sessionId}:${source.reference.eventSeq}`) as
              | { content: string }
              | undefined
          )?.content ?? '';
      }
      this.notes.write(() => {
        if (!this.source(source.id, source.version)) return;
        for (const passage of splitPassages(text))
          this.notes.db
            .prepare(
              'INSERT OR REPLACE INTO memory_passages(id,version,start,end,text) VALUES(?,?,?,?,?)'
            )
            .run(source.id, source.version, passage.start, passage.end, passage.text);
        if (text && !covered.includes(text))
          this.notes.db
            .prepare('INSERT INTO memory_original_fts VALUES(?,?,?)')
            .run(source.id, source.version, text);
        this.notes.db
          .prepare('INSERT OR REPLACE INTO memory_projected VALUES(?,?)')
          .run(source.id, source.version);
      });
    } catch {
      check();
      // Unreadable originals remain undisplayed and can be rediscovered on a later wake.
    }
  }
  async vectors(encoder: MemoryEncoder, check: () => void): Promise<void> {
    if (!this.available()) return;
    const { db } = this.notes;
    // Seek distinct generation keys and visit only pending rows in rowid order within each key.
    const firstGeneration = db.prepare<[], { generation: string }>(
      'SELECT generation FROM memory_passages WHERE generation IS NOT NULL ORDER BY generation LIMIT 1'
    );
    const nextGeneration = db.prepare<[string], { generation: string }>(
      'SELECT generation FROM memory_passages WHERE generation > ? ORDER BY generation LIMIT 1'
    );
    const pending = db.prepare<
      [string | null, number],
      Pick<PassageRow, 'rowid' | 'id' | 'version' | 'start' | 'text'>
    >(
      `SELECT p.rowid,p.id,p.version,p.start,p.text
       FROM memory_passages AS p INDEXED BY memory_passages_generation
       JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
       WHERE p.generation IS ? AND p.rowid>? ORDER BY p.rowid LIMIT 4`
    );
    check();
    let generation = firstGeneration.get()?.generation ?? null;
    let after = 0;
    while (true) {
      check();
      if (generation === encoder.generation)
        generation = nextGeneration.get(generation)?.generation ?? null;
      const rows = pending.all(generation, after);
      if (!rows.length) {
        // Process the NULL generation last, including projections added during stale work.
        if (generation === null) return;
        generation = nextGeneration.get(generation)?.generation ?? null;
        after = 0;
        continue;
      }
      after = rows.at(-1)!.rowid;
      const vectors = await encoder.encode(
        rows.map((row) => row.text),
        'document'
      );
      check();
      for (const [index, row] of rows.entries()) {
        const source = this.source(row.id, row.version);
        if (!source || (await this.sources.status(source)) !== 'current') continue;
        check();
        this.notes.write(() =>
          this.notes.db
            .prepare(
              `UPDATE memory_passages SET generation=?,vector=? WHERE id=? AND version=? AND start=? AND text=?
               AND EXISTS (SELECT 1 FROM memory_sources AS s WHERE s.id=memory_passages.id AND s.version=memory_passages.version)`
            )
            .run(
              encoder.generation,
              JSON.stringify(vectors[index]),
              row.id,
              row.version,
              row.start,
              row.text
            )
        );
      }
      await yieldTurn();
    }
  }
  coverage(generation: string): AutomaticRecallResult['coverage'] {
    const hasSources = this.notes.available();
    if (!hasSources) return { sources: 0, passages: 0, vectors: 0, partial: false };
    const schema = this.notes.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('memory_passages', 'memory_passages_coverage')"
      )
      .pluck()
      .all() as string[];
    if (!schema.includes('memory_passages')) {
      const { sources } = this.notes.db
        .prepare('SELECT count(*) AS sources FROM memory_sources')
        .get() as { sources: number };
      return { sources, passages: 0, vectors: 0, partial: sources > 0 };
    }
    // The generation index alone would require passage table reads for this count.
    const coverageIndex = schema.includes('memory_passages_coverage')
      ? 'INDEXED BY memory_passages_coverage'
      : '';
    const { sources, unprojected, passages, vectors } = this.notes.db
      .prepare(
        `
      SELECT * FROM (
        SELECT count(*) AS sources, coalesce(sum(NOT EXISTS (
          SELECT 1 FROM memory_passages AS p WHERE p.id=s.id AND p.version=s.version
        )),0) AS unprojected FROM memory_sources AS s
      ), (
        SELECT count(*) AS passages FROM memory_passages AS p
          JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
      ), (
        SELECT count(*) AS vectors FROM memory_passages AS p ${coverageIndex}
          JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
          WHERE p.generation=? AND p.vector IS NOT NULL
      )
    `
      )
      .get(generation) as {
      sources: number;
      unprojected: number;
      passages: number;
      vectors: number;
    };
    return { sources, passages, vectors, partial: unprojected > 0 || passages !== vectors };
  }
  async *pages(generation: string | undefined, check: () => void): AsyncGenerator<Passage[]> {
    if (!this.available()) return;
    const page = this.notes.db.prepare(`
      SELECT p.rowid,p.id,p.version,p.start,p.end,p.text,s.reference,
        CASE WHEN p.generation=? THEN p.vector END AS vector
      FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
      WHERE p.rowid>? ORDER BY p.rowid LIMIT 128
    `);
    const scan = { pages: 0, rows: 0, sqliteMs: 0, decodeMs: 0, callerMs: 0, yieldMs: 0 };
    let after = 0;
    while (true) {
      check();
      let started = performance.now();
      const rows = page.all(generation ?? null, after) as PassageRow[];
      scan.sqliteMs += performance.now() - started;
      if (!rows.length) break;
      scan.pages++;
      scan.rows += rows.length;
      after = rows.at(-1)!.rowid;
      started = performance.now();
      const passages = rows.map(passageOf);
      scan.decodeMs += performance.now() - started;
      started = performance.now();
      yield passages;
      scan.callerMs += performance.now() - started;
      started = performance.now();
      await yieldTurn();
      scan.yieldMs += performance.now() - started;
    }
    logger.debug('memory.recall.passage_scan', scan);
  }
}
