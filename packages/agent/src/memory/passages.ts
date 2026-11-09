// ABOUTME: Disposable, source-versioned passages with all-age scans and missing-original FTS.
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { getRecallIndex } from '../storage/recall/index-db';
import { sourceText } from './source-text';
import type { MemoryNotes } from './notes';
import type { MemorySources } from './sources';
import type { MemoryEncoder } from './encoder';
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
type SourceRow = { id: string; version: string; reference: string };
type PassageRow = SourceRow & {
  rowid: number;
  start: number;
  end: number;
  text: string;
  vector: string | null;
};
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
    let after = 0;
    while (true) {
      check();
      const rows = this.notes.db
        .prepare(
          `SELECT p.rowid,p.id,p.version,p.start,p.text FROM memory_passages AS p
           JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
           WHERE p.rowid>? AND (p.generation IS NULL OR p.generation!=?) ORDER BY p.rowid LIMIT 4`
        )
        .all(after, encoder.generation) as Array<{
        rowid: number;
        id: string;
        version: string;
        start: number;
        text: string;
      }>;
      if (!rows.length) return;
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
    if (!this.available()) {
      const { sources } = this.notes.db
        .prepare('SELECT count(*) AS sources FROM memory_sources')
        .get() as { sources: number };
      return { sources, passages: 0, vectors: 0, partial: sources > 0 };
    }
    const { sources, unprojected, passages, vectors } = this.notes.db
      .prepare(
        `
      SELECT * FROM (
        SELECT count(*) AS sources, coalesce(sum(NOT EXISTS (
          SELECT 1 FROM memory_passages AS p WHERE p.id=s.id AND p.version=s.version
        )),0) AS unprojected FROM memory_sources AS s
      ), (
        SELECT count(*) AS passages, count(CASE WHEN p.generation=? AND p.vector IS NOT NULL
          THEN 1 END) AS vectors FROM memory_passages AS p
          JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
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
    let after = 0;
    while (true) {
      check();
      const rows = page.all(generation ?? null, after) as PassageRow[];
      if (!rows.length) return;
      after = rows.at(-1)!.rowid;
      yield rows.map(passageOf);
      await yieldTurn();
    }
  }
  first(support: Source[]): Passage | undefined {
    if (!this.available()) return undefined;
    const lookup = this.notes.db.prepare(`
      SELECT p.rowid,p.id,p.version,p.start,p.end,p.text,s.reference,NULL AS vector
      FROM memory_passages AS p JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
      WHERE p.id=? AND p.version=? ORDER BY p.rowid LIMIT 1
    `);
    let first: PassageRow | undefined;
    for (const { id, version } of support) {
      const row = lookup.get(id, version) as PassageRow | undefined;
      if (row && (!first || row.rowid < first.rowid)) first = row;
    }
    return first && passageOf(first);
  }
}
