// ABOUTME: One-time-per-startup scan of JSONL files; insert any events missing from FTS
// ABOUTME: Catches up sessions whose JSONL pre-dates write-through indexing

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './index-db';
import { transcriptsRoot, UNKNOWN_PERSONA_BUCKET } from '../transcript-paths';
import { eventToRow } from './event-to-row';
import { insertRow } from './index-writer';
import { readSessionMeta } from '../session-store';
import type { TypedDurableEvent } from '../event-types';
import type { DurableEvent } from '../event-log';

export type BackfillStats = {
  scanned: number;
  inserted: number;
};

export function backfillIndex(db: Db, laceDir: string): BackfillStats {
  let scanned = 0;
  let inserted = 0;

  const haveStmt = db.prepare(
    `SELECT MAX(CAST(SUBSTR(event_id, INSTR(event_id, ':') + 1) AS INTEGER)) AS maxSeq
     FROM events WHERE session_id = ?`
  );
  const maxSeqFor = (sessionId: string): number => {
    const row = haveStmt.get(sessionId) as { maxSeq: number | null } | undefined;
    return row?.maxSeq ?? 0;
  };

  // Wrap inserts in a transaction. Each `insertRow` is a SELECT-then-INSERT
  // pair; without a transaction better-sqlite3 fsyncs the WAL on every
  // statement, which dominates wall time on real datasets (~3s for ~4k
  // inserts versus a fraction of that inside a transaction).
  const run = db.transaction(() => {
    backfillNewLayout(db, laceDir, maxSeqFor, (delta) => {
      scanned += delta.scanned;
      inserted += delta.inserted;
    });
    backfillLegacyLayout(db, laceDir, maxSeqFor, (delta) => {
      scanned += delta.scanned;
      inserted += delta.inserted;
    });
  });
  run();

  return { scanned, inserted };
}

type Tally = { scanned: number; inserted: number };
type TallyFn = (delta: Tally) => void;

function backfillNewLayout(
  db: Db,
  laceDir: string,
  maxSeqFor: (sessionId: string) => number,
  tally: TallyFn
): void {
  const root = transcriptsRoot(laceDir);
  if (!existsAsDir(root)) return;
  for (const persona of safeReaddir(root)) {
    const personaDir = path.join(root, persona);
    if (!existsAsDir(personaDir)) continue;
    const personaForRow = persona === UNKNOWN_PERSONA_BUCKET ? null : persona;
    for (const date of safeReaddir(personaDir)) {
      const dateDir = path.join(personaDir, date);
      if (!existsAsDir(dateDir)) continue;
      for (const file of safeReaddir(dateDir)) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.slice(0, -'.jsonl'.length);
        catchUpSession(db, path.join(dateDir, file), sessionId, personaForRow, maxSeqFor, tally);
      }
    }
  }
}

function backfillLegacyLayout(
  db: Db,
  laceDir: string,
  maxSeqFor: (sessionId: string) => number,
  tally: TallyFn
): void {
  const legacyRoot = path.join(laceDir, 'agent-sessions');
  if (!existsAsDir(legacyRoot)) return;
  for (const sessionId of safeReaddir(legacyRoot)) {
    const sessionDir = path.join(legacyRoot, sessionId);
    if (!existsAsDir(sessionDir)) continue;
    const eventsFile = path.join(sessionDir, 'events.jsonl');
    if (!fs.existsSync(eventsFile)) continue;
    const persona = readPersonaSafe(sessionDir);
    catchUpSession(db, eventsFile, sessionId, persona, maxSeqFor, tally);
  }
}

function catchUpSession(
  db: Db,
  filePath: string,
  sessionId: string,
  persona: string | null,
  maxSeqFor: (sessionId: string) => number,
  tally: TallyFn
): void {
  const have = maxSeqFor(sessionId);
  let scanned = 0;
  let inserted = 0;
  for (const ev of readEvents(filePath)) {
    scanned++;
    if (ev.eventSeq <= have) continue;
    const row = eventToRow(ev as TypedDurableEvent, { sessionId, persona });
    if (!row) continue;
    insertRow(db, row);
    inserted++;
  }
  tally({ scanned, inserted });
}

function existsAsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(p: string): string[] {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
}

function readPersonaSafe(sessionDir: string): string | null {
  try {
    return readSessionMeta(sessionDir).persona ?? null;
  } catch {
    return null;
  }
}

function* readEvents(filePath: string): Generator<DurableEvent> {
  let raw = '';
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      yield JSON.parse(line) as DurableEvent;
    } catch {
      // skip malformed line (e.g. partial write)
    }
  }
}
