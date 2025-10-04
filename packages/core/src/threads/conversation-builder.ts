// ABOUTME: Builds working conversations from thread events, handling compaction
// ABOUTME: Core logic for reconstructing conversations post-compaction

import type { LaceEvent } from './types';
import type { ToolResult } from '@lace/core/tools/types';
import { logger } from '@lace/core/utils/logger';

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
          threadId: event.context?.threadId,
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
            threadId: event.context?.threadId,
          });
        }
      } else if (existing) {
        const existingResult = existing.event.data as ToolResult;
        logger.warn('CONVERSATION_BUILDER: Duplicate TOOL_RESULT filtered (lower precedence)', {
          toolCallId,
          skippedStatus: status,
          keptStatus: existingResult.status || 'completed',
          eventId: event.id,
          threadId: event.context?.threadId,
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
  // With the new compaction architecture, compacted events are persisted as
  // separate database rows with visibleToModel flags. We simply filter to
  // events that are visible to the model (visibleToModel !== false).
  const visibleEvents = events.filter((e) => e.visibleToModel !== false);

  // Apply tool result deduplication as final step
  return deduplicateToolResults(visibleEvents);
}

export function buildCompleteHistory(events: LaceEvent[]): LaceEvent[] {
  // Return all events including compaction events (for debugging/inspection)
  return events;
}
