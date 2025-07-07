// ABOUTME: Tracks and manages token usage across conversations with proactive budget enforcement
// ABOUTME: Prevents token exhaustion by monitoring usage and providing recommendations for optimization

import { ProviderResponse } from '~/providers/base-provider.js';
import { logger } from '~/utils/logger.js';
import {
  TokenBudgetConfig,
  TokenUsage,
  BudgetStatus,
  BudgetRecommendations,
  ConversationMessage,
} from '~/token-management/types.js';

export class TokenBudgetManager {
  private readonly _config: TokenBudgetConfig;
  private _totalUsage: TokenUsage;

  constructor(config: TokenBudgetConfig) {
    this._config = { ...config };
    this._totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
  }

  /**
   * Records token usage from a provider response
   */
  recordUsage(response: ProviderResponse): void {
    if (!response.usage) {
      logger.debug('No usage data in provider response, skipping token tracking');
      return;
    }

    const usage = response.usage;

    // Handle edge cases with negative or invalid values
    const promptTokens = Math.max(0, usage.promptTokens || 0);
    const completionTokens = Math.max(0, usage.completionTokens || 0);
    const totalTokens = Math.max(0, usage.totalTokens || promptTokens + completionTokens);

    this._totalUsage.promptTokens += promptTokens;
    this._totalUsage.completionTokens += completionTokens;
    this._totalUsage.totalTokens += totalTokens;

    logger.debug('Token usage recorded', {
      currentRequest: { promptTokens, completionTokens, totalTokens },
      cumulativeUsage: this._totalUsage,
      budgetStatus: this.getBudgetStatus(),
    });

    // Log warnings if approaching limits
    if (this.isNearLimit()) {
      logger.warn('Approaching token budget limit', {
        usage: this._totalUsage,
        budgetStatus: this.getBudgetStatus(),
        recommendations: this.getRecommendations(),
      });
    }
  }

  /**
   * Checks if a request of the given size can be made within budget
   */
  canMakeRequest(estimatedTokens: number): boolean {
    const availableTokens = this.getAvailableTokens();
    return estimatedTokens <= availableTokens;
  }

  /**
   * Checks if we're approaching the token limit (based on warning threshold)
   */
  isNearLimit(): boolean {
    const usagePercentage = this.getUsagePercentage();
    return usagePercentage >= this._config.warningThreshold;
  }

  /**
   * Gets current token usage totals
   */
  getTotalUsage(): number {
    return this._totalUsage.totalTokens;
  }

  getPromptTokens(): number {
    return this._totalUsage.promptTokens;
  }

  getCompletionTokens(): number {
    return this._totalUsage.completionTokens;
  }

  /**
   * Gets comprehensive budget status
   */
  getBudgetStatus(): BudgetStatus {
    const effectiveLimit = this._config.maxTokens - this._config.reserveTokens;
    const availableTokens = Math.max(0, effectiveLimit - this._totalUsage.totalTokens);
    const usagePercentage =
      this._config.maxTokens > 0 ? this._totalUsage.totalTokens / this._config.maxTokens : 1;

    return {
      totalUsed: this._totalUsage.totalTokens,
      maxTokens: this._config.maxTokens,
      availableTokens,
      usagePercentage,
      warningTriggered: this.isNearLimit(),
      effectiveLimit,
      promptTokens: this._totalUsage.promptTokens,
      completionTokens: this._totalUsage.completionTokens,
    };
  }

  /**
   * Gets current usage as a percentage of total budget
   */
  getUsagePercentage(): number {
    if (this._config.maxTokens === 0) return 1;
    return this._totalUsage.totalTokens / this._config.maxTokens;
  }

  /**
   * Gets available tokens for next request (considering reserves)
   */
  getAvailableTokens(): number {
    const effectiveLimit = this._config.maxTokens - this._config.reserveTokens;
    return Math.max(0, effectiveLimit - this._totalUsage.totalTokens);
  }

  /**
   * Estimates token count for conversation messages
   */
  estimateConversationTokens(messages: ConversationMessage[]): number {
    // Conservative estimation: ~4 characters per token, plus some overhead
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const baseEstimate = Math.ceil(totalChars / 4);

    // Add overhead for role names, formatting, etc.
    const overhead = messages.length * 10; // ~10 tokens per message for formatting

    return baseEstimate + overhead;
  }

  /**
   * Gets recommendations for conversation optimization
   */
  getRecommendations(): BudgetRecommendations {
    const status = this.getBudgetStatus();
    const usagePercentage = status.usagePercentage;

    if (usagePercentage < this._config.warningThreshold) {
      // Budget is healthy
      return {
        shouldSummarize: false,
        shouldPrune: false,
        maxRequestSize: status.availableTokens,
      };
    }

    // Approaching or exceeding limits
    const recommendations: BudgetRecommendations = {
      shouldSummarize: usagePercentage > 0.7, // Summarize when > 70%
      shouldPrune: usagePercentage > 0.8, // Prune when > 80%
      maxRequestSize: Math.min(status.availableTokens, Math.floor(this._config.maxTokens * 0.1)), // Limit to 10% of total budget
    };

    if (usagePercentage >= this._config.warningThreshold) {
      recommendations.warningMessage =
        `Token usage is approaching token limit (${Math.round(usagePercentage * 100)}% used). ` +
        `Consider summarizing the conversation or reducing request size.`;
    }

    if (status.availableTokens < 50) {
      recommendations.warningMessage =
        `Very few tokens remaining (${status.availableTokens}). ` +
        `Conversation summarization or reset recommended.`;
    }

    return recommendations;
  }

  /**
   * Resets token usage tracking
   */
  reset(): void {
    this._totalUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    logger.debug('Token budget reset', {
      config: this._config,
    });
  }

  /**
   * Updates budget configuration
   */
  updateConfig(newConfig: Partial<TokenBudgetConfig>): void {
    Object.assign(this._config, newConfig);

    logger.debug('Token budget configuration updated', {
      newConfig: this._config,
      currentUsage: this._totalUsage,
    });

    // Check if new config puts us over budget
    if (this.isNearLimit()) {
      logger.warn('Configuration update triggered budget warning', {
        config: this._config,
        usage: this._totalUsage,
        budgetStatus: this.getBudgetStatus(),
      });
    }
  }
}
