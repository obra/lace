// ABOUTME: Atomic current notes, immutable revisions/offers and extraction coverage.
import type { Database } from 'better-sqlite3';
import type { HostMemoryBinding } from '@lace/ent-protocol';
import { randomUUID, createHash } from 'node:crypto';
import { assertMemoryAccess } from './authority';
import { sourceHandle, type Note, type Source } from './types';
import type { Proposal } from './extraction';

type SourceRow = { id: string; version: string; reference: string; status: string };
export class MemoryNotes {
  constructor(
    readonly db: Database,
    initialize = true,
    private authorize?: () => void
  ) {
    if (!initialize) return;
    const rebuild = !db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_fts'").get();
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_sources (
        id TEXT NOT NULL, version TEXT NOT NULL, reference TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', reason TEXT,
        PRIMARY KEY(id, version)
      );
      CREATE TABLE IF NOT EXISTS memory_documents (path TEXT PRIMARY KEY, version TEXT);
      CREATE TABLE IF NOT EXISTS memory_scan (file TEXT PRIMARY KEY, identity TEXT NOT NULL, offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_notes (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL, text TEXT NOT NULL,
        producer TEXT NOT NULL, sources TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_revisions (
        note_id TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL,
        producer TEXT NOT NULL, sources TEXT NOT NULL, work_id TEXT NOT NULL,
        PRIMARY KEY(note_id, revision)
      );
      CREATE TABLE IF NOT EXISTS memory_offers (id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_receipts (work_id TEXT PRIMARY KEY, outcome TEXT NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS memory_worker (singleton INTEGER PRIMARY KEY CHECK(singleton=1), attempt TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(id UNINDEXED, content, tokenize='porter unicode61');
    `);
    if (rebuild) db.exec('INSERT INTO memory_fts(id,content) SELECT id,text FROM memory_notes');
  }
  write<T>(work: () => T): T {
    const run = () => {
      this.authorize?.();
      return work();
    };
    return this.db.inTransaction ? run() : this.db.transaction(run).immediate();
  }
  available(): boolean {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='memory_notes'").get();
  }
  discover(source: Source): void {
    this.write(() =>
      this.db
        .prepare('INSERT OR IGNORE INTO memory_sources(id,version,reference) VALUES(?,?,?)')
        .run(source.id, source.version, JSON.stringify(source.reference))
    );
  }
  pending(): Source[] {
    return (
      this.db
        .prepare("SELECT * FROM memory_sources WHERE status='pending' ORDER BY rowid LIMIT 128")
        .all() as SourceRow[]
    ).map((r) => ({
      id: r.id,
      version: r.version,
      reference: JSON.parse(r.reference) as Source['reference'],
    }));
  }
  omissions(): Array<{ id: string; reason: string }> {
    return (
      this.db
        .prepare(
          "SELECT * FROM memory_sources WHERE status IN ('omitted','unavailable') ORDER BY rowid DESC LIMIT 16"
        )
        .all() as Array<SourceRow & { reason: string | null }>
    ).map((row) => ({ id: sourceHandle(row), reason: row.reason ?? 'Source unavailable' }));
  }
  status(source: Source, status: string, reason?: string): void {
    this.write(() =>
      this.db
        .prepare('UPDATE memory_sources SET status=?, reason=? WHERE id=? AND version=?')
        .run(status, reason ?? null, source.id, source.version)
    );
  }
  note(id: string): Note | undefined {
    const row = this.db.prepare('SELECT * FROM memory_notes WHERE id=?').get(id) as
      | (Omit<Note, 'sources'> & { sources: string })
      | undefined;
    return row ? { ...row, sources: JSON.parse(row.sources) as Source[] } : undefined;
  }
  candidates(): Note[] {
    return (
      this.db.prepare('SELECT id FROM memory_notes ORDER BY rowid DESC LIMIT 16').all() as {
        id: string;
      }[]
    ).map(({ id }) => this.note(id)!);
  }
  offer(
    sources: Array<Source & { sourceStatus?: string }>,
    candidates: Note[],
    extractor: string,
    primaries: Source[]
  ): string {
    const manifest = JSON.stringify({
      version: 1,
      extractor,
      sources: sources.map(({ id, version, reference, sourceStatus }) => ({
        id,
        version,
        reference,
        sourceStatus,
      })),
      primaries: primaries.map(sourceHandle),
      candidates: candidates.map(({ id, revision }) => ({ id, revision })),
    });
    const id = createHash('sha256').update(manifest).digest('hex');
    this.write(() =>
      this.db
        .prepare('INSERT OR IGNORE INTO memory_offers(id,manifest) VALUES(?,?)')
        .run(id, manifest)
    );
    return id;
  }
  failed(workId: string, sources: Source[], detail: string): void {
    this.write(() => {
      this.db
        .prepare(
          "INSERT OR IGNORE INTO memory_receipts(work_id,outcome,detail) VALUES(?,'failed',?)"
        )
        .run(workId, detail);
      for (const source of sources) this.status(source, 'failed', detail);
    });
  }
  accept(
    binding: HostMemoryBinding,
    attempt: string,
    workId: string,
    sources: Source[],
    candidates: Note[],
    proposal: Proposal,
    validate: () => void,
    primaries: Source[]
  ): void {
    this.write(() => {
      assertMemoryAccess(this.db, binding, true);
      if (
        (
          this.db.prepare('SELECT attempt FROM memory_worker WHERE singleton=1').get() as {
            attempt: string;
          }
        )?.attempt !== attempt
      )
        throw new Error('Extraction attempt replaced');
      if (this.db.prepare('SELECT 1 FROM memory_receipts WHERE work_id=?').get(workId)) return;
      validate();
      for (const candidate of candidates)
        if (this.note(candidate.id)?.revision !== candidate.revision)
          throw new Error('Candidate revision changed');
      const offered = new Map(sources.map((source) => [sourceHandle(source), source]));
      const targets = new Set<string>();
      for (const change of proposal.changes) {
        if (change.sourceIds.some((id) => !offered.has(id))) throw new Error('Unoffered source');
        const previous = change.target ? this.note(change.target.noteId) : undefined;
        if (
          change.target &&
          (!previous ||
            previous.revision !== change.target.revision ||
            targets.has(previous.id) ||
            !candidates.some((n) => n.id === previous.id && n.revision === previous.revision))
        )
          throw new Error('Note revision changed or not offered');
        const id = previous?.id ?? randomUUID();
        targets.add(id);
        const revision = (previous?.revision ?? 0) + 1;
        const references = JSON.stringify(
          change.sourceIds.map((sourceId) => offered.get(sourceId)!)
        );
        this.db
          .prepare('INSERT INTO memory_revisions VALUES(?,?,?,?,?,?)')
          .run(id, revision, change.text, binding.producerId, references, workId);
        this.db
          .prepare('INSERT OR REPLACE INTO memory_notes VALUES(?,?,?,?,?)')
          .run(id, revision, change.text, binding.producerId, references);
        this.db.prepare('DELETE FROM memory_fts WHERE id=?').run(id);
        this.db.prepare('INSERT INTO memory_fts(id,content) VALUES(?,?)').run(id, change.text);
      }
      for (const source of primaries) this.status(source, 'completed');
      this.db
        .prepare("INSERT INTO memory_receipts(work_id,outcome) VALUES(?,'completed')")
        .run(workId);
    });
  }
}
