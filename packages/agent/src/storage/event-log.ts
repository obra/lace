// ABOUTME: Durable event persistence layer for session events
// ABOUTME: Handles reading, writing, and summarizing events from JSONL transcripts

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getLaceDir } from '../config/lace-dir';
import { agentSessionsDir, readSessionMeta, type SessionState } from './session-store';
import {
  listTranscriptFiles,
  transcriptFilePath,
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
} from './transcript-paths';
import { eventToRow } from './recall/event-to-row';
import { getRecallIndex } from './recall/index-db';
import { insertRow } from './recall/index-writer';
import type { TypedDurableEvent } from './event-types';

/**
 * Cache: sessionDir → persona, populated on first lookup. Persona is immutable
 * for a session's lifetime once meta.json is written, so the cache survives
 * without invalidation in production. We deliberately do NOT cache `null`
 * results: an early append can land before meta.json is committed (the session
 * has been mkdir'd but writeSessionMeta hasn't run yet), and caching that
 * miss would poison every subsequent append in this process — splitting the
 * session across `_unknown/` and the real persona bucket. The cost of a
 * miss is one stat() call per append, which is short-lived because
 * writeSessionMeta also invalidates this cache entry.
 *
 * Tests that reuse a sessionDir across logical sessions (e.g. by rewriting
 * meta.json) call `invalidatePersonaCache` to reset it.
 */
const personaCache = new Map<string, string>();

export function invalidatePersonaCache(sessionDir?: string): void {
  if (sessionDir === undefined) {
    personaCache.clear();
  } else {
    personaCache.delete(sessionDir);
  }
}

/**
 * Resolves the legacy events.jsonl path for a session, honoring the same
 * fallback chain (LACE_SESSION_DIR / XDG_STATE_HOME / HOME / tmpdir) that
 * agentSessionsDir() uses. Use everywhere the legacy file location is needed
 * so that LACE_SESSION_DIR overrides remain visible to readers and writers.
 */
export function legacyEventLogPath(sessionId: string): string {
  return path.join(agentSessionsDir(), sessionId, 'events.jsonl');
}

function personaForSessionDir(sessionDir: string): string | null {
  const cached = personaCache.get(sessionDir);
  if (cached !== undefined) return cached;
  let persona: string | null = null;
  try {
    const meta = readSessionMeta(sessionDir);
    persona = meta.persona ?? null;
  } catch {
    persona = null;
  }
  if (persona !== null) personaCache.set(sessionDir, persona);
  return persona;
}

/**
 * Return every JSONL line that belongs to this session, in eventSeq-emit order.
 *
 * The legacy <sessionDir>/events.jsonl path is read alongside the new
 * <laceDir>/transcripts/<persona>/<date>/<session>.jsonl files. No one-time
 * migration is performed; the dual-read is permanent. See
 * docs/specs/recall-spec.md §Migration.
 *
 * Lines from the legacy file come first (they were emitted before the layout
 * change), followed by new-layout files in ascending date order. Within each
 * file lines are in append order, which is also eventSeq order.
 */
export function readAllSessionEventLines(sessionDir: string): string[] {
  const sessionId = path.basename(sessionDir);
  let newFiles: string[] = [];
  try {
    newFiles = listTranscriptFiles(getLaceDir(), sessionId);
  } catch {
    newFiles = [];
  }
  const legacyPath = path.join(sessionDir, 'events.jsonl');
  const files = fs.existsSync(legacyPath) ? [legacyPath, ...newFiles] : newFiles;

  const lines: string[] = [];
  for (const file of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (line) lines.push(line);
    }
  }
  return lines;
}

export function deriveNextEventSeqFromEventLog(sessionDir: string): number {
  let maxSeq: number | undefined;
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      const seq = parsed.eventSeq;
      if (typeof seq !== 'number' || !Number.isInteger(seq)) continue;
      if (maxSeq === undefined || seq > maxSeq) maxSeq = seq;
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }
  return (maxSeq ?? 0) + 1;
}

/**
 * Like `deriveNextEventSeqFromEventLog`, but resolves files purely from a
 * laceDir + sessionId without needing the sessionDir. Used by callers (such as
 * `appendDurableEvent` itself) that have the sessionId but want to avoid the
 * indirection through `readAllSessionEventLines`. Reads both the new layout
 * and the legacy `<laceDir>/agent-sessions/<sessionId>/events.jsonl` path.
 */
export function deriveNextEventSeqAcrossSessionFiles(laceDir: string, sessionId: string): number {
  const files: string[] = [];
  const legacyPath = path.join(laceDir, 'agent-sessions', sessionId, 'events.jsonl');
  if (fs.existsSync(legacyPath)) files.push(legacyPath);
  try {
    for (const f of listTranscriptFiles(laceDir, sessionId)) files.push(f);
  } catch {
    // Ignore — root may not exist yet.
  }

  let maxSeq = 0;
  for (const file of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as Partial<DurableEvent>;
        if (
          typeof parsed.eventSeq === 'number' &&
          Number.isInteger(parsed.eventSeq) &&
          parsed.eventSeq > maxSeq
        ) {
          maxSeq = parsed.eventSeq;
        }
      } catch {
        // ignore malformed
      }
    }
  }
  return maxSeq + 1;
}

/**
 * Returns true if there are any `context_injected` events with
 * `priority='immediate'` in the transcript whose `eventSeq` is strictly
 * greater than `afterEventSeq`. Used by the prompt handler to detect
 * notifications that landed during a turn but were not picked up
 * before turn_end was written (Bug 3 race condition).
 */
export function hasPendingImmediateInjects(sessionDir: string, afterEventSeq: number): boolean {
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type !== 'context_injected') continue;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (parsed.eventSeq <= afterEventSeq) continue;
      const data = parsed.data as { priority?: unknown } | undefined;
      if (data?.priority !== 'immediate') continue;
      return true;
    } catch {
      // ignore malformed line
    }
  }
  return false;
}

/**
 * Find the eventSeq of the most recent `turn_end` event in the transcript, or
 * `null` if no turn has completed yet. Used by the conversation runner to
 * compute its initial immediate-inject watermark — any context_injected event
 * newer than the last turn_end is unprocessed.
 */
export function findLastTurnEndEventSeq(sessionDir: string): number | null {
  let last: number | null = null;
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type !== 'turn_end') continue;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (last === null || parsed.eventSeq > last) last = parsed.eventSeq;
    } catch {
      // ignore malformed line
    }
  }
  return last;
}

export type DurableEvent = {
  eventSeq: number;
  timestamp: string;
  turnId?: string;
  turnSeq?: number;
  type: string;
  data: Record<string, unknown>;
};

export function summarizeDurableEvents(sessionDir: string): {
  messageCount: number;
  turnCount: number;
  lastActive?: string;
} {
  let messageCount = 0;
  let turnCount = 0;
  let lastActive: string | undefined;

  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as Partial<DurableEvent>;
      if (parsed.type === 'prompt' || parsed.type === 'message') {
        messageCount++;
      }
      if (parsed.type === 'turn_start') {
        turnCount++;
      }
      if (typeof parsed.timestamp === 'string' && parsed.timestamp.length > 0) {
        if (!lastActive || parsed.timestamp > lastActive) lastActive = parsed.timestamp;
      }
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  return { messageCount, turnCount, lastActive };
}

export function appendDurableEvent(
  sessionDir: string,
  state: SessionState,
  event: Omit<DurableEvent, 'eventSeq' | 'timestamp'>
): { nextState: SessionState; written: DurableEvent } {
  const sessionId = path.basename(sessionDir);
  const laceDir = getLaceDir();
  const persona = personaForSessionDir(sessionDir);
  const eventsPath = transcriptFilePath({
    laceDir,
    persona,
    date: new Date(),
    sessionId,
  });
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true, mode: SECURE_DIR_MODE });

  // Derive from all transcript files (and the legacy events.jsonl) so seqs
  // stay monotonic across day rollovers and across the legacy→new transition.
  const eventSeq = deriveNextEventSeqAcrossSessionFiles(laceDir, sessionId);

  // Ensure we never accidentally join JSON objects when the previous write was
  // truncated and did not end with a newline.
  try {
    const stat = fs.statSync(eventsPath);
    if (stat.size > 0) {
      const fd = fs.openSync(eventsPath, 'r');
      try {
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, stat.size - 1);
        if (buf.toString('utf8') !== '\n') {
          fs.appendFileSync(eventsPath, '\n', { encoding: 'utf8' });
        }
      } finally {
        fs.closeSync(fd);
      }
    }
  } catch {
    // If the file doesn't exist or can't be read, we'll let appendFileSync below create it.
  }

  const written: DurableEvent = {
    eventSeq,
    timestamp: new Date().toISOString(),
    ...event,
  };

  fs.appendFileSync(eventsPath, `${JSON.stringify(written)}\n`, { encoding: 'utf8' });

  // Apply secure file mode if this was the first write (file didn't exist before).
  // stat-check avoids chmod on every append.
  try {
    const stat = fs.statSync(eventsPath);
    if ((stat.mode & 0o777) !== SECURE_FILE_MODE) {
      fs.chmodSync(eventsPath, SECURE_FILE_MODE);
    }
  } catch {
    // file doesn't exist somehow — write would have already failed; ignore
  }

  // Write-through indexing: mirror the event into the FTS index so /recall
  // queries can find it without a separate scan pass. Failures here must
  // never break event-write — JSONL is source of truth and the backfill
  // pass on next startup will repair anything the index missed.
  try {
    const row = eventToRow(written as TypedDurableEvent, { sessionId, persona });
    if (row) insertRow(getRecallIndex(), row);
  } catch (err) {
    console.error('recall indexer write failed:', err);
  }

  return {
    written,
    nextState: { ...state, nextEventSeq: state.nextEventSeq + 1 },
  };
}

export function readDurableEvents(
  sessionDir: string,
  options: { afterEventSeq?: number; limit?: number; types?: string[] }
): { events: DurableEvent[]; hasMore: boolean } {
  const after = options.afterEventSeq ?? 0;
  const limit = options.limit ?? 100;
  const typeFilter = options.types ? new Set(options.types) : null;

  const events: DurableEvent[] = [];
  let hasMore = false;
  for (const line of readAllSessionEventLines(sessionDir)) {
    try {
      const parsed = JSON.parse(line) as DurableEvent;
      if (typeof parsed.eventSeq !== 'number') continue;
      if (parsed.eventSeq <= after) continue;
      if (typeFilter && !typeFilter.has(parsed.type)) continue;
      if (events.length < limit) {
        events.push(parsed);
        continue;
      }

      hasMore = true;
      break;
    } catch {
      // Ignore malformed line (e.g. partial write)
    }
  }

  return { events, hasMore };
}

// Export typed versions for callers that want type safety
export type { TypedDurableEvent, DurableEventData } from './event-types';
