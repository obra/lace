// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';

export function buildWorkingConversation(events: ThreadEvent[]): ThreadEvent[] {
  const { lastCompaction, lastCompactionIndex } = findLastCompactionEventWithIndex(events);

  if (!lastCompaction) {
    return events; // No compaction yet, use all events
  }

  // Use compacted events + compaction event + everything after compaction
  const eventsAfterCompaction = events.slice(lastCompactionIndex + 1);
  const compactionData = lastCompaction.data as unknown as CompactionData;
  return [...compactionData.compactedEvents, lastCompaction, ...eventsAfterCompaction];
}

export function buildCompleteHistory(events: ThreadEvent[]): ThreadEvent[] {
  // Return all events including compaction events (for debugging/inspection)
  return events;
}

/**
 * Finds the last COMPACTION event and its index in a single pass
 * @param events Array of thread events
 * @returns Object with the last compaction event and its index, or null if no compaction found
 */
function findLastCompactionEventWithIndex(events: ThreadEvent[]): {
  lastCompaction: ThreadEvent | null;
  lastCompactionIndex: number;
} {
  // Single reverse pass to find the most recent COMPACTION event
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      return {
        lastCompaction: events[i],
        lastCompactionIndex: i,
      };
    }
  }
  return {
    lastCompaction: null,
    lastCompactionIndex: -1,
  };
}
