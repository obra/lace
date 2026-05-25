// ABOUTME: Track-based compaction strategy — demux + salience + render
// ABOUTME: Replaces summarize-strategy.ts; reuses context_compacted event type

import type {
  TypedDurableEvent,
  PromptEventData,
  ContextInjectedEventData,
} from '@lace/agent/storage/event-types';

export const UNTRACKED = 'untracked' as const;

/**
 * Walk events and map each `turn_start.turnId` to the track of the
 * immediately preceding `prompt` event. Used to attribute in-turn events
 * (tool_use, message, turn_end) to a track.
 */
export function buildTurnToTrackMap(events: TypedDurableEvent[]): Map<string, string> {
  const map = new Map<string, string>();
  let pendingPromptTrack: string | undefined;
  for (const e of events) {
    if (e.type === 'prompt') {
      const data = e.data as PromptEventData;
      pendingPromptTrack = data.track ?? UNTRACKED;
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

    if (e.type === 'context_injected') {
      const data = e.data as ContextInjectedEventData;
      const ownTrack = data.track ?? UNTRACKED;
      // Mid-turn injects use their OWN track regardless of enclosing turn.
      push(ownTrack, e);
      continue;
    }

    if (e.type === 'prompt') {
      const data = e.data as PromptEventData;
      push(data.track ?? UNTRACKED, e);
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
