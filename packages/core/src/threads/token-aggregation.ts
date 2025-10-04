// ABOUTME: Utilities for aggregating token usage across thread events
// ABOUTME: Calculates current token counts from last API turn

import type { LaceEvent } from './types';

interface TokenSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

// Helper to validate and extract numeric token value
const validateTokenValue = (value: unknown): number => {
  if (typeof value !== 'number') return 0;
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
};

// Helper function to extract current context tokens from TokenUsageMetrics
const extractCurrentTokens = (tokenUsage: unknown): number => {
  if (!tokenUsage || typeof tokenUsage !== 'object') {
    return 0;
  }

  const usage = tokenUsage as Record<string, unknown>;

  // New format: context.currentTokens (or context.totalPromptTokens)
  if (usage.context && typeof usage.context === 'object' && usage.context !== null) {
    const context = usage.context as Record<string, unknown>;
    const currentTokens = validateTokenValue(context.currentTokens);
    if (currentTokens > 0) return currentTokens;

    // Fallback: context.totalPromptTokens (new field name)
    const totalPromptTokens = validateTokenValue(context.totalPromptTokens);
    if (totalPromptTokens > 0) return totalPromptTokens;
  }

  // Fallback: turn.inputTokens + turn.outputTokens
  if (usage.turn && typeof usage.turn === 'object' && usage.turn !== null) {
    const turn = usage.turn as Record<string, unknown>;
    const input = validateTokenValue(turn.inputTokens);
    const output = validateTokenValue(turn.outputTokens);
    return input + output;
  }

  // Legacy fallback: message.promptTokens + message.completionTokens
  if (usage.message && typeof usage.message === 'object' && usage.message !== null) {
    const message = usage.message as Record<string, unknown>;
    const prompt = validateTokenValue(message.promptTokens);
    const completion = validateTokenValue(message.completionTokens);
    return prompt + completion;
  }

  // Very old format: top-level promptTokens + completionTokens
  const prompt = validateTokenValue(usage.promptTokens);
  const completion = validateTokenValue(usage.completionTokens);
  if (prompt > 0 || completion > 0) {
    return prompt + completion;
  }

  return 0;
};

export function aggregateTokenUsage(events: LaceEvent[]): TokenSummary {
  // Find the most recent AGENT_MESSAGE with token usage
  // Returns current context window state (not cumulative)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'AGENT_MESSAGE' && event.data.tokenUsage) {
      const currentTokens = extractCurrentTokens(event.data.tokenUsage);
      return {
        totalPromptTokens: currentTokens,
        totalCompletionTokens: 0, // Not separately tracked in current state
        totalTokens: currentTokens,
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
