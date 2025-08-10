// ABOUTME: Utilities for aggregating token usage across thread events
// ABOUTME: Calculates cumulative token counts from conversation history

import type { ThreadEvent } from '~/threads/types';

export interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  eventCount: number;
}

export function aggregateTokenUsage(events: ThreadEvent[]): TokenSummary {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let eventCount = 0;

  // Find the most recent COMPACTION event
  let lastCompactionIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      lastCompactionIndex = i;
      break;
    }
  }

  // If there's a compaction, only count:
  // 1. The summary events from the most recent compaction
  // 2. Events that come after the most recent compaction
  if (lastCompactionIndex >= 0) {
    const compactionEvent = events[lastCompactionIndex];

    // Add tokens from the compaction summary events
    if (compactionEvent.type === 'COMPACTION') {
      for (const summaryEvent of compactionEvent.data.compactedEvents) {
        if (summaryEvent.type === 'AGENT_MESSAGE' && summaryEvent.data.tokenUsage) {
          totalPromptTokens += summaryEvent.data.tokenUsage.promptTokens;
          totalCompletionTokens += summaryEvent.data.tokenUsage.completionTokens;
          eventCount++;
        } else if (
          summaryEvent.type === 'TOOL_RESULT' &&
          'tokenUsage' in summaryEvent.data &&
          summaryEvent.data.tokenUsage
        ) {
          totalPromptTokens += summaryEvent.data.tokenUsage.promptTokens;
          totalCompletionTokens += summaryEvent.data.tokenUsage.completionTokens;
          eventCount++;
        }
      }
    }

    // Add tokens from events after the compaction
    for (let i = lastCompactionIndex + 1; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      } else if (
        event.type === 'TOOL_RESULT' &&
        'tokenUsage' in event.data &&
        event.data.tokenUsage
      ) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      }
    }
  } else {
    // No compaction found, process all events (original behavior)
    for (const event of events) {
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      } else if (
        event.type === 'TOOL_RESULT' &&
        'tokenUsage' in event.data &&
        event.data.tokenUsage
      ) {
        totalPromptTokens += event.data.tokenUsage.promptTokens;
        totalCompletionTokens += event.data.tokenUsage.completionTokens;
        eventCount++;
      }
    }
  }

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
    eventCount,
  };
}

export function estimateConversationTokens(events: ThreadEvent[]): number {
  // Conservative estimation when actual counts aren't available
  let estimatedTokens = 0;

  for (const event of events) {
    if (event.type === 'USER_MESSAGE' || event.type === 'AGENT_MESSAGE') {
      const content = typeof event.data === 'string' ? event.data : event.data.content;
      estimatedTokens += Math.ceil(content.length / 4);
    } else if (event.type === 'TOOL_RESULT') {
      // Tool results can be large
      const resultText = JSON.stringify(event.data);
      estimatedTokens += Math.ceil(resultText.length / 4);
    }
  }

  return estimatedTokens;
}
