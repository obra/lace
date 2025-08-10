// ABOUTME: Type definitions for token management system
// ABOUTME: Interfaces for budget tracking, usage monitoring, and conversation optimization

export interface TokenBudgetConfig {
  maxTokens: number;
  warningThreshold: number; // Percentage (0.0 - 1.0) at which to trigger warnings
  reserveTokens: number; // Tokens to keep in reserve for final responses
}

// NEW CANONICAL TYPES - Single source of truth for token usage

/**
 * For individual message/request token counts
 */
export interface MessageTokenUsage {
  promptTokens: number; // Tokens in this specific message's prompt
  completionTokens: number; // Tokens in this specific message's completion
  totalTokens: number; // promptTokens + completionTokens for this message
}

/**
 * For cumulative thread-level token tracking
 */
export interface ThreadTokenUsage {
  // Cumulative totals across all messages in thread
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;

  // Context management
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
}

/**
 * For contexts needing both message and thread token usage
 */
export interface CombinedTokenUsage {
  message?: MessageTokenUsage; // Current message token usage
  thread: ThreadTokenUsage; // Thread-level cumulative usage
}

export interface BudgetStatus {
  totalUsed: number;
  maxTokens: number;
  availableTokens: number;
  usagePercentage: number;
  warningTriggered: boolean;
  effectiveLimit: number; // maxTokens - reserveTokens
  promptTokens: number;
  completionTokens: number;
}

export interface BudgetRecommendations {
  shouldSummarize: boolean;
  shouldPrune: boolean;
  maxRequestSize: number;
  warningMessage?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
