// ABOUTME: Request-private disk storage for exact recall ordering and group aliases.
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import Database, { type Database as Db } from 'better-sqlite3';
import type { MemorySearchIdentity } from './search-index';

export const RECALL_PAGE_SIZE = 128;
const mergeFanIn = 8;
export type MatchSurface = 'event' | 'original' | 'note';
type MatchIdentity = { id: string; version: string };
export type RankedCandidate = (
  | { kind: 'passage'; id: string; version: string; start: number; end: number; text: string }
  | { kind: 'note'; id: string; revision: number }
) & {
  exact: boolean;
  score: number;
  semantic: boolean;
  textual: boolean;
  ordinal: number;
};

const compare = (a: RankedCandidate, b: RankedCandidate) =>
  Number(b.exact) - Number(a.exact) ||
  b.score - a.score ||
  Number(a.kind === 'note') - Number(b.kind === 'note') ||
  a.id.localeCompare(b.id) ||
  (a.kind === 'passage' && b.kind === 'passage' ? a.start - b.start : 0) ||
  a.ordinal - b.ordinal;

export class RecallScratch {
  private readonly db: Db;
  private nextRun = 0;
  private readonly insertRunPage;
  private readonly runPage;
  private readonly removeRunPage;
  private readonly insertMatches;
  private readonly match;
  private readonly insertNomination;
  private readonly getAlias;
  private readonly putAlias;
  private readonly moveAliasPage;

  constructor(memoryPath: string) {
    // Use the configured state volume. A worker's TMPDIR may be a memory filesystem.
    const directory = mkdtempSync(join(dirname(memoryPath), 'recall-scratch-'));
    const file = join(directory, 'ranking.sqlite');
    let db: Db | undefined;
    try {
      db = new Database(file);
      this.db = db;
      // The disposable database is private to this connection and needs no sidecars.
      db.exec(`
        PRAGMA locking_mode=EXCLUSIVE;
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA cache_size=-1024;
        PRAGMA mmap_size=0;
        CREATE TABLE candidates (
          run INTEGER, position INTEGER, descriptor TEXT NOT NULL, PRIMARY KEY(run,position)
        ) WITHOUT ROWID;
        CREATE TABLE matches (
          surface TEXT, id TEXT, version TEXT, PRIMARY KEY(surface,id,version)
        ) WITHOUT ROWID;
        CREATE TABLE nominations (identity TEXT PRIMARY KEY) WITHOUT ROWID;
        CREATE TABLE aliases (key TEXT PRIMARY KEY, owner INTEGER NOT NULL) WITHOUT ROWID;
        CREATE INDEX alias_owner ON aliases(owner);
      `);
      // Keep the descriptor open, with no directory entry to leak if the worker dies.
      unlinkSync(file);
      rmSync(directory, { recursive: true, force: true });
      const insertCandidate = db.prepare('INSERT INTO candidates VALUES(?,?,?)');
      this.insertRunPage = db.transaction(
        (run: number, offset: number, page: RankedCandidate[]) => {
          for (const [i, descriptor] of page.entries())
            insertCandidate.run(run, offset + i, JSON.stringify(descriptor));
        }
      );
      this.runPage = db.prepare<[number, number], { position: number; descriptor: string }>(
        `SELECT position,descriptor FROM candidates WHERE run=? AND position>? ORDER BY position LIMIT ${RECALL_PAGE_SIZE}`
      );
      this.removeRunPage = db.prepare(`
        DELETE FROM candidates WHERE (run,position) IN (
          SELECT run,position FROM candidates WHERE run>=? AND run<? LIMIT ${RECALL_PAGE_SIZE}
        )
      `);
      const insertMatch = db.prepare('INSERT OR IGNORE INTO matches VALUES(?,?,?)');
      this.insertMatches = db.transaction(
        (surface: MatchSurface, rows: Array<{ id: string; version?: string }>) => {
          for (const { id, version } of rows) insertMatch.run(surface, id, version ?? '');
        }
      );
      this.match = db.prepare('SELECT 1 FROM matches WHERE surface=? AND id=? AND version=?');
      this.insertNomination = db.prepare('INSERT OR IGNORE INTO nominations VALUES(?)');
      this.getAlias = db.prepare<[string], { owner: number }>(
        'SELECT owner FROM aliases WHERE key=?'
      );
      this.putAlias = db.prepare('INSERT INTO aliases VALUES(?,?)');
      this.moveAliasPage = db.prepare(`
        UPDATE aliases SET owner=? WHERE key IN (SELECT key FROM aliases WHERE owner=? LIMIT ${RECALL_PAGE_SIZE})
      `);
    } catch (error) {
      try {
        db?.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  addMatches(surface: MatchSurface, rows: Array<{ id: string; version?: string }>): void {
    this.insertMatches(surface, rows);
  }

  hasMatch(surface: MatchSurface, id: string, version = ''): boolean {
    return !!this.match.get(surface, id, version);
  }

  *matchPages(surface: MatchSurface): Iterable<MatchIdentity[]> {
    const select = 'SELECT id,version FROM matches WHERE surface=?';
    const order = `ORDER BY id,version LIMIT ${RECALL_PAGE_SIZE}`;
    const first = this.db.prepare<[MatchSurface], MatchIdentity>(`${select} ${order}`);
    const next = this.db.prepare<[MatchSurface, string, string], MatchIdentity>(
      `${select} AND (id,version)>(?,?) ${order}`
    );
    let page = first.all(surface);
    while (page.length) {
      const { id, version } = page[page.length - 1];
      yield page;
      page = next.all(surface, id, version);
    }
  }

  nominate(identity: MemorySearchIdentity): boolean {
    const key =
      identity.kind === 'passage'
        ? [identity.kind, identity.sourceId, identity.version, identity.start, identity.end]
        : [identity.kind, identity.noteId, identity.revision];
    return this.insertNomination.run(JSON.stringify(key)).changes === 1;
  }

  async clearRanking(check: () => void): Promise<void> {
    check();
    const removeNominationPage = this.db.prepare(`
      DELETE FROM nominations WHERE identity IN (
        SELECT identity FROM nominations ORDER BY identity LIMIT ${RECALL_PAGE_SIZE}
      )
    `);
    for (const removePage of [
      () => this.removeRunPage.run(0, this.nextRun),
      () => removeNominationPage.run(),
    ]) {
      while (removePage().changes > 0) {
        await yieldTurn();
        check();
      }
    }
    this.nextRun = 0;
  }

  alias(key: string): number | undefined {
    return this.getAlias.get(key)?.owner;
  }

  addAlias(key: string, owner: number): void {
    this.putAlias.run(key, owner);
  }

  moveAliases(previous: number, owner: number): void {
    while (this.moveAliasPage.run(owner, previous).changes === RECALL_PAGE_SIZE) {
      // Each update commits one page even when a retired group has many aliases.
    }
  }

  addRun(page: RankedCandidate[]): void {
    if (page.length) this.insertRunPage(this.nextRun++, 0, page.sort(compare));
  }

  async ordered(check: () => void): Promise<Iterable<RankedCandidate>> {
    let first = 0;
    while (this.nextRun - first > mergeFanIn) {
      const end = this.nextRun;
      for (; first < end; first += mergeFanIn) {
        check();
        const last = Math.min(first + mergeFanIn, end);
        const run = this.nextRun++;
        let position = 0;
        let page: RankedCandidate[] = [];
        for (const candidate of this.merge(first, last)) {
          page.push(candidate);
          if (page.length < RECALL_PAGE_SIZE) continue;
          this.insertRunPage(run, position, page);
          position += page.length;
          page = [];
          await yieldTurn();
          check();
        }
        if (page.length) this.insertRunPage(run, position, page);
        while (this.removeRunPage.run(first, last).changes === RECALL_PAGE_SIZE) {
          await yieldTurn();
          check();
        }
      }
      first = end;
    }
    return this.merge(first, this.nextRun);
  }

  private *rows(run: number): Generator<RankedCandidate, undefined> {
    let position = -1;
    while (true) {
      const page = this.runPage.all(run, position);
      if (!page.length) return undefined;
      for (const row of page) yield JSON.parse(row.descriptor) as RankedCandidate;
      position = page.at(-1)!.position;
    }
  }

  private *merge(first: number, end: number): Generator<RankedCandidate> {
    const runs = Array.from({ length: end - first }, (_, i) => this.rows(first + i));
    const heads = runs.map((run) => run.next().value);
    while (true) {
      let best = -1;
      for (const [i, head] of heads.entries())
        if (head && (best < 0 || compare(head, heads[best]!) < 0)) best = i;
      if (best < 0) return;
      yield heads[best]!;
      heads[best] = runs[best].next().value;
    }
  }
}
