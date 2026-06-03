// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Uses context_compacted event type for event-sourced replay

import { isEventOfType } from '@lace/agent/storage/event-types';
import type { TypedDurableEvent } from '@lace/agent/storage/event-types';
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
 * Track-based compaction orchestrator. Pure: returns the event the caller
 * should write, without writing it. Deterministic — no model access.
 */
export async function compact(
  events: TypedDurableEvent[],
  ctx: CompactionContext
): Promise<CompactResult> {
  const { earlier, tail } = splitAtTailBoundary(events, TAIL_TURNS);

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
