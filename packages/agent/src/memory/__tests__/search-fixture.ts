// ABOUTME: Independent exhaustive scoring for the existing controlled-vector recall tests.
import Database from 'better-sqlite3';
import { localMemoryEncoder } from '../encoder';
import { createMemoryRuntime } from '../runtime';
import type { MemorySearchIdentity, MemorySearchIndex, MemorySearchHit } from '../search-index';

const identityKey = (identity: MemorySearchIdentity) =>
  JSON.stringify(
    identity.kind === 'passage'
      ? [identity.kind, identity.sourceId, identity.version, identity.start, identity.end]
      : [identity.kind, identity.noteId, identity.revision]
  );

export function exhaustiveSearch(
  databasePath: string,
  generation: string
): Pick<MemorySearchIndex, 'query' | 'scores'> {
  function ranked(query: number[], signal: AbortSignal): MemorySearchHit[] {
    signal.throwIfAborted();
    const db = new Database(databasePath, { readonly: true, fileMustExist: true });
    try {
      const passages = db
        .prepare<
          [string],
          { sourceId: string; version: string; start: number; end: number; vector: string }
        >(
          `
        SELECT p.id AS sourceId,p.version,p.start,p.end,p.vector FROM memory_passages AS p
        JOIN memory_sources AS s ON s.id=p.id AND s.version=p.version
        WHERE p.generation=? AND p.vector IS NOT NULL ORDER BY p.rowid
      `
        )
        .all(generation);
      const notes = db
        .prepare<[string], { noteId: string; revision: number; vector: string }>(
          `
        SELECT n.id AS noteId,n.revision,v.vector FROM memory_notes AS n
        JOIN memory_vectors AS v ON v.note_id=n.id AND v.revision=n.revision
        WHERE v.generation=? ORDER BY n.rowid
      `
        )
        .all(generation);
      const score = (stored: string) =>
        (JSON.parse(stored) as number[]).reduce((sum, value, i) => sum + value * query[i], 0);
      return [
        ...passages.map(({ vector, ...identity }) => ({
          identity: { kind: 'passage' as const, ...identity },
          score: score(vector),
        })),
        ...notes.map(({ vector, ...identity }) => ({
          identity: { kind: 'note' as const, ...identity },
          score: score(vector),
        })),
      ].sort((a, b) => b.score - a.score);
    } finally {
      db.close();
    }
  }
  return {
    async query(vector, limit, signal, { offset = 0, minScore = -Infinity } = {}) {
      return ranked(vector, signal)
        .filter(({ score }) => score >= minScore)
        .slice(offset, offset + limit);
    },
    async scores(vector, identities, signal) {
      const wanted = new Set(identities.map(identityKey));
      return ranked(vector, signal).filter(({ identity }) => wanted.has(identityKey(identity)));
    },
  };
}

export function createFixtureMemoryRuntime(
  configuration: Parameters<typeof createMemoryRuntime>[0],
  deps: NonNullable<Parameters<typeof createMemoryRuntime>[1]>
) {
  return createMemoryRuntime(configuration, {
    ...deps,
    search:
      deps.search ??
      exhaustiveSearch(configuration.databasePath, (deps.encoder ?? localMemoryEncoder).generation),
  });
}
