// ABOUTME: Catches up recall from transcript bytes after each file's durable checkpoint
// ABOUTME: Commits contiguous progress together with FTS and verbatim journal rows

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSessionId } from '@lace/ent-protocol';
import type { Db } from './index-db';
import { listTranscriptFiles, transcriptsRoot, UNKNOWN_PERSONA_BUCKET } from '../transcript-paths';
import { eventToRow } from './event-to-row';
import { reconcileEventKeys } from './event-keys';
import { insertRow, insertJournalRow } from './index-writer';
import {
  readTranscriptLines,
  transcriptCheckpoints,
  transcriptStart,
} from './transcript-checkpoints';
import { agentSessionsDir, readSessionMeta } from '../session-store';
import type { TypedDurableEvent } from '../event-types';
import type { DurableEvent } from '../event-log';

export type BackfillStats = {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
};

// Sessions are minted as `sess_<uuid>` (see ent-protocol/src/ids.ts). Stray
// directories under agent-sessions/ (e.g. `tmp-*`, leftover test scaffolding)
// must NOT pollute the FTS index — they end up as garbage rows like
// `tmp-foo:1` (H3). Same shape applies to `<sessionId>.jsonl` files in the
// new layout.
//
// Reuse the canonical SessionIdSchema-backed validator from ent-protocol so
// backfill's "is this a real session?" gate stays in lockstep with
// recall.read's strict sess_<uuid> requirement (asSessionId). A loose match
// here would let search index rows that recall.read then refuses to follow,
// causing search/read disagreement.
function isValidSessionId(name: string): boolean {
  return isSessionId(name);
}

type SessionPass = {
  sessionId: string;
  filePath: string;
  persona: string | null;
};

export function backfillIndex(db: Db, laceDir: string): BackfillStats {
  const stats: BackfillStats = { scanned: 0, inserted: 0, skipped: 0, errors: 0 };

  // Collect every file we need to scan up front. The order matters less now
  // that we use a per-session set of indexed event_ids (instead of a single
  // MAX watermark): each pass enumerates one file, but a session can be
  // present in both legacy and new-layout files and we must dedupe by
  // event_id across passes.
  const passes: SessionPass[] = [];
  collectNewLayout(laceDir, passes);
  collectLegacyLayout(laceDir, passes);

  // Group passes by sessionId so we issue ONE "what do we already have?" query
  // per session, then iterate every file for that session against the same
  // in-memory set. Memory cost is bounded by events-per-session, not total
  // events, and we never compare against a moving MAX watermark.
  const passesBySession = new Map<string, SessionPass[]>();
  for (const p of passes) {
    const list = passesBySession.get(p.sessionId) ?? [];
    list.push(p);
    passesBySession.set(p.sessionId, list);
  }

  const haveStmt = db.prepare('SELECT event_id FROM event_keys WHERE session_id = ?');
  const checkpoints = transcriptCheckpoints(db);

  for (const [sessionId, sessionPasses] of passesBySession) {
    // One transaction per session, NOT one transaction for the whole pass.
    // C2 requires that one malformed row not roll back unrelated sessions'
    // inserts. Per-row try/catch inside the transaction skips bad rows
    // without aborting the rest of this session.
    //
    // `.immediate()` opens the transaction with `BEGIN IMMEDIATE` so the
    // write lock is acquired upfront, serializing this session's
    // check-then-insert against concurrent backfill / runtime writers from
    // other processes (H2). With default DEFERRED, two backfills could both
    // pass the existence check and both INSERT, duplicating FTS rows.
    try {
      const pending = sessionPasses.filter(({ filePath }) => {
        let file: fs.BigIntStats;
        try {
          file = fs.statSync(filePath, { bigint: true });
        } catch {
          return false;
        }
        return file.isFile() && transcriptStart(file, checkpoints.get(filePath)) !== null;
      });
      if (pending.length === 0) continue;

      const run = db.transaction(() => {
        let have: Set<string> | undefined;
        const indexedIds = () => {
          if (!have) {
            reconcileEventKeys(db);
            have = new Set(
              (haveStmt.all(sessionId) as Array<{ event_id: string }>).map((r) => r.event_id)
            );
          }
          return have;
        };
        for (const pass of pending) {
          catchUpFile(db, pass, checkpoints, indexedIds, stats);
        }
      }).immediate;
      run();
    } catch (err) {
      // Transaction-level failure (rare: e.g. SQLite I/O). Count as a session
      // error and move on so we don't poison other sessions.
      stats.errors++;
      console.error(`recall backfill: session ${sessionId} transaction failed:`, err);
    }
  }

  return stats;
}

function collectNewLayout(laceDir: string, out: SessionPass[]): void {
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
        if (!isValidSessionId(sessionId)) continue;
        out.push({ sessionId, filePath: path.join(dateDir, file), persona: personaForRow });
      }
    }
  }
}

function collectLegacyLayout(laceDir: string, out: SessionPass[]): void {
  // Use agentSessionsDir() so LACE_SESSION_DIR / XDG_STATE_HOME / HOME / tmpdir
  // fallback paths are visible to backfill. Previously hardcoded to
  // <laceDir>/agent-sessions which silently missed sessions under any override
  // (H11).
  const legacyRoot = agentSessionsDir();
  if (!existsAsDir(legacyRoot)) return;
  for (const sessionId of safeReaddir(legacyRoot)) {
    if (!isValidSessionId(sessionId)) continue;
    const sessionDir = path.join(legacyRoot, sessionId);
    if (!existsAsDir(sessionDir)) continue;
    const eventsFile = path.join(sessionDir, 'events.jsonl');
    if (!fs.existsSync(eventsFile)) continue;
    // When meta.json doesn't carry a persona (legacy sessions, or sessions
    // whose meta predates persona tracking), fall back to the persona under
    // which the new-layout transcript files for this same sessionId live.
    // This keeps legacy events attributed correctly in FTS instead of
    // landing under persona=null while their new-layout siblings have a
    // real persona (S5).
    const persona = readPersonaSafe(sessionDir) ?? newLayoutPersonaForSession(laceDir, sessionId);
    out.push({ sessionId, filePath: eventsFile, persona });
  }
}

/**
 * Inspect the new-layout transcript tree for any files belonging to `sessionId`
 * and return the persona bucket they sit under. Returns `null` if no
 * new-layout files exist or all of them are in the `_unknown` bucket (in
 * which case we have no real persona to recover).
 */
function newLayoutPersonaForSession(laceDir: string, sessionId: string): string | null {
  let files: string[] = [];
  try {
    files = listTranscriptFiles(laceDir, sessionId);
  } catch {
    return null;
  }
  for (const file of files) {
    // file is <laceDir>/transcripts/<persona>/<date>/<sessionId>.jsonl
    // The persona segment is the parent of the date directory.
    const dateDir = path.dirname(file);
    const personaDir = path.basename(path.dirname(dateDir));
    if (personaDir !== UNKNOWN_PERSONA_BUCKET) {
      return personaDir;
    }
  }
  return null;
}

function catchUpFile(
  db: Db,
  pass: SessionPass,
  checkpoints: ReturnType<typeof transcriptCheckpoints>,
  indexedIds: () => Set<string>,
  stats: BackfillStats
): void {
  let fd: number;
  try {
    fd = fs.openSync(pass.filePath, 'r');
  } catch {
    return;
  }
  try {
    // A sibling can finish catch-up before we acquire the write lock, or
    // the path can change between discovery and open. Use the locked
    // checkpoint and the opened descriptor to choose the byte range.
    let file: fs.BigIntStats;
    try {
      file = fs.fstatSync(fd, { bigint: true });
    } catch {
      return;
    }
    if (!file.isFile()) return;
    const start = transcriptStart(file, checkpoints.get(pass.filePath));
    if (start === null) return;

    let offset = start;
    let contiguous = true;
    for (const { line, end } of readTranscriptLines(fd, start, file.size)) {
      const processed = catchUpLine(db, pass, indexedIds, line, stats);
      // A failed record remains the first byte to retry, even if later
      // records succeed. An unterminated line never advances the offset.
      contiguous &&= processed;
      if (contiguous && end !== null) offset = end;
    }
    checkpoints.save(pass.filePath, file, offset);
  } finally {
    fs.closeSync(fd);
  }
}

function catchUpLine(
  db: Db,
  pass: SessionPass,
  indexedIds: () => Set<string>,
  line: string,
  stats: BackfillStats
): boolean {
  if (!line) return true;
  let ev: DurableEvent | null;
  try {
    ev = JSON.parse(line) as DurableEvent | null;
  } catch {
    return true;
  }
  stats.scanned++;
  if (typeof ev?.eventSeq !== 'number') {
    stats.skipped++;
    return true;
  }
  const eventId = `${pass.sessionId}:${ev.eventSeq}`;
  const have = indexedIds();

  // The journal stores the original line, including for events excluded from
  // FTS. A failed journal row can be retried independently of its FTS row.
  let journaled = true;
  try {
    insertJournalRow(db, {
      session_id: pass.sessionId,
      event_seq: ev.eventSeq,
      type: typeof ev.type === 'string' ? ev.type : 'unknown',
      ts: typeof ev.timestamp === 'string' ? ev.timestamp : '',
      line,
    });
  } catch (err) {
    if (!db.inTransaction) throw err;
    journaled = false;
    console.error(`recall backfill: insertJournalRow failed for ${eventId}:`, err);
  }

  if (have.has(eventId)) {
    stats.skipped++;
    return journaled;
  }
  let row;
  try {
    row = eventToRow(ev as TypedDurableEvent, {
      sessionId: pass.sessionId,
      persona: pass.persona,
    });
  } catch (err) {
    stats.errors++;
    console.error(`recall backfill: eventToRow failed for ${eventId}:`, err);
    return false;
  }
  if (!row) {
    stats.skipped++;
    return journaled;
  }
  try {
    insertRow(db, row);
    have.add(eventId);
    stats.inserted++;
    return journaled;
  } catch (err) {
    if (!db.inTransaction) throw err;
    stats.errors++;
    console.error(`recall backfill: insertRow failed for ${eventId}:`, err);
    return false;
  }
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
