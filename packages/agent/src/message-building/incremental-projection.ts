// ABOUTME: The in-memory conversation projection held across turns. A
// CachedProjection carries the FoldState + system prompt + files-read set +
// last-turn-end watermark + the next-seq-to-fold head. foldTailIntoProjection
// folds ONLY a new tail of events into it (O(tail)), applying the SAME per-event
// handling the full rebuild uses (applyEventToProjection in message-builder),
// so an incremental fold is byte-identical to a full rebuild over the same
// events — proven by the split-at-every-K differential test. projectTurnEntry
// is the cache-aware turn-entry point: an O(1) .seq tip-check picks the
// incremental tail-fold when a projection is cached, else falls back to the
// full loadTurnEntryProjection.

import { isAbsolute as isAbsolutePath, resolve as resolvePath } from 'node:path';
import type { ProviderMessage } from '../providers/base-provider';
import type { FoldState } from './fold-event';
import {
  applyEventToProjection,
  finalizeProjectionWarnings,
  newProjectionAccumulator,
  type ProjectionAccumulator,
} from './message-builder';
import type { ParsedSessionEvent } from './parsed-events';
import * as pe from './parsed-events';
import { readHead } from '@lace/agent/storage/seq-head';
import { loadTurnEntryProjection, type TurnEntryProjection } from './turn-entry-projection';

/**
 * The conversation projection cached in memory across turns. It is the
 * PERSISTED PREFIX ONLY — the runner's non-persisted per-turn live-tail
 * mutations (loop reminders, tool_result construction, tool-choice retries)
 * are never folded in here; they stay in the per-turn providerMessages.
 *
 * `headSeq` is the NEXT seq to fold: every event already folded has
 * `eventSeq < headSeq`, so a tail-read of `eventSeq >= headSeq` never
 * double-applies an event.
 */
export type CachedProjection = {
  foldState: FoldState;
  systemPrompt: string;
  systemPromptCount: number;
  filesRead: Set<string>;
  lastTurnEndSeq: number | null;
  headSeq: number;
  // The workDir used to resolve relative file_read paths. Captured at cache
  // seed so an incremental fold derives filesRead identically to the full build.
  cwd: string;
};

/** Derived messages of a cached projection. */
export function projectionMessages(proj: CachedProjection): ProviderMessage[] {
  return proj.foldState.messages;
}

function absolutePath(workDir: string, raw: string): string {
  return isAbsolutePath(raw) ? raw : resolvePath(workDir, raw);
}

/**
 * An empty cached projection (cold seed). `cwd` resolves relative file_read
 * paths; the differential test uses the default since its corpus reads
 * absolute paths.
 */
export function initialCachedProjection(cwd = ''): CachedProjection {
  const acc = newProjectionAccumulator();
  return {
    foldState: acc.state,
    systemPrompt: acc.systemPrompt,
    systemPromptCount: acc.systemPromptCount,
    filesRead: new Set<string>(),
    lastTurnEndSeq: null,
    headSeq: 1,
    cwd,
  };
}

/**
 * Fold a NEW tail of events into the cached projection, applying the exact
 * per-event handling of the full rebuild (applyEventToProjection). Returns a
 * fresh CachedProjection (the caller stores it). Tracks filesRead +
 * lastTurnEndSeq and advances headSeq to (max eventSeq seen) + 1.
 *
 * A convenience getter `messages` is attached so callers and tests read the
 * projection without reaching into foldState.
 */
export function foldTailIntoProjection(
  proj: CachedProjection,
  events: ParsedSessionEvent[]
): CachedProjection & { messages: ProviderMessage[] } {
  const acc: ProjectionAccumulator = {
    state: proj.foldState,
    systemPrompt: proj.systemPrompt,
    systemPromptCount: proj.systemPromptCount,
  };
  const filesRead = new Set(proj.filesRead);
  let lastTurnEndSeq = proj.lastTurnEndSeq;
  let headSeq = proj.headSeq;

  for (const e of events) {
    applyEventToProjection(acc, e.type, e.data);
    if (e.type === 'tool_use') {
      const data = e.data as {
        name?: unknown;
        input?: { path?: unknown };
        result?: { outcome?: unknown };
      };
      if (
        data.name === 'file_read' &&
        data.result?.outcome === 'completed' &&
        typeof data.input?.path === 'string' &&
        data.input.path.length > 0
      ) {
        filesRead.add(absolutePath(proj.cwd, data.input.path));
      }
    }
    if (e.type === 'turn_end') lastTurnEndSeq = e.eventSeq;
    if (e.eventSeq + 1 > headSeq) headSeq = e.eventSeq + 1;
  }

  const next: CachedProjection = {
    foldState: acc.state,
    systemPrompt: acc.systemPrompt,
    systemPromptCount: acc.systemPromptCount,
    filesRead,
    lastTurnEndSeq,
    headSeq,
    cwd: proj.cwd,
  };
  return { ...next, messages: next.foldState.messages };
}

/**
 * Seed a CachedProjection from a full turn-entry projection (cache-miss path).
 * The full build already parsed every event; we re-derive the FoldState by
 * folding the same parse so the incremental head is byte-identical to a full
 * rebuild from here on. `tip` is the .seq next-free seq (the head for the next
 * tail-read); when absent we fall back to (max eventSeq) + 1.
 */
function seedCachedProjection(
  events: ParsedSessionEvent[],
  full: TurnEntryProjection,
  cwd: string,
  tip: number | undefined
): CachedProjection {
  const acc = newProjectionAccumulator();
  for (const e of events) applyEventToProjection(acc, e.type, e.data);
  finalizeProjectionWarnings(acc);
  const maxSeq = events.length > 0 ? Math.max(...events.map((e) => e.eventSeq)) : 0;
  return {
    foldState: acc.state,
    systemPrompt: full.systemPrompt,
    systemPromptCount: acc.systemPromptCount,
    filesRead: full.filesRead,
    lastTurnEndSeq: full.lastTurnEndSeq,
    headSeq: tip ?? maxSeq + 1,
    cwd,
  };
}

/**
 * Cache-aware turn entry. Reads the O(1) .seq tip; on a cache hit with no
 * backward tip movement, tail-reads only events with `eventSeq >= cached.headSeq`
 * and folds them in (O(tail)). On a cold start / cache miss / inconsistency,
 * falls back to the full loadTurnEntryProjection and seeds the cache.
 *
 * The cache is keyed by sessionId, so a session switch simply uses a different
 * entry; a fork copies into a NEW sessionId, so a stale cache can never serve a
 * replaced log.
 */
export function projectTurnEntry(
  sessionDir: string,
  cwd: string,
  cache: Map<string, CachedProjection>,
  sessionId: string
): TurnEntryProjection {
  const tip = readHead(sessionDir);
  const cached = cache.get(sessionId);

  if (cached !== undefined && tip !== undefined && cached.headSeq <= tip) {
    // Incremental tail-fold: only the events appended since the cached head.
    // `headSeq` is the next-seq-to-fold, so `eventSeq >= headSeq` is precisely
    // the new tail and an already-folded event is never double-applied.
    const allEvents = pe.readParsedSessionEvents(sessionDir);
    const tailEvents = allEvents.filter((e) => e.eventSeq >= cached.headSeq);
    const folded = foldTailIntoProjection(cached, tailEvents);
    cache.set(sessionId, folded);
    return {
      messages: folded.messages,
      systemPrompt: folded.systemPrompt,
      filesRead: folded.filesRead,
      lastTurnEndSeq: folded.lastTurnEndSeq,
    };
  }

  // Cold / cache miss / tip moved backward: full rebuild + seed the cache.
  const events = pe.readParsedSessionEvents(sessionDir);
  const full = loadTurnEntryProjection(sessionDir, cwd);
  cache.set(sessionId, seedCachedProjection(events, full, cwd, tip));
  return full;
}
