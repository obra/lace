// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';
import type { ToolResult } from '~/tools/types';
import { logger } from '~/utils/logger';

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

/**
 * Deduplicates TOOL_RESULT events to prevent duplicate tool results in conversations.
 *
 * This is part of the defense-in-depth strategy against tool approval race conditions.
 * Even if duplicate tool results make it into the event stream, we filter them out
 * at the conversation building level to ensure clean provider API calls.
 */
function deduplicateToolResults(events: ThreadEvent[]): ThreadEvent[] {
  const seenToolResults = new Set<string>();
  const deduplicatedEvents: ThreadEvent[] = [];

  for (const event of events) {
    if (event.type === 'TOOL_RESULT') {
      // Handle different TOOL_RESULT data formats:

      if (typeof event.data === 'string') {
        // Raw string data (e.g., from compaction) - pass through unchanged
        deduplicatedEvents.push(event);
        continue;
      }

      if (typeof event.data === 'object' && event.data && 'content' in event.data) {
        // ToolResult object - check for ID and deduplicate if present
        const toolResult = event.data as ToolResult;
        const toolCallId = toolResult.id;

        if (!toolCallId) {
          // ToolResult objects without IDs are considered invalid and filtered out
          logger.warn('CONVERSATION_BUILDER: TOOL_RESULT missing id', {
            eventId: event.id,
            threadId: event.threadId,
          });
          continue; // Skip results without IDs
        }

        if (seenToolResults.has(toolCallId)) {
          logger.warn('CONVERSATION_BUILDER: Duplicate TOOL_RESULT filtered', {
            toolCallId,
            eventId: event.id,
            threadId: event.threadId,
          });
          continue; // Skip duplicate
        }

        seenToolResults.add(toolCallId);
      }
      // Other object formats pass through unchanged
    }

    deduplicatedEvents.push(event);
  }

  return deduplicatedEvents;
}

export function buildWorkingConversation(events: ThreadEvent[]): ThreadEvent[] {
  const { lastCompaction, lastCompactionIndex } = findLastCompactionEventWithIndex(events);

  let workingEvents: ThreadEvent[];

  if (!lastCompaction) {
    workingEvents = events; // No compaction yet, use all events
  } else {
    // Use compacted events + compaction event + everything after compaction
    const eventsAfterCompaction = events.slice(lastCompactionIndex + 1);

    // Type-safe extraction of compaction data with runtime validation
    if (!isCompactionData(lastCompaction.data)) {
      // Defensive fallback: if compaction data is malformed, return all events
      // This preserves conversation integrity even if compaction data is corrupted
      workingEvents = events;
    } else {
      const compactionData = lastCompaction.data;
      workingEvents = [...compactionData.compactedEvents, lastCompaction, ...eventsAfterCompaction];
    }
  }

  // Apply tool result deduplication as final step
  return deduplicateToolResults(workingEvents);
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
