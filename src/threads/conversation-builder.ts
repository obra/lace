// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';

export function buildWorkingConversation(events: ThreadEvent[]): ThreadEvent[] {
  const lastCompaction = findLastCompactionEvent(events);

  if (!lastCompaction) {
    return events; // No compaction yet, use all events
  }

  // Use compacted events + compaction event + everything after compaction
  const eventsAfterCompaction = getEventsAfter(events, lastCompaction.id);
  const compactionData = lastCompaction.data as unknown as CompactionData;
  return [...compactionData.compactedEvents, lastCompaction, ...eventsAfterCompaction];
}

export function buildCompleteHistory(events: ThreadEvent[]): ThreadEvent[] {
  // Return all events including compaction events (for debugging/inspection)
  return events;
}

function findLastCompactionEvent(events: ThreadEvent[]): ThreadEvent | null {
  // Find the most recent COMPACTION event
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      return events[i];
    }
  }
  return null;
}

function getEventsAfter(events: ThreadEvent[], afterEventId: string): ThreadEvent[] {
  const afterIndex = events.findIndex((e) => e.id === afterEventId);
  if (afterIndex === -1) return [];
  return events.slice(afterIndex + 1);
}
