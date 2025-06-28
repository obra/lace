// ABOUTME: Token estimation utilities for UI display and analysis
// ABOUTME: Provides consistent token counting across components

import { Timeline } from '../interfaces/thread-processor.js';

/**
 * Estimate token count for text content
 * Rough approximation: 1 token ≈ 4 characters for most models
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate input and output tokens for a timeline
 * Used for delegation tracking and conversation analysis
 */
export function calculateTokens(timeline: Timeline): { tokensIn: number; tokensOut: number } {
  let tokensIn = 0;
  let tokensOut = 0;

  timeline.items.forEach((item) => {
    if (item.type === 'user_message') {
      tokensIn += estimateTokens(item.content);
    } else if (item.type === 'agent_message') {
      tokensOut += estimateTokens(item.content);
    } else if (item.type === 'tool_execution') {
      // Tool results count as input to the agent
      const resultText = item.result?.content?.[0]?.text;
      if (resultText) {
        tokensIn += estimateTokens(resultText);
      }
    }
  });

  return { tokensIn, tokensOut };
}

/**
 * Format token count for display (e.g., 1500 -> "1.5k")
 */
export function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}
