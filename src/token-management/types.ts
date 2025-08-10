// ABOUTME: Type definitions for token management system
// ABOUTME: Interfaces for budget tracking, usage monitoring, and conversation optimization

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

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
