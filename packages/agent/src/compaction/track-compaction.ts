// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Uses context_compacted event type for event-sourced replay

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
import { estimateProviderTokens } from '@lace/agent/message-building/message-builder';
import { logger } from '@lace/agent/utils/logger';
import { renderCompactionPrefix } from './track-render';
import type { CompactionContext, CompactResult } from './types';
import {
  UNTRACKED,
  splitAtTailBoundary,
  demuxByTrack,
  buildPreservedTail,
  buildPreservedWithPrefix,
  jobSalience,
  untrackedSalience,
  systemSalience,
  type TrackBlock,
} from './toolkit';

// Re-export so the existing test imports keep working.
export { UNTRACKED, splitAtTailBoundary };

/**
 * Walk events and map each `turn_start.turnId` to the track of the
 * immediately preceding `prompt` event. Used to attribute in-turn events
 * (tool_use, message, turn_end) to a track.
 */
export function buildTurnToTrackMap(events: TypedDurableEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  let pendingPromptTrack: string | undefined;
  for (const e of events) {
    if (isEventOfType(e, 'prompt')) {
      pendingPromptTrack = e.data.track ?? UNTRACKED;
      continue;
    }
    if (e.type === 'turn_start' && e.turnId) {
      map.set(e.turnId, pendingPromptTrack ?? UNTRACKED);
      pendingPromptTrack = undefined;
    }
  }
  return map;
}

/**
 * Group events by track for per-track salience extraction.
 *
 * - Filters out `context_compacted` events (we always rebuild from canonical).
 * - In-turn events inherit their turn's track from `turnToTrack`.
 * - Mid-turn `context_injected` events (no turnId or with their own track)
 *   are emitted under their own `data.track`.
 * - Top-level prompts/injects without a containing turn use their own track.
 * - Events without a track field fall into `'untracked'`.
 *
 * @deprecated reference-only — compact() routes through demuxByTrack(kernelAttributor).
 * Retained only as a test-reference implementation; do not add new call sites.
 */
export function groupEarlierEventsByTrack(
  events: TypedDurableEvent[],
  turnToTrack: Map<string, string>
): Map<string, TypedDurableEvent[]> {
  const groups = new Map<string, TypedDurableEvent[]>();
  const push = (track: string, e: TypedDurableEvent) => {
    const arr = groups.get(track) ?? [];
    arr.push(e);
    groups.set(track, arr);
  };

  for (const e of events) {
    if (e.type === 'context_compacted') continue;

    if (isEventOfType(e, 'context_injected')) {
      // Mid-turn injects use their OWN track regardless of enclosing turn.
      push(e.data.track ?? UNTRACKED, e);
      continue;
    }

    if (isEventOfType(e, 'job_started') || isEventOfType(e, 'job_finished')) {
      // Top-level job lifecycle events carry jobId, not a track field.
      // Bucket them under job:<jobId> so salienceForTrack can produce a real
      // "delegated X → outcome" line instead of (unknown) / ⏳ in-flight.
      push(`job:${e.data.jobId}`, e);
      continue;
    }

    if (isEventOfType(e, 'prompt')) {
      push(e.data.track ?? UNTRACKED, e);
      continue;
    }

    if (e.turnId && turnToTrack.has(e.turnId)) {
      push(turnToTrack.get(e.turnId)!, e);
      continue;
    }

    // Top-level event without a turnId attribution — bucket as untracked.
    push(UNTRACKED, e);
  }

  return groups;
}

/**
 * Kernel attributor for demuxByTrack: reproduces the groupEarlierEventsByTrack
 * attribution logic as a pure event→string function.
 *
 * Per-event attribution, with turn-track inheritance supplied via the
 * `turnToTrack` Map (in-turn events inherit their turn's opening track). The
 * kernel's `compact()` routes through `demuxByTrack(earlier, (e) => kernelAttributor(e, turnToTrack))`
 * — this IS the live path; custom strategies inject their own attributor the same way.
 *
 * Returns the sentinel `'__skip__'` for `context_compacted` events (which must be
 * excluded from grouping). Any caller using this attributor with `demuxByTrack`
 * MUST `groups.delete('__skip__')` before processing, or those events fall into a
 * spurious bucket. `groupEarlierEventsByTrack` is retained only as a test-reference
 * implementation.
 */
export function kernelAttributor(e: TypedDurableEvent, turnToTrack: Map<string, string>): string {
  if (e.type === 'context_compacted') return '__skip__';

  if (isEventOfType(e, 'context_injected')) {
    return e.data.track ?? UNTRACKED;
  }

  if (isEventOfType(e, 'job_started') || isEventOfType(e, 'job_finished')) {
    return `job:${e.data.jobId}`;
  }

  if (isEventOfType(e, 'prompt')) {
    return e.data.track ?? UNTRACKED;
  }

  if (e.turnId && turnToTrack.has(e.turnId)) {
    return turnToTrack.get(e.turnId)!;
  }

  return UNTRACKED;
}

// ---------------------------------------------------------------------------
// Per-track salience — domain-neutral kernel default
// ---------------------------------------------------------------------------

/**
 * Per-track salience extraction. Returns null for tracks that should be
 * dropped entirely from the rendered prefix (alarm/reminder/bootstrap).
 *
 * All track prefixes not handled by the kernel (jobs/alarms/system) fall through
 * to generic prose rendering. Domain-specific rendering belongs in plugins.
 */
export function salienceForTrack(trackId: string, events: TypedDurableEvent[]): TrackBlock | null {
  if (trackId.startsWith('alarm:') || trackId.startsWith('reminder:')) {
    return null;
  }
  if (trackId === 'system:bootstrap') {
    return null;
  }
  if (trackId === 'system:idle-errors') {
    return systemSalience(trackId, events);
  }
  if (trackId.startsWith('job:')) {
    return jobSalience(trackId, events);
  }
  // All other tracks fall through to generic prose rendering.
  return untrackedSalience(trackId, events);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

const TAIL_TURNS = 10;

/**
 * Ceiling on the verbatim tail we preserve through a compaction, in estimated
 * tokens. `TAIL_TURNS` caps the tail by *turn count*; this caps it by *size*,
 * so a handful of very large recent turns (long messages + big tool / subagent
 * outputs) can't blow past the model's context window even right after
 * compacting.
 *
 * 300K is the ceiling rather than the answer: on a 1M-token window it leaves
 * ample room (far under the ~950K usable after system prompt + output reserve +
 * the prefix summary) with plenty of headroom for new turns before the next
 * compaction fires. The token-blind 10-turn tail once reached ~600K in
 * production and 400'd every request with `prompt_too_long`.
 */
export const TAIL_TOKEN_BUDGET_CAP = 300_000;

/**
 * Fraction of the model's context window the preserved tail may occupy. The
 * remaining 10% is the room compaction needs to be worth anything: the prefix
 * summary, the system prompt, and at least one new turn all have to fit
 * alongside the tail or the session is still over the window the moment it
 * finishes compacting.
 */
export const TAIL_BUDGET_WINDOW_FRACTION = 0.9;

/**
 * The window we assume when the call site couldn't tell us one. Matches
 * `BaseProvider.contextWindowForModel`'s own fallback, so an unplumbed caller
 * degrades to a tail that is safe on every model we ship rather than to the
 * 300K ceiling, which is larger than the entire window on a 200K model.
 */
const ASSUMED_CONTEXT_WINDOW = 200_000;

/**
 * Token budget for the preserved tail on a model with this context window.
 *
 * Before PRI-2906 this was a flat 300K with no relationship to the running
 * model. On any window under ~333K that budget exceeded the window itself, so
 * a compacted session was still over the limit — PRI-2903's emergency
 * self-heal would compact, retry, 400 again, and every later turn would burn
 * another compaction that also could not help. We only failed to notice
 * because the fleet runs ~1M-window models.
 */
export function tailTokenBudget(contextWindow?: number): number {
  const window =
    contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0
      ? contextWindow
      : ASSUMED_CONTEXT_WINDOW;
  return Math.min(TAIL_TOKEN_BUDGET_CAP, Math.floor(window * TAIL_BUDGET_WINDOW_FRACTION));
}

/**
 * Estimate the on-wire token size of the verbatim tail by building the exact
 * PreservedMessage stream the provider will replay and running it through the
 * same estimator the auto-compaction trigger and message-builder use. Pure and
 * deterministic — no model call.
 */
export function estimateTailTokens(tail: TypedDurableEvent[]): number {
  return estimateProviderTokens(buildPreservedTail(tail));
}

/**
 * Apply a token budget to the turn-based split. Starting from the turn-count
 * split, while the verbatim tail's estimated tokens exceed `budget` AND the
 * tail still holds more than one turn, peel the OLDEST tail turn back into
 * `earlier` (where it gets compressed into the prefix) and re-estimate.
 *
 * Always preserves at least the most recent turn — we can't compress the
 * in-flight turn. If that single remaining turn still exceeds the budget it is
 * preserved anyway and a warning is logged (the tool-result-truncation work
 * addresses that residual case).
 *
 * Re-derives `{earlier, tail}` via `splitAtTailBoundary` at the reduced turn
 * count so the unchanged prefix-compression and `buildPreservedTail` logic runs
 * over the adjusted split.
 */
export function trimTailToTokenBudget(
  events: TypedDurableEvent[],
  tailTurns: number,
  budget: number
): { earlier: TypedDurableEvent[]; tail: TypedDurableEvent[] } {
  let split = splitAtTailBoundary(events, tailTurns);
  let turns = tailTurns;

  while (turns > 1 && estimateTailTokens(split.tail) > budget) {
    turns -= 1;
    split = splitAtTailBoundary(events, turns);
  }

  if (estimateTailTokens(split.tail) > budget) {
    logger.warn(
      'compaction: preserved tail exceeds token budget with a single turn — preserving it anyway',
      {
        budget,
        estimatedTailTokens: estimateTailTokens(split.tail),
        tailTurns: turns,
      }
    );
  }

  return split;
}

/**
 * Track-based compaction orchestrator. Pure: returns the event the caller
 * should write, without writing it. Deterministic — no model access.
 */
export async function compact(
  events: TypedDurableEvent[],
  ctx: CompactionContext
): Promise<CompactResult> {
  const { earlier, tail } = trimTailToTokenBudget(
    events,
    TAIL_TURNS,
    tailTokenBudget(ctx.contextWindow)
  );

  if (earlier.length === 0) {
    return { noop: true };
  }

  let prefixContent: string;
  {
    const turnToTrack = buildTurnToTrackMap(events);
    const groups = demuxByTrack(earlier, (e) => kernelAttributor(e, turnToTrack));
    // Remove the sentinel bucket produced by kernelAttributor for context_compacted events.
    groups.delete('__skip__');
    const blocks: TrackBlock[] = [];
    for (const [trackId, trackEvents] of groups) {
      const block = salienceForTrack(trackId, trackEvents);
      if (!block) continue;
      blocks.push(block);
    }
    prefixContent = renderCompactionPrefix({
      blocks,
      scheduler: { alarmsPending: 0, remindersPending: 0 },
    });
  }

  const preservedTail = buildPreservedTail(tail);

  // Avoid adjacent user-role messages: if the first tail entry is also user-role,
  // merge the prefix into it rather than prepending a separate user entry.
  // This keeps the role-alternation invariant that providers require.
  const preserved = buildPreservedWithPrefix(prefixContent, preservedTail);

  return {
    compactionEvent: {
      type: 'context_compacted',
      data: {
        type: 'context_compacted',
        strategy: 'track-based',
        messagesCompacted: earlier.length,
        preserved,
      },
    },
  };
}
