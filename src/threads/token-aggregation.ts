// ABOUTME: Utilities for aggregating token usage across thread events
// ABOUTME: Calculates cumulative token counts from conversation history

import type { ThreadEvent } from '~/threads/types';

export interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

export function aggregateTokenUsage(events: ThreadEvent[]): TokenSummary {
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Find the most recent COMPACTION event
  let lastCompactionIndex = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'COMPACTION') {
      lastCompactionIndex = i;
      break;
    }
  }

  // Helper function to extract tokens from CombinedTokenUsage or old format
  const extractTokens = (tokenUsage: unknown): { promptTokens: number; completionTokens: number } => {
    if (!tokenUsage || typeof tokenUsage !== 'object') {
      return { promptTokens: 0, completionTokens: 0 };
    }
    
    const usage = tokenUsage as Record<string, unknown>;
    
    // Handle new CombinedTokenUsage format - use message tokens for aggregation
    if (usage.message && typeof usage.message === 'object') {
      const message = usage.message as Record<string, unknown>;
      return {
        promptTokens: typeof message.promptTokens === 'number' ? message.promptTokens : 0,
        completionTokens: typeof message.completionTokens === 'number' ? message.completionTokens : 0,
      };
    } 
    
    // Old format fallback
    return {
      promptTokens: typeof usage.promptTokens === 'number' ? usage.promptTokens : 0,
      completionTokens: typeof usage.completionTokens === 'number' ? usage.completionTokens : 0,
    };
  };

  // If there's a compaction, only count:
  // 1. The summary events from the most recent compaction
  // 2. Events that come after the most recent compaction
  if (lastCompactionIndex >= 0) {
    const compactionEvent = events[lastCompactionIndex];

    // Add tokens from the compaction summary events
    if (compactionEvent.type === 'COMPACTION') {
      for (const summaryEvent of compactionEvent.data.compactedEvents) {
        if (summaryEvent.type === 'AGENT_MESSAGE' && summaryEvent.data.tokenUsage) {
          const tokens = extractTokens(summaryEvent.data.tokenUsage);
          totalPromptTokens += tokens.promptTokens;
          totalCompletionTokens += tokens.completionTokens;
        } else if (
          summaryEvent.type === 'TOOL_RESULT' &&
          'tokenUsage' in summaryEvent.data &&
          summaryEvent.data.tokenUsage
        ) {
          const tokens = extractTokens(summaryEvent.data.tokenUsage);
          totalPromptTokens += tokens.promptTokens;
          totalCompletionTokens += tokens.completionTokens;
        }
      }
    }

    // Add tokens from events after the compaction
    for (let i = lastCompactionIndex + 1; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        const tokens = extractTokens(event.data.tokenUsage);
        totalPromptTokens += tokens.promptTokens;
        totalCompletionTokens += tokens.completionTokens;
      } else if (
        event.type === 'TOOL_RESULT' &&
        'tokenUsage' in event.data &&
        event.data.tokenUsage
      ) {
        const tokens = extractTokens(event.data.tokenUsage);
        totalPromptTokens += tokens.promptTokens;
        totalCompletionTokens += tokens.completionTokens;
      }
    }
  } else {
    // No compaction found, process all events (original behavior)
    for (const event of events) {
      if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
        const tokens = extractTokens(event.data.tokenUsage);
        totalPromptTokens += tokens.promptTokens;
        totalCompletionTokens += tokens.completionTokens;
      } else if (
        event.type === 'TOOL_RESULT' &&
        'tokenUsage' in event.data &&
        event.data.tokenUsage
      ) {
        const tokens = extractTokens(event.data.tokenUsage);
        totalPromptTokens += tokens.promptTokens;
        totalCompletionTokens += tokens.completionTokens;
      }
    }
  }

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
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
