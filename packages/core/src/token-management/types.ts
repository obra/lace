// ABOUTME: Type definitions for token management system
// ABOUTME: Interfaces for budget tracking, usage monitoring, and conversation optimization

// Token usage tracking types

/**
 * Token counts for a single API turn
 */
interface TurnTokenUsage {
  inputTokens: number; // Tokens sent to API this turn
  outputTokens: number; // Tokens received from API this turn
  totalTokens: number; // inputTokens + outputTokens
}

/**
 * Current context window state (what would be sent if user types now)
 */
export interface ContextWindowUsage {
  currentTokens: number; // Current conversation size (last input + last output)
  limit: number; // Model's context window size
  percentUsed: number; // currentTokens / limit
  nearLimit: boolean; // percentUsed >= 0.8
}

/**
 * Token usage metrics for an API turn
 * Stores both the turn's usage and the resulting context state
 */
export interface TokenUsageMetrics {
  turn?: TurnTokenUsage; // This specific turn's token counts
  context: ContextWindowUsage; // Current context window state after this turn
}

// Legacy type with old field names for backwards compatibility
export interface ThreadTokenUsage {
  totalPromptTokens: number; // Renamed from currentTokens
  totalCompletionTokens: number; // Always 0 in new design
  totalTokens: number; // Same as totalPromptTokens
  contextLimit: number; // Renamed from limit
  percentUsed: number;
  nearLimit: boolean;
}

// Legacy type aliases for backwards compatibility
export type MessageTokenUsage = TurnTokenUsage;
export type CombinedTokenUsage = TokenUsageMetrics;
