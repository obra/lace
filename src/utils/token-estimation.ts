// ABOUTME: Token estimation utilities for analysis and display
// ABOUTME: Provides consistent token counting across components

/**
 * Estimate token count for text content
 * Rough approximation: 1 token ≈ 4 characters for most models
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
