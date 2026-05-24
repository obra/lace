// ABOUTME: One-time-per-startup scan of JSONL files; insert any events missing from FTS
// ABOUTME: Catches up sessions whose JSONL pre-dates write-through indexing

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './index-db';
import { listTranscriptFiles, transcriptsRoot, UNKNOWN_PERSONA_BUCKET } from '../transcript-paths';
import { eventToRow } from './event-to-row';
import { insertRow } from './index-writer';
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
const SESSION_ID_RE = /^sess_[0-9a-f][0-9a-f-]*$/;

function isValidSessionId(name: string): boolean {
  return SESSION_ID_RE.test(name);
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

  const haveStmt = db.prepare(`SELECT event_id FROM events WHERE session_id = ?`);

  for (const [sessionId, sessionPasses] of passesBySession) {
    const have = new Set<string>(
      (haveStmt.all(sessionId) as Array<{ event_id: string }>).map((r) => r.event_id)
    );
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
      const run = db.transaction(() => {
        for (const pass of sessionPasses) {
          catchUpFile(db, pass, have, stats);
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

function catchUpFile(db: Db, pass: SessionPass, have: Set<string>, stats: BackfillStats): void {
  for (const ev of readEvents(pass.filePath)) {
    stats.scanned++;
    if (typeof ev.eventSeq !== 'number') {
      stats.skipped++;
      continue;
    }
    const eventId = `${pass.sessionId}:${ev.eventSeq}`;
    if (have.has(eventId)) {
      stats.skipped++;
      continue;
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
      continue;
    }
    if (!row) {
      stats.skipped++;
      continue;
    }
    try {
      insertRow(db, row);
      have.add(eventId);
      stats.inserted++;
    } catch (err) {
      stats.errors++;
      console.error(`recall backfill: insertRow failed for ${eventId}:`, err);
    }
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
