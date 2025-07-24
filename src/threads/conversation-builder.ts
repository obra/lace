// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';

/**
 * Type guard to ensure data from COMPACTION events is valid CompactionData
 *
 * NOTE FOR REVIEWERS: This type guard is defensive programming against malformed
 * COMPACTION events. In normal operation, all COMPACTION events are created by
 * our compaction strategies and are guaranteed to have valid CompactionData.
 * However, this guard protects against potential corruption or invalid data
 * that could theoretically exist in the event stream.
 */
function isCompactionData(data: unknown): data is CompactionData {
  return (
    data !== null &&
    typeof data === 'object' &&
    'strategyId' in data &&
    'compactedEvents' in data &&
    'originalEventCount' in data &&
    typeof (data as CompactionData).strategyId === 'string' &&
    Array.isArray((data as CompactionData).compactedEvents) &&
    typeof (data as CompactionData).originalEventCount === 'number'
  );
}

export function buildWorkingConversation(events: ThreadEvent[]): ThreadEvent[] {
  const { lastCompaction, lastCompactionIndex } = findLastCompactionEventWithIndex(events);

  if (!lastCompaction) {
    return events; // No compaction yet, use all events
  }

  // Use compacted events + compaction event + everything after compaction
  const eventsAfterCompaction = events.slice(lastCompactionIndex + 1);

  // Type-safe extraction of compaction data with runtime validation
  if (!isCompactionData(lastCompaction.data)) {
    // Defensive fallback: if compaction data is malformed, return all events
    // This preserves conversation integrity even if compaction data is corrupted
    return events;
  }

  const compactionData = lastCompaction.data;
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
