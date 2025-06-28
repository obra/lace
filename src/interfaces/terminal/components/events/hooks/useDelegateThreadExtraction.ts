// ABOUTME: Hook for extracting delegate thread IDs from tool execution items
// ABOUTME: Provides memoized extraction logic with two strategies: regex parsing and temporal proximity

import { useMemo } from 'react';
import { Timeline, TimelineItem } from '../../../../thread-processor.js';
import { logger } from '../../../../../utils/logger.js';

// Type for tool execution items
type ToolExecutionItem = Extract<TimelineItem, { type: 'tool_execution' }>;

export interface DelegateThreadExtractor {
  extractDelegateThreadId: (item: ToolExecutionItem) => string | null;
}

/**
 * Hook for extracting delegate thread IDs from tool execution items.
 *
 * Uses two strategies:
 * 1. Regex parsing from tool result output (preferred)
 * 2. Temporal proximity matching (fallback)
 *
 * Results are memoized based on delegate timelines to avoid recomputation.
 */
export function useDelegateThreadExtraction(
  delegateTimelines?: Map<string, Timeline>
): DelegateThreadExtractor {
  const extractor = useMemo(() => {
    function extractDelegateThreadId(item: ToolExecutionItem): string | null {
      if (!delegateTimelines || delegateTimelines.size === 0) {
        return null;
      }

      logger.debug('Extracting delegate thread ID', { callId: item.callId });

      // Strategy 1: Look for thread ID in tool result
      const resultText = item.result?.content?.[0]?.text;
      if (resultText) {
        const match = resultText.match(/Thread: ([^)]+)/);
        if (match) {
          logger.debug('Found thread ID in tool result', { threadId: match[1] });
          return match[1];
        }
      }

      // Strategy 2: Find delegate thread that started near this tool call (within 5 seconds)
      for (const [threadId, timeline] of delegateTimelines.entries()) {
        const firstItem = timeline.items[0];
        if (firstItem) {
          const timeDiff = Math.abs(firstItem.timestamp.getTime() - item.timestamp.getTime());
          if (timeDiff < 5000) {
            logger.debug('Found delegate thread by temporal proximity', {
              threadId,
              timeDiffMs: timeDiff,
            });
            return threadId;
          }
        }
      }

      logger.debug('No delegate thread ID found');
      return null;
    }

    return { extractDelegateThreadId };
  }, [delegateTimelines]);

  return extractor;
}
