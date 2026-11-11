// ABOUTME: Tests for backfill.ts — one-time-per-startup catch-up scan of JSONL transcripts
// ABOUTME: Covers new and legacy layouts, partial-index resume, idempotency, and _unknown bucket

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs, {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openRecallIndex, type Db } from '../index-db';
import { insertRow } from '../index-writer';
import { backfillIndex } from '../backfill';
import type { DurableEvent } from '../../event-log';

// session ids must match sess_<uuid> format (see ent-protocol/src/ids.ts)
const SESSION_IDS = {
  legacy: 'sess_11111111-1111-4111-8111-111111111111',
  new: 'sess_22222222-2222-4222-8222-222222222222',
  partial: 'sess_33333333-3333-4333-8333-333333333333',
  idem: 'sess_44444444-4444-4444-8444-444444444444',
  unknown: 'sess_55555555-5555-4555-8555-555555555555',
  noMeta: 'sess_66666666-6666-4666-8666-666666666666',
  malformed: 'sess_77777777-7777-4777-8777-777777777777',
  legacyMix: 'sess_88888888-8888-4888-8888-888888888888',
  newMix: 'sess_99999999-9999-4999-8999-999999999999',
} as const;

type Row = {
  event_id: string;
  session_id: string;
  persona: string | null;
  kind: string;
  content: string;
};

function promptEvent(eventSeq: number, text: string): DurableEvent {
  return {
    eventSeq,
    timestamp: `2026-05-23T00:00:0${eventSeq}Z`,
    type: 'prompt',
    data: { type: 'prompt', content: [{ type: 'text', text }] },
  };
}

function writeJsonl(filePath: string, events: DurableEvent[]): void {
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(filePath, body, 'utf8');
}

function writeMeta(sessionDir: string, sessionId: string, persona: string | null): void {
  const meta: Record<string, unknown> = {
    sessionId,
    workDir: '/tmp/workdir',
    created: '2026-05-23T00:00:00Z',
  };
  if (persona !== null) meta.persona = persona;
  writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta), 'utf8');
}

function allRows(db: Db): Row[] {
  return db
    .prepare(`SELECT event_id, session_id, persona, kind, content FROM events ORDER BY event_id`)
    .all() as Row[];
}

describe('backfillIndex', () => {
  let laceDir: string;
  let db: Db;
  let savedLaceDir: string | undefined;

  beforeEach(() => {
    savedLaceDir = process.env.LACE_DIR;
    laceDir = mkdtempSync(join(tmpdir(), 'recall-backfill-'));
    process.env.LACE_DIR = laceDir;
    db = openRecallIndex(join(laceDir, 'recall', 'index.sqlite'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    db.close();
    rmSync(laceDir, { recursive: true, force: true });
    if (savedLaceDir === undefined) delete process.env.LACE_DIR;
    else process.env.LACE_DIR = savedLaceDir;
  });

  function transcriptFile(sessionId: string, date = '2026-05-23'): string {
    const dir = join(laceDir, 'transcripts', 'ada', date);
    mkdirSync(dir, { recursive: true });
    return join(dir, `${sessionId}.jsonl`);
  }

  it('backfills events from legacy <laceDir>/agent-sessions layout', () => {
    const sessionId = SESSION_IDS.legacy;
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeMeta(sessionDir, sessionId, 'ada');
    writeJsonl(join(sessionDir, 'events.jsonl'), [
      promptEvent(1, 'hello'),
      promptEvent(2, 'world'),
      promptEvent(3, 'again'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.event_id)).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
    ]);
    expect(rows.every((r) => r.session_id === sessionId)).toBe(true);
    expect(rows.every((r) => r.persona === 'ada')).toBe(true);
    expect(rows.every((r) => r.kind === 'user_message')).toBe(true);
  });

  it('discovers sessions under LACE_SESSION_DIR fallback (H11)', () => {
    const sessionRoot = mkdtempSync(join(tmpdir(), 'lace-bf-s-'));
    const savedSessionDir = process.env.LACE_SESSION_DIR;
    process.env.LACE_SESSION_DIR = sessionRoot;
    try {
      const sessionId = 'sess_ffffffff-ffff-4fff-8fff-ffffffffffff';
      // Seed a legacy session under the override location — NOT under laceDir.
      const legacySession = join(sessionRoot, sessionId);
      mkdirSync(legacySession, { recursive: true });
      writeMeta(legacySession, sessionId, 'ada');
      writeJsonl(join(legacySession, 'events.jsonl'), [promptEvent(1, 'hello')]);

      const stats = backfillIndex(db, laceDir);
      expect(stats.inserted).toBeGreaterThanOrEqual(1);

      const rows = allRows(db).filter((r) => r.session_id === sessionId);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('user_message');
      expect(rows[0].persona).toBe('ada');
    } finally {
      if (savedSessionDir === undefined) delete process.env.LACE_SESSION_DIR;
      else process.env.LACE_SESSION_DIR = savedSessionDir;
      rmSync(sessionRoot, { recursive: true, force: true });
    }
  });

  it('backfills events from new transcripts/<persona>/<date> layout', () => {
    const sessionId = SESSION_IDS.new;
    const dir = join(laceDir, 'transcripts', 'bea', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.session_id === sessionId)).toBe(true);
    expect(rows.every((r) => r.persona === 'bea')).toBe(true);
  });

  it('skips events already present in the index, inserting only later ones', () => {
    const sessionId = SESSION_IDS.partial;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
      promptEvent(4, 'four'),
      promptEvent(5, 'five'),
    ]);

    // Pre-seed the index with eventSeq 1 and 2
    insertRow(db, {
      event_id: `${sessionId}:1`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:01Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'one',
      track: null,
    });
    insertRow(db, {
      event_id: `${sessionId}:2`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:02Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'two',
      track: null,
    });

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.event_id)).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('is idempotent — second run inserts nothing more', () => {
    const sessionId = SESSION_IDS.idem;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'a'),
      promptEvent(2, 'b'),
      promptEvent(3, 'c'),
    ]);

    const first = backfillIndex(db, laceDir);
    const second = backfillIndex(db, laceDir);

    expect(first.inserted).toBe(3);
    expect(second).toEqual({ scanned: 0, inserted: 0, skipped: 0, errors: 0 });
    expect(allRows(db)).toHaveLength(3);
  });

  it('checks an unchanged transcript without opening it or taking a sibling writer lock', () => {
    const file = transcriptFile(SESSION_IDS.idem);
    writeJsonl(file, [promptEvent(1, 'indexed')]);
    expect(backfillIndex(db, laceDir).inserted).toBe(1);

    const open = vi.spyOn(fs, 'openSync');
    const readFile = vi.spyOn(fs, 'readFileSync');
    syncBuiltinESMExports();
    expect(backfillIndex(db, laceDir).scanned).toBe(0);
    expect(open.mock.calls.some(([name]) => name === file)).toBe(false);
    expect(readFile.mock.calls.some(([name]) => name === file)).toBe(false);

    const sibling = new Database(join(laceDir, 'recall', 'index.sqlite'));
    db.pragma('busy_timeout = 0');
    try {
      sibling
        .transaction(() => {
          expect(backfillIndex(db, laceDir)).toEqual({
            scanned: 0,
            inserted: 0,
            skipped: 0,
            errors: 0,
          });
        })
        .immediate();
    } finally {
      sibling.close();
    }
  });

  it('reads only the appended bytes after reopening the index', () => {
    const file = transcriptFile(SESSION_IDS.partial);
    const first = JSON.stringify(promptEvent(1, 'café')) + '\n';
    const next = JSON.stringify(promptEvent(2, '🧪')) + '\n';
    writeFileSync(file, first);
    expect(backfillIndex(db, laceDir).inserted).toBe(1);
    db.close();
    db = openRecallIndex(join(laceDir, 'recall', 'index.sqlite'));
    appendFileSync(file, next);

    const read = vi.spyOn(fs, 'readSync');
    syncBuiltinESMExports();
    expect(backfillIndex(db, laceDir)).toEqual({
      scanned: 1,
      inserted: 1,
      skipped: 0,
      errors: 0,
    });
    expect(read.mock.calls.map(([, , , length, position]) => [length, Number(position)])).toEqual([
      [Buffer.byteLength(next), Buffer.byteLength(first)],
    ]);
    expect(allRows(db).map((row) => row.content)).toEqual(['café', '🧪']);
  });

  it('honors a short read and leaves concurrent appends for the next pass', () => {
    const file = transcriptFile(SESSION_IDS.partial);
    writeJsonl(file, [promptEvent(1, 'opened snapshot')]);
    const read = fs.readSync;
    vi.spyOn(fs, 'readSync').mockImplementationOnce(((
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | bigint | null
    ) => {
      appendFileSync(file, JSON.stringify(promptEvent(2, 'concurrent append')) + '\n');
      return read(fd, buffer, offset, Math.min(length, 17), position);
    }) as typeof fs.readSync);
    syncBuiltinESMExports();

    expect(backfillIndex(db, laceDir).inserted).toBe(1);
    expect(allRows(db).map((row) => row.content)).toEqual(['opened snapshot']);
    expect(backfillIndex(db, laceDir).scanned).toBe(1);
    expect(allRows(db).map((row) => row.content)).toEqual(['opened snapshot', 'concurrent append']);
  });

  it('imports new day shards and fork files alongside previously indexed legacy history', () => {
    const sessionId = SESSION_IDS.legacyMix;
    const legacy = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(legacy, { recursive: true });
    writeMeta(legacy, sessionId, 'ada');
    writeJsonl(join(legacy, 'events.jsonl'), [promptEvent(1, 'legacy')]);
    writeJsonl(transcriptFile(sessionId), [promptEvent(2, 'first shard')]);
    expect(backfillIndex(db, laceDir).inserted).toBe(2);

    const fork = SESSION_IDS.newMix;
    writeJsonl(transcriptFile(sessionId, '2026-05-24'), [promptEvent(3, 'new shard')]);
    writeJsonl(transcriptFile(fork, '2026-05-24'), [promptEvent(2, 'forked copy')]);
    expect(backfillIndex(db, laceDir)).toEqual({
      scanned: 2,
      inserted: 2,
      skipped: 0,
      errors: 0,
    });
    expect(allRows(db).map((row) => [row.session_id, row.content])).toEqual([
      [sessionId, 'legacy'],
      [sessionId, 'first shard'],
      [sessionId, 'new shard'],
      [fork, 'forked copy'],
    ]);
  });

  it('imports a readable shard when another shard for the session cannot be opened', () => {
    const sessionId = SESSION_IDS.partial;
    const broken = transcriptFile(sessionId);
    symlinkSync(broken, broken);
    writeJsonl(transcriptFile(sessionId, '2026-05-24'), [promptEvent(2, 'readable shard')]);

    expect(backfillIndex(db, laceDir).inserted).toBe(1);
    expect(allRows(db).map((row) => row.content)).toEqual(['readable shard']);
  });

  it.each(['metadata', 'read'] as const)(
    'commits readable sibling shards and retries unread bytes after an open shard %s error',
    (fault) => {
      const sessionId = SESSION_IDS.partial;
      for (const date of ['2026-05-23', '2026-05-24', '2026-05-25']) {
        transcriptFile(sessionId, date);
      }
      // Use discovery's actual directory order so the fault follows one
      // readable shard and precedes another on any filesystem.
      const [before, broken, after] = fs
        .readdirSync(join(laceDir, 'transcripts', 'ada'))
        .map((date) => transcriptFile(sessionId, date));
      writeJsonl(broken, [promptEvent(1, 'saved prefix')]);
      expect(backfillIndex(db, laceDir).inserted).toBe(1);
      writeJsonl(before, [promptEvent(2, 'sibling before')]);
      writeJsonl(after, [promptEvent(5, 'sibling after')]);
      const complete = JSON.stringify(promptEvent(3, 'read before fault')) + '\n';
      const unread = JSON.stringify(promptEvent(4, 'retry after fault'));
      appendFileSync(broken, complete + unread + '\n');

      const inode = fs.statSync(broken, { bigint: true }).ino;
      const fstat = fs.fstatSync;
      const read = fs.readSync;
      const error = Object.assign(new Error('injected shard I/O failure'), { code: 'EIO' });
      if (fault === 'metadata') {
        vi.spyOn(fs, 'fstatSync').mockImplementation(((fd: number, options: { bigint: true }) => {
          const stat = fstat(fd, options);
          if (stat.ino === inode) throw error;
          return stat;
        }) as typeof fs.fstatSync);
      } else {
        let shortRead = false;
        vi.spyOn(fs, 'readSync').mockImplementation(((
          fd: number,
          buffer: Buffer,
          offset: number,
          length: number,
          position: number | bigint | null
        ) => {
          if (fstat(fd, { bigint: true }).ino !== inode) {
            return read(fd, buffer, offset, length, position);
          }
          if (shortRead) throw error;
          shortRead = true;
          return read(fd, buffer, offset, Buffer.byteLength(complete + unread), position);
        }) as typeof fs.readSync);
      }
      syncBuiltinESMExports();

      const journal = db.prepare('SELECT event_seq FROM event_journal ORDER BY event_seq').pluck();
      expect(backfillIndex(db, laceDir).inserted).toBe(fault === 'metadata' ? 2 : 3);
      expect(journal.all()).toEqual(fault === 'metadata' ? [1, 2, 5] : [1, 2, 3, 5]);
      expect(allRows(db).map((row) => row.content)).toEqual(
        fault === 'metadata'
          ? ['saved prefix', 'sibling before', 'sibling after']
          : ['saved prefix', 'sibling before', 'read before fault', 'sibling after']
      );

      vi.restoreAllMocks();
      syncBuiltinESMExports();
      const retry = fault === 'metadata' ? 2 : 1;
      expect(backfillIndex(db, laceDir)).toEqual({
        scanned: retry,
        inserted: retry,
        skipped: 0,
        errors: 0,
      });
      expect(journal.all()).toEqual([1, 2, 3, 4, 5]);
      expect(backfillIndex(db, laceDir).scanned).toBe(0);
    }
  );

  it.each(['replacement', 'shortening', 'same-size rewrite'] as const)(
    'replays a transcript after %s and skips it once caught up',
    (change) => {
      const file = transcriptFile(SESSION_IDS.partial);
      writeJsonl(file, [promptEvent(1, 'old')]);
      utimesSync(file, 1, 1);
      expect(backfillIndex(db, laceDir).inserted).toBe(1);

      if (change === 'replacement') {
        writeJsonl(file + '.new', [promptEvent(2, 'new')]);
        utimesSync(file + '.new', 1, 1);
        renameSync(file + '.new', file);
      } else {
        writeJsonl(file, [promptEvent(2, change === 'shortening' ? 'x' : 'new')]);
        utimesSync(file, 2, 2);
      }
      expect(backfillIndex(db, laceDir).inserted).toBe(1);
      expect(backfillIndex(db, laceDir).scanned).toBe(0);
      expect(allRows(db).map((row) => row.event_id)).toEqual([
        `${SESSION_IDS.partial}:1`,
        `${SESSION_IDS.partial}:2`,
      ]);
    }
  );

  it('replays a shortened transcript even when it is still larger than the prior checkpoint', () => {
    const file = transcriptFile(SESSION_IDS.partial);
    const prefix = JSON.stringify(promptEvent(1, 'old')) + '\n';
    writeFileSync(file, prefix + '{"torn":"' + 'x'.repeat(1024));
    expect(backfillIndex(db, laceDir).inserted).toBe(1);

    writeJsonl(file, [promptEvent(2, 'new'), promptEvent(3, 'tail')]);
    expect(backfillIndex(db, laceDir).inserted).toBe(2);
    expect(backfillIndex(db, laceDir).scanned).toBe(0);
    expect(allRows(db).map((row) => row.content)).toEqual(['old', 'new', 'tail']);
  });

  it('writes persona: null for events under the _unknown bucket', () => {
    const sessionId = SESSION_IDS.unknown;
    const dir = join(laceDir, 'transcripts', '_unknown', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [promptEvent(1, 'orphan')]);

    backfillIndex(db, laceDir);

    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].persona).toBeNull();
  });

  it('survives a session dir with no meta.json (legacy)', () => {
    const sessionId = SESSION_IDS.noMeta;
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeJsonl(join(sessionDir, 'events.jsonl'), [promptEvent(1, 'lonely')]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(1);
    const rows = allRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].persona).toBeNull();
  });

  it('survives malformed JSON lines without throwing', () => {
    const sessionId = SESSION_IDS.malformed;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    const good = JSON.stringify(promptEvent(1, 'good'));
    const bad = '{this is not json';
    const good2 = JSON.stringify(promptEvent(2, 'good2'));
    writeFileSync(join(dir, `${sessionId}.jsonl`), `${good}\n${bad}\n${good2}\n`, 'utf8');

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(2);
    expect(allRows(db)).toHaveLength(2);
  });

  it('returns zero stats when there are no transcript or session directories', () => {
    const stats = backfillIndex(db, laceDir);
    expect(stats).toEqual({ scanned: 0, inserted: 0, skipped: 0, errors: 0 });
  });

  it('repairs gaps in FTS even when index has higher seqs than the gap (C1/B2)', () => {
    // FTS has {1, 2, 3, 5} but JSONL has {1, 2, 3, 4, 5}. The previous
    // MAX(eventSeq) watermark logic saw MAX=5 and skipped seq 4 forever.
    // The fix uses a per-session set of event_ids, so seq 4 is detected
    // as missing regardless of higher-numbered neighbors.
    const sessionId = 'sess_aaaaaaaa-1111-4111-8111-111111111111';
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
      promptEvent(4, 'four'),
      promptEvent(5, 'five'),
    ]);
    insertRow(db, {
      event_id: `${sessionId}:1`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:01Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'one',
      track: null,
    });
    insertRow(db, {
      event_id: `${sessionId}:2`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:02Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'two',
      track: null,
    });
    insertRow(db, {
      event_id: `${sessionId}:3`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:03Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'three',
      track: null,
    });
    insertRow(db, {
      event_id: `${sessionId}:5`,
      session_id: sessionId,
      ts: '2026-05-23T00:00:05Z',
      persona: 'ada',
      kind: 'user_message',
      content: 'five',
      track: null,
    });

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(1);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('counts an event committed just before the backfill write lock as already indexed', () => {
    const sessionId = SESSION_IDS.partial;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [promptEvent(1, 'one'), promptEvent(2, 'two')]);

    const sibling = new Database(join(laceDir, 'recall', 'index.sqlite'));
    const transaction = db.transaction.bind(db);
    // Commit from a second connection before the first per-session BEGIN IMMEDIATE.
    // A membership snapshot taken before the lock won't include this event.
    const boundary = vi.spyOn(db, 'transaction').mockImplementationOnce((fn) => {
      sibling
        .prepare('INSERT INTO events (event_id, session_id, content) VALUES (?, ?, ?)')
        .run(`${sessionId}:2`, sessionId, 'sibling writer');
      return transaction(fn);
    });
    try {
      expect(backfillIndex(db, laceDir)).toEqual({
        scanned: 2,
        inserted: 1,
        skipped: 1,
        errors: 0,
      });
      expect(allRows(db).map((r) => r.content)).toEqual(['one', 'sibling writer']);
    } finally {
      boundary.mockRestore();
      sibling.close();
    }
  });

  it('uses the checkpoint a sibling backfill committed before the write lock', () => {
    writeJsonl(transcriptFile(SESSION_IDS.partial), [promptEvent(1, 'sibling backfill')]);
    const sibling = openRecallIndex(join(laceDir, 'recall', 'index.sqlite'));
    const transaction = db.transaction.bind(db);
    const boundary = vi.spyOn(db, 'transaction').mockImplementationOnce((fn) => {
      expect(backfillIndex(sibling, laceDir).inserted).toBe(1);
      return transaction(fn);
    });
    try {
      expect(backfillIndex(db, laceDir)).toEqual({
        scanned: 0,
        inserted: 0,
        skipped: 0,
        errors: 0,
      });
      expect(allRows(db).map((row) => row.content)).toEqual(['sibling backfill']);
    } finally {
      boundary.mockRestore();
      sibling.close();
    }
  });

  it('retains prior byte progress when a transaction rolls back successful catch-up writes', () => {
    const file = transcriptFile(SESSION_IDS.partial);
    writeJsonl(file, [promptEvent(1, 'committed prefix')]);
    expect(backfillIndex(db, laceDir).inserted).toBe(1);
    appendFileSync(file, JSON.stringify(promptEvent(2, 'uncommitted suffix')) + '\n');

    expect(() =>
      db
        .transaction(() => {
          expect(backfillIndex(db, laceDir).inserted).toBe(1);
          throw new Error('abort after catch-up');
        })
        .immediate()
    ).toThrow('abort after catch-up');
    expect(allRows(db).map((row) => row.content)).toEqual(['committed prefix']);
    expect(backfillIndex(db, laceDir)).toEqual({
      scanned: 1,
      inserted: 1,
      skipped: 0,
      errors: 0,
    });
    expect(allRows(db).map((row) => row.content)).toEqual([
      'committed prefix',
      'uncommitted suffix',
    ]);
  });

  it('rolls back a failed FTS row while retaining successful rows in the session', () => {
    const sessionId = SESSION_IDS.partial;
    const dir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(dir, { recursive: true });
    writeJsonl(join(dir, `${sessionId}.jsonl`), [
      promptEvent(1, 'one'),
      promptEvent(2, 'two'),
      promptEvent(3, 'three'),
    ]);
    // Fail the marker write only after the FTS row exists. The outer session
    // transaction catches the error and must still commit the other rows.
    db.exec(`
      CREATE TRIGGER reject_marker BEFORE INSERT ON _meta
      WHEN NEW.key = 'events_last_rowid'
        AND EXISTS (SELECT 1 FROM events WHERE event_id = '${sessionId}:2')
      BEGIN
        SELECT RAISE(ABORT, 'injected marker failure');
      END;
    `);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(backfillIndex(db, laceDir)).toEqual({
        scanned: 3,
        inserted: 2,
        skipped: 0,
        errors: 1,
      });
      expect(allRows(db).map((r) => r.content)).toEqual(['one', 'three']);
      expect(db.prepare('SELECT event_id FROM event_keys ORDER BY event_id').pluck().all()).toEqual(
        [`${sessionId}:1`, `${sessionId}:3`]
      );
      expect(
        db.prepare('SELECT event_seq FROM event_journal ORDER BY event_seq').pluck().all()
      ).toEqual([1, 2, 3]);

      db.exec('DROP TRIGGER reject_marker');
      expect(backfillIndex(db, laceDir)).toEqual({
        scanned: 2,
        inserted: 1,
        skipped: 1,
        errors: 0,
      });
      expect(allRows(db).map((r) => r.content)).toEqual(['one', 'two', 'three']);
    } finally {
      error.mockRestore();
    }
  });

  it('does not skip legacy events when new-layout for same session is processed first (C1/A1)', () => {
    // The previous code computed MAX(eventSeq) once per file. When the
    // new-layout pass ran first for a session, it raised the per-session
    // MAX above the legacy file's seqs, and the legacy events were silently
    // dropped from the index forever. Per-session set of event_ids fixes it.
    const sessionId = 'sess_bbbbbbbb-2222-4222-8222-222222222222';
    const legacyDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, sessionId, 'ada');
    writeJsonl(join(legacyDir, 'events.jsonl'), [
      promptEvent(1, 'legacy-1'),
      promptEvent(2, 'legacy-2'),
      promptEvent(3, 'legacy-3'),
    ]);
    const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(newDir, { recursive: true });
    writeJsonl(join(newDir, `${sessionId}.jsonl`), [
      promptEvent(4, 'new-4'),
      promptEvent(5, 'new-5'),
    ]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(5);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([
      `${sessionId}:1`,
      `${sessionId}:2`,
      `${sessionId}:3`,
      `${sessionId}:4`,
      `${sessionId}:5`,
    ]);
  });

  it('one malformed event does not roll back inserts from other rows in the session (C2)', () => {
    // A message event without `content` would throw inside eventToRow under
    // the old implementation; the throw aborted the whole-pass transaction
    // and rolled back every other insert. With per-session txn + hardened
    // eventToRow, the bad row is skipped (or counted as an error) but the
    // good rows commit.
    const sessionId = 'sess_cccccccc-3333-4333-8333-333333333333';
    const sessionDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeMeta(sessionDir, sessionId, 'ada');
    const badMessage: DurableEvent = {
      eventSeq: 2,
      timestamp: '2026-05-23T00:00:02Z',
      type: 'message',
      data: { role: 'assistant' }, // NO content
    };
    writeJsonl(join(sessionDir, 'events.jsonl'), [
      promptEvent(1, 'good-1'),
      badMessage,
      promptEvent(3, 'good-3'),
    ]);

    const stats = backfillIndex(db, laceDir);

    // Two good rows landed; the bad row was skipped (returned null) not
    // counted as error since eventToRow tolerates missing content now.
    expect(stats.inserted).toBe(2);
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => r.event_id).sort()).toEqual([`${sessionId}:1`, `${sessionId}:3`]);
  });

  it('retains later events but keeps retrying a failed FTS conversion', () => {
    const sessionId = SESSION_IDS.malformed;
    writeJsonl(transcriptFile(sessionId), [
      promptEvent(1, 'before'),
      {
        eventSeq: 2,
        timestamp: '2026-05-23T00:00:02Z',
        type: 'context_compacted',
        data: { strategy: { toString: null, valueOf: null } },
      },
      promptEvent(3, 'after'),
    ]);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(backfillIndex(db, laceDir)).toEqual({
      scanned: 3,
      inserted: 2,
      skipped: 0,
      errors: 1,
    });
    expect(backfillIndex(db, laceDir)).toEqual({
      scanned: 2,
      inserted: 0,
      skipped: 1,
      errors: 1,
    });
    expect(allRows(db).map((row) => row.content)).toEqual(['before', 'after']);
    expect(
      db.prepare('SELECT event_seq FROM event_journal ORDER BY event_seq').pluck().all()
    ).toEqual([1, 2, 3]);
  });

  it('one malformed event in session A does not roll back session B (C2)', () => {
    // Cross-session isolation: per-session transactions ensure a bad row in
    // one session can't poison another. Even if session A throws inside its
    // transaction, session B's rows still commit.
    const sessionA = 'sess_dddddddd-4444-4444-8444-444444444444';
    const sessionB = 'sess_eeeeeeee-5555-4555-8555-555555555555';
    const dirA = join(laceDir, 'agent-sessions', sessionA);
    mkdirSync(dirA, { recursive: true });
    writeMeta(dirA, sessionA, 'ada');
    writeJsonl(join(dirA, 'events.jsonl'), [
      promptEvent(1, 'a-good'),
      { eventSeq: 2, timestamp: 'x', type: 'message', data: { role: 'assistant' } },
    ]);

    const dirB = join(laceDir, 'agent-sessions', sessionB);
    mkdirSync(dirB, { recursive: true });
    writeMeta(dirB, sessionB, 'bea');
    writeJsonl(join(dirB, 'events.jsonl'), [promptEvent(1, 'b-one'), promptEvent(2, 'b-two')]);

    backfillIndex(db, laceDir);

    const rowsB = allRows(db).filter((r) => r.session_id === sessionB);
    expect(rowsB.map((r) => r.event_id).sort()).toEqual([`${sessionB}:1`, `${sessionB}:2`]);
  });

  it('uses new-layout persona for legacy events when meta.json lacks a persona field (S5)', () => {
    const sessionId = 'sess_eaeaeaea-1111-4111-8111-aaaaaaaaaaaa';

    // Legacy meta.json without persona field, plus legacy events.jsonl
    const legacyDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, sessionId, null);
    writeJsonl(join(legacyDir, 'events.jsonl'), [promptEvent(1, 'legacy event')]);

    // New-layout file under persona 'ada' for the SAME sessionId
    const newDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(newDir, { recursive: true });
    writeJsonl(join(newDir, `${sessionId}.jsonl`), [promptEvent(2, 'new event')]);

    backfillIndex(db, laceDir);

    // Both events should be attributed to persona='ada' — legacy via fallback
    // to the new-layout persona bucket, new via direct path read.
    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => ({ event_id: r.event_id, persona: r.persona }))).toEqual([
      { event_id: `${sessionId}:1`, persona: 'ada' },
      { event_id: `${sessionId}:2`, persona: 'ada' },
    ]);
  });

  it('falls back to null when meta lacks persona and all new-layout files are under _unknown (S5)', () => {
    const sessionId = 'sess_efefefef-2222-4222-8222-bbbbbbbbbbbb';

    const legacyDir = join(laceDir, 'agent-sessions', sessionId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, sessionId, null);
    writeJsonl(join(legacyDir, 'events.jsonl'), [promptEvent(1, 'legacy event')]);

    // New-layout file under _unknown bucket — no real persona to recover.
    const unkDir = join(laceDir, 'transcripts', '_unknown', '2026-05-23');
    mkdirSync(unkDir, { recursive: true });
    writeJsonl(join(unkDir, `${sessionId}.jsonl`), [promptEvent(2, 'unknown event')]);

    backfillIndex(db, laceDir);

    const rows = allRows(db).filter((r) => r.session_id === sessionId);
    expect(rows.map((r) => ({ event_id: r.event_id, persona: r.persona }))).toEqual([
      { event_id: `${sessionId}:1`, persona: null },
      { event_id: `${sessionId}:2`, persona: null },
    ]);
  });

  it('ignores directories that do not match sessionId shape (H3)', () => {
    const legacyRoot = join(laceDir, 'agent-sessions');
    mkdirSync(legacyRoot, { recursive: true });

    // Stray directory with events.jsonl but non-session name — must be ignored
    const stray = join(legacyRoot, 'tmp-leftover');
    mkdirSync(stray, { recursive: true });
    writeJsonl(join(stray, 'events.jsonl'), [promptEvent(1, 'stray garbage')]);

    // Another stray with a vaguely-session-looking-but-wrong name
    const stray2 = join(legacyRoot, 'sessionXYZ');
    mkdirSync(stray2, { recursive: true });
    writeJsonl(join(stray2, 'events.jsonl'), [promptEvent(1, 'wrong prefix')]);

    // Legitimate session
    const realId = 'sess_aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const realDir = join(legacyRoot, realId);
    mkdirSync(realDir, { recursive: true });
    writeMeta(realDir, realId, 'ada');
    writeJsonl(join(realDir, 'events.jsonl'), [promptEvent(1, 'real event')]);

    backfillIndex(db, laceDir);

    const sessions = db.prepare(`SELECT DISTINCT session_id FROM events`).all() as Array<{
      session_id: string;
    }>;
    expect(sessions.map((s) => s.session_id)).toEqual([realId]);
  });

  it('rejects loose sess_ prefix that recall.read would not accept (legacy layout)', () => {
    // The previous SESSION_ID_RE was `/^sess_[0-9a-f][0-9a-f-]*$/`, which
    // accepted `sess_a` and `sess_abc` — backfill would index them, recall.search
    // would surface them, then recall.read (which uses the strict SessionIdSchema
    // from @lace/ent-protocol) would reject them. Search/read disagreement.
    // Enforce the canonical sess_<uuid> shape in backfill so the index never
    // contains rows recall.read can't follow.
    const legacyRoot = join(laceDir, 'agent-sessions');
    mkdirSync(legacyRoot, { recursive: true });

    for (const looseId of ['sess_a', 'sess_abc', 'sess_deadbeef']) {
      const dir = join(legacyRoot, looseId);
      mkdirSync(dir, { recursive: true });
      writeMeta(dir, looseId, 'ada');
      writeJsonl(join(dir, 'events.jsonl'), [promptEvent(1, `loose ${looseId}`)]);
    }

    const realId = 'sess_aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const realDir = join(legacyRoot, realId);
    mkdirSync(realDir, { recursive: true });
    writeMeta(realDir, realId, 'ada');
    writeJsonl(join(realDir, 'events.jsonl'), [promptEvent(1, 'real event')]);

    backfillIndex(db, laceDir);

    const sessions = db.prepare(`SELECT DISTINCT session_id FROM events`).all() as Array<{
      session_id: string;
    }>;
    expect(sessions.map((s) => s.session_id)).toEqual([realId]);
  });

  it('rejects loose sess_ prefix in new-layout filenames', () => {
    const personaDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(personaDir, { recursive: true });

    // Loose-shape ids matching the old regex but not the strict UUID shape
    writeJsonl(join(personaDir, 'sess_a.jsonl'), [promptEvent(1, 'loose-a')]);
    writeJsonl(join(personaDir, 'sess_abc.jsonl'), [promptEvent(1, 'loose-abc')]);

    const realId = 'sess_bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    writeJsonl(join(personaDir, `${realId}.jsonl`), [promptEvent(1, 'real event')]);

    backfillIndex(db, laceDir);

    const sessions = db.prepare(`SELECT DISTINCT session_id FROM events`).all() as Array<{
      session_id: string;
    }>;
    expect(sessions.map((s) => s.session_id)).toEqual([realId]);
  });

  it('ignores new-layout files whose basename is not a valid sessionId (H3)', () => {
    const personaDir = join(laceDir, 'transcripts', 'ada', '2026-05-23');
    mkdirSync(personaDir, { recursive: true });

    // Stray jsonl with non-session name
    writeJsonl(join(personaDir, 'tmp-foo.jsonl'), [promptEvent(1, 'tmp garbage')]);
    writeJsonl(join(personaDir, 'notsess.jsonl'), [promptEvent(1, 'wrong prefix')]);

    // Legitimate session file
    const realId = 'sess_bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    writeJsonl(join(personaDir, `${realId}.jsonl`), [promptEvent(1, 'real event')]);

    backfillIndex(db, laceDir);

    const sessions = db.prepare(`SELECT DISTINCT session_id FROM events`).all() as Array<{
      session_id: string;
    }>;
    expect(sessions.map((s) => s.session_id)).toEqual([realId]);
  });

  it('handles both layouts present at once', () => {
    // Legacy
    const legacyId = SESSION_IDS.legacyMix;
    const legacyDir = join(laceDir, 'agent-sessions', legacyId);
    mkdirSync(legacyDir, { recursive: true });
    writeMeta(legacyDir, legacyId, 'ada');
    writeJsonl(join(legacyDir, 'events.jsonl'), [promptEvent(1, 'legacy-1')]);

    // New
    const newId = SESSION_IDS.newMix;
    const newDir = join(laceDir, 'transcripts', 'bea', '2026-05-23');
    mkdirSync(newDir, { recursive: true });
    writeJsonl(join(newDir, `${newId}.jsonl`), [promptEvent(1, 'new-1'), promptEvent(2, 'new-2')]);

    const stats = backfillIndex(db, laceDir);

    expect(stats.inserted).toBe(3);
    const rows = allRows(db);
    expect(rows).toHaveLength(3);
    const legacyRows = rows.filter((r) => r.session_id === legacyId);
    const newRows = rows.filter((r) => r.session_id === newId);
    expect(legacyRows).toHaveLength(1);
    expect(legacyRows[0].persona).toBe('ada');
    expect(newRows).toHaveLength(2);
    expect(newRows.every((r) => r.persona === 'bea')).toBe(true);
  });
});
