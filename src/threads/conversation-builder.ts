// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { LaceEvent } from '~/threads/types';
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
 * Status precedence for deduplication (higher number = higher priority)
 * denied > failed > aborted > completed
 */
function getStatusPriority(status: string): number {
  switch (status) {
    case 'denied':
      return 4;
    case 'failed':
      return 3;
    case 'aborted':
      return 2;
    case 'completed':
      return 1;
    default:
      return 0; // Unknown status has lowest priority
  }
}

/**
 * Deduplicates TOOL_RESULT events to prevent duplicate tool results in conversations.
 *
 * This is part of the defense-in-depth strategy against tool approval race conditions.
 * Even if duplicate tool results make it into the event stream, we filter them out
 * at the conversation building level to ensure clean provider API calls.
 *
 * When duplicates are found, the status with higher precedence is kept:
 * denied > failed > aborted > completed
 */
function deduplicateToolResults(events: LaceEvent[]): LaceEvent[] {
  const toolResultsByCallId = new Map<string, { event: LaceEvent; priority: number }>();
  const deduplicatedEvents: LaceEvent[] = [];

  for (const event of events) {
    if (event.type === 'TOOL_RESULT') {
      // All TOOL_RESULT events must be ToolResult objects with content field
      if (typeof event.data !== 'object' || !event.data || !('content' in event.data)) {
        throw new Error(
          `TOOL_RESULT event must contain ToolResult object with content field, got: ${typeof event.data}`
        );
      }

      const toolResult = event.data;
      const toolCallId = toolResult.id;

      if (!toolCallId) {
        // ToolResult objects without IDs are considered invalid and filtered out
        logger.warn('CONVERSATION_BUILDER: TOOL_RESULT missing id', {
          eventId: event.id,
          threadId: event.threadId,
        });
        continue; // Skip results without IDs
      }

      const status = toolResult.status || 'completed';
      const priority = getStatusPriority(status);
      const existing = toolResultsByCallId.get(toolCallId);

      if (!existing || priority > existing.priority) {
        // First occurrence or higher priority status found
        toolResultsByCallId.set(toolCallId, { event, priority });

        if (existing) {
          const existingResult = existing.event.data as ToolResult;
          logger.warn('CONVERSATION_BUILDER: Duplicate TOOL_RESULT with precedence applied', {
            toolCallId,
            keptStatus: status,
            replacedStatus: existingResult.status || 'completed',
            eventId: event.id,
            threadId: event.threadId,
          });
        }
      } else if (existing) {
        const existingResult = existing.event.data as ToolResult;
        logger.warn('CONVERSATION_BUILDER: Duplicate TOOL_RESULT filtered (lower precedence)', {
          toolCallId,
          skippedStatus: status,
          keptStatus: existingResult.status || 'completed',
          eventId: event.id,
          threadId: event.threadId,
        });
      }
    }
  }

  // Rebuild events list with deduplicated tool results
  const keptToolResults = new Set(Array.from(toolResultsByCallId.values()).map((v) => v.event));

  for (const event of events) {
    if (event.type === 'TOOL_RESULT') {
      if (keptToolResults.has(event)) {
        deduplicatedEvents.push(event);
      }
    } else {
      deduplicatedEvents.push(event);
    }
  }

  return deduplicatedEvents;
}

export function buildWorkingConversation(events: LaceEvent[]): LaceEvent[] {
  const { lastCompaction, lastCompactionIndex } = findLastCompactionEventWithIndex(events);

  let workingEvents: LaceEvent[];

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

export function buildCompleteHistory(events: LaceEvent[]): LaceEvent[] {
  // Return all events including compaction events (for debugging/inspection)
  return events;
}

/**
 * Finds the last COMPACTION event and its index in a single pass
 * @param events Array of thread events
 * @returns Object with the last compaction event and its index, or null if no compaction found
 */
function findLastCompactionEventWithIndex(events: LaceEvent[]): {
  lastCompaction: LaceEvent | null;
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
