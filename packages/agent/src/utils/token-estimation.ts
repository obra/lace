// ABOUTME: Token estimation utilities for analysis and display
// ABOUTME: Provides consistent token counting across components
// ABOUTME: Deliberately dependency-free — compaction's toolkit is imported across
// ABOUTME: checkouts by plugins, and reaching these through message-builder pulled
// ABOUTME: the whole storage layer (and better-sqlite3) in behind them.

import type { ContentBlock, ProviderMessage } from '@lace/agent/providers/base-provider';

/**
 * Estimate token count for text content
 * Rough approximation: 1 token ≈ 4 characters for most models
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimates the total token count for a set of provider messages.
 * Includes content tokens, tool call tokens, and tool result tokens.
 *
 * Text only: images and other non-text blocks contribute nothing, so callers
 * sizing a payload against a context window are reading a floor, not a total.
 */
export function estimateProviderTokens(messages: ProviderMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += estimateTokens(message.content);
    } else {
      // Count tokens for text blocks only (images don't count as text tokens)
      const textContent = message.content
        .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      total += estimateTokens(textContent);
    }
    if (message.toolCalls) {
      total += estimateTokens(JSON.stringify(message.toolCalls));
    }
    if (message.toolResults) {
      total += estimateTokens(JSON.stringify(message.toolResults));
    }
  }
  return total;
}
