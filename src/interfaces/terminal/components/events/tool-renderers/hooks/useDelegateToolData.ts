// ABOUTME: Specialized data processing for delegate tool executions with real-time thread monitoring
// ABOUTME: Extends base tool data with delegation thread information and status tracking

import { useMemo } from 'react';
import { useThreadManager, useThreadProcessor } from '../../../../terminal-interface.js';
import { useToolData, type ToolExecutionItem } from './useToolData.js';
import { calculateTokens } from '../../../../../../utils/token-estimation.js';
import { logger } from '../../../../../../utils/logger.js';
import {
  extractDelegateThreadId,
  isThreadComplete,
  extractTaskFromTimeline,
  calculateDuration,
} from '../../utils/timeline-utils.js';

// Delegate-specific data structure
export interface DelegateToolData {
  // Base tool data
  baseData: ReturnType<typeof useToolData>;

  // Delegation-specific data
  delegateThreadId: string | null;
  delegateTask: string;

  // Thread timeline data
  timeline: { items: any[]; metadata: any }; // Timeline type from thread processor
  isComplete: boolean;
  taskDescription: string;
  duration: string;
  tokens: { tokensIn: number; tokensOut: number };
  hasThreadData: boolean;
}

export function useDelegateToolData(item: ToolExecutionItem): DelegateToolData {
  // Get base tool data
  const baseData = useToolData(item);

  // Get thread management hooks
  const threadManager = useThreadManager();
  const threadProcessor = useThreadProcessor();

  // Extract delegate-specific information
  const delegateThreadId = useMemo(() => extractDelegateThreadId(item), [item]);
  const delegateTask =
    ((item.call.arguments.task || item.call.arguments.prompt) as string) || 'Unknown task';

  // Fetch and process delegate thread data
  const threadData = useMemo(() => {
    if (!delegateThreadId) {
      return {
        timeline: {
          items: [],
          metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
        },
        hasData: false,
      };
    }

    try {
      const events = threadManager.getEvents(delegateThreadId);
      const timeline = threadProcessor.processThreads(events);
      return {
        timeline,
        hasData: true,
      };
    } catch (error) {
      logger.error('Failed to load delegate thread', {
        threadId: delegateThreadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        timeline: {
          items: [],
          metadata: { eventCount: 0, messageCount: 0, lastActivity: new Date() },
        },
        hasData: false,
      };
    }
  }, [delegateThreadId, threadManager, threadProcessor]);

  // Calculate derived thread data
  const derivedData = useMemo(() => {
    const { timeline } = threadData;
    return {
      isComplete: isThreadComplete(timeline),
      taskDescription: extractTaskFromTimeline(timeline),
      duration: calculateDuration(timeline),
      tokens: calculateTokens(timeline),
    };
  }, [threadData]);

  return {
    baseData,
    delegateThreadId,
    delegateTask,
    timeline: threadData.timeline,
    hasThreadData: threadData.hasData,
    ...derivedData,
  };
}
