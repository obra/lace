// ABOUTME: Token estimation utilities for analysis and display
// ABOUTME: Provides consistent token counting across components

/**
 * Estimate token count for text content
 * Rough approximation: 1 token ≈ 4 characters for most models
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
