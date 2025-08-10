// ABOUTME: Type definitions for token management system
// ABOUTME: Interfaces for budget tracking, usage monitoring, and conversation optimization

export interface TokenBudgetConfig {
  maxTokens: number;
  warningThreshold: number; // Percentage (0.0 - 1.0) at which to trigger warnings
  reserveTokens: number; // Tokens to keep in reserve for final responses
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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

export interface TokenUsageInfo {
  // Current usage
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  // Context limits
  maxTokens: number;
  availableTokens: number;

  // Status
  percentUsed: number;
  nearLimit: boolean;

  // Tracking
  eventCount: number;
  lastCompactionAt?: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
