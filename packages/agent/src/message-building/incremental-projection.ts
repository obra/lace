// ABOUTME: The in-memory conversation projection held across turns. A
// CachedProjection carries the FoldState + system prompt + files-read set +
// last-turn-end watermark + the next-seq-to-fold head. foldTailIntoProjection
// folds ONLY a new tail of events into it (O(tail)), applying the SAME per-event
// handling the full rebuild uses (applyEventToProjection in message-builder),
// so an incremental fold is byte-identical to a full rebuild over the same
// events — proven by the split-at-every-K differential test.

import { isAbsolute as isAbsolutePath, resolve as resolvePath } from 'node:path';
import type { ProviderMessage } from '../providers/base-provider';
import type { FoldState } from './fold-event';
import {
  applyEventToProjection,
  newProjectionAccumulator,
  type ProjectionAccumulator,
} from './message-builder';
import type { ParsedSessionEvent } from './parsed-events';

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
