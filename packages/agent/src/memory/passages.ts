// ABOUTME: Disposable, source-versioned passages with all-age scans and missing-original FTS.
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { getRecallIndex } from '../storage/recall/index-db';
import { sourceText } from './source-text';
import type { MemoryNotes } from './notes';
import type { MemorySources } from './sources';
import type { MemoryEncoder } from './encoder';
import type { Source, OriginalReference } from './types';
import { sourceHandle, originalHandle } from './types';
export { originalHandle } from './types';

export const originalReference = (source: Source): OriginalReference =>
  source.reference.kind === 'event'
    ? { kind: 'event', sessionId: source.reference.sessionId, eventSeq: source.reference.eventSeq }
    : { kind: 'document', id: source.id, version: source.version };
export type Passage = {
  source: Source;
  handle: string;
  start: number;
  end: number;
  text: string;
  vector?: number[];
};
type Row = { id: string; version: string; reference: string };
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
  admitted(): Source[] {
    if (!this.notes.available()) return [];
    return (
      this.notes.db
        .prepare('SELECT id,version,reference FROM memory_sources ORDER BY rowid')
        .all() as Row[]
    ).map((row) => ({
      id: row.id,
      version: row.version,
      reference: JSON.parse(row.reference) as Source['reference'],
    }));
  }
  async index(check: () => void): Promise<void> {
    for (const source of this.admitted()) {
      check();
      if (
        this.notes.db
          .prepare('SELECT 1 FROM memory_projected WHERE id=? AND version=?')
          .get(source.id, source.version)
      )
        continue;
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
      await yieldTurn();
    }
  }
  async vectors(encoder: MemoryEncoder, check: () => void): Promise<void> {
    if (!this.available()) return;
    let after = 0;
    while (true) {
      check();
      const rows = this.notes.db
        .prepare(
          'SELECT rowid,id,version,start,text FROM memory_passages WHERE rowid>? AND (generation IS NULL OR generation!=?) ORDER BY rowid LIMIT 4'
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
        const source = this.admitted().find(
          (source) => source.id === row.id && source.version === row.version
        );
        if (!source || (await this.sources.status(source)) !== 'current') continue;
        check();
        this.notes.write(() =>
          this.notes.db
            .prepare(
              'UPDATE memory_passages SET generation=?,vector=? WHERE id=? AND version=? AND start=? AND text=?'
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
  async all(generation: string, check: () => void): Promise<Passage[]> {
    if (!this.available()) return [];
    const admitted = new Map(this.admitted().map((source) => [sourceHandle(source), source]));
    const result: Passage[] = [];
    let after = 0;
    while (true) {
      check();
      const rows = this.notes.db
        .prepare('SELECT rowid,* FROM memory_passages WHERE rowid>? ORDER BY rowid LIMIT 128')
        .all(after) as Array<{
        rowid: number;
        id: string;
        version: string;
        start: number;
        end: number;
        text: string;
        generation: string;
        vector: string | null;
      }>;
      if (!rows.length) return result;
      after = rows.at(-1)!.rowid;
      for (const row of rows) {
        const source = admitted.get(sourceHandle(row));
        if (source)
          result.push({
            source,
            handle: originalHandle(source),
            start: row.start,
            end: row.end,
            text: row.text,
            ...(row.generation === generation && row.vector
              ? { vector: JSON.parse(row.vector) as number[] }
              : {}),
          });
      }
      await yieldTurn();
    }
  }
  textMatches(query: string): Set<string> {
    const ids = new Set<string>();
    if (!query || !this.available()) return ids;
    const events = getRecallIndex()
      .prepare('SELECT event_id FROM events WHERE events MATCH ? ORDER BY rank')
      .all(query) as Array<{ event_id: string }>;
    const allowed = new Map<string, string[]>();
    for (const source of this.admitted()) {
      const id = source.id;
      const handles = allowed.get(id) ?? [];
      handles.push(sourceHandle(source));
      allowed.set(id, handles);
    }
    for (const event of events)
      for (const handle of allowed.get(`event:${event.event_id}`) ?? []) ids.add(handle);
    for (const row of this.notes.db
      .prepare(
        'SELECT id,version FROM memory_original_fts WHERE memory_original_fts MATCH ? ORDER BY rank'
      )
      .all(query) as Array<{ id: string; version: string }>)
      ids.add(sourceHandle(row));
    return ids;
  }
}
