// ABOUTME: Utilities for aggregating token usage across thread events
// ABOUTME: Calculates current token counts from last API turn

import type { LaceEvent } from '~/threads/types';

interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
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

export function aggregateTokenUsage(events: LaceEvent[]): TokenSummary {
  // Find the most recent AGENT_MESSAGE with token usage
  // Current context = last input + last output (output is now in conversation)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
      const tokens = extractTokens(event.data.tokenUsage);
      return {
        totalPromptTokens: tokens.promptTokens,
        totalCompletionTokens: tokens.completionTokens,
        totalTokens: tokens.promptTokens + tokens.completionTokens,
      };
    }
  }

  // No AGENT_MESSAGE found, return zeros
  return {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
  };
}

export function estimateConversationTokens(events: LaceEvent[]): number {
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
