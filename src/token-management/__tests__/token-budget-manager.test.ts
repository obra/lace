// ABOUTME: Tests for TokenBudgetManager that tracks and manages token usage across conversations
// ABOUTME: Ensures proactive token budget management prevents max_tokens exhaustion scenarios

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetManager } from '~/token-management/token-budget-manager.js';
import { ProviderResponse } from '~/providers/base-provider.js';

describe('TokenBudgetManager', () => {
  let budgetManager: TokenBudgetManager;

  beforeEach(() => {
    budgetManager = new TokenBudgetManager({
      maxTokens: 1000,
      warningThreshold: 0.8, // Warn at 80% usage
      reserveTokens: 100, // Keep 100 tokens in reserve
    });
  });

  describe('token tracking', () => {
    it('should track token usage from provider responses', () => {
      const response: ProviderResponse = {
        content: 'Hello world',
        toolCalls: [],
        usage: {
          promptTokens: 50,
          completionTokens: 30,
          totalTokens: 80,
        },
      };

      budgetManager.recordUsage(response);

      expect(budgetManager.getTotalUsage()).toBe(80);
      expect(budgetManager.getPromptTokens()).toBe(50);
      expect(budgetManager.getCompletionTokens()).toBe(30);
    });

    it('should accumulate usage across multiple responses', () => {
      const responses: ProviderResponse[] = [
        {
          content: 'First response',
          toolCalls: [],
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
        },
        {
          content: 'Second response',
          toolCalls: [],
          usage: { promptTokens: 60, completionTokens: 40, totalTokens: 100 },
        },
      ];

      responses.forEach((response) => budgetManager.recordUsage(response));

      expect(budgetManager.getTotalUsage()).toBe(180);
      expect(budgetManager.getPromptTokens()).toBe(110);
      expect(budgetManager.getCompletionTokens()).toBe(70);
    });

    it('should handle responses without usage data gracefully', () => {
      const response: ProviderResponse = {
        content: 'No usage data',
        toolCalls: [],
      };

      budgetManager.recordUsage(response);

      expect(budgetManager.getTotalUsage()).toBe(0);
    });
  });

  describe('budget enforcement', () => {
    it('should allow requests when under budget', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      expect(budgetManager.canMakeRequest(200)).toBe(true);
      expect(budgetManager.isNearLimit()).toBe(false);
    });

    it('should reject requests that would exceed budget', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 700, completionTokens: 100, totalTokens: 800 },
      });

      // Request for 300 tokens would exceed the 1000 limit
      expect(budgetManager.canMakeRequest(300)).toBe(false);
    });

    it('should consider reserve tokens in budget calculations', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 600, completionTokens: 200, totalTokens: 800 },
      });

      // 800 used + 150 requested = 950, but with 100 reserve = effective limit of 900
      expect(budgetManager.canMakeRequest(150)).toBe(false);
      expect(budgetManager.canMakeRequest(100)).toBe(true);
    });

    it('should warn when approaching token limit', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 600, completionTokens: 220, totalTokens: 820 },
      });

      // 820 tokens > 80% of 1000 (800 tokens)
      expect(budgetManager.isNearLimit()).toBe(true);
      expect(budgetManager.getBudgetStatus().warningTriggered).toBe(true);
    });
  });

  describe('budget status and reporting', () => {
    it('should provide comprehensive budget status', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 300, completionTokens: 200, totalTokens: 500 },
      });

      const status = budgetManager.getBudgetStatus();

      expect(status).toEqual({
        totalUsed: 500,
        maxTokens: 1000,
        availableTokens: 400, // 900 effective limit - 500 used
        usagePercentage: 0.5,
        warningTriggered: false,
        effectiveLimit: 900, // 1000 - 100 reserve
        promptTokens: 300,
        completionTokens: 200,
      });
    });

    it('should calculate usage percentage correctly', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 250, completionTokens: 250, totalTokens: 500 },
      });

      expect(budgetManager.getUsagePercentage()).toBe(0.5);
    });

    it('should provide estimated tokens remaining for next request', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 600, completionTokens: 200, totalTokens: 800 },
      });

      // 900 effective limit - 800 used = 100 tokens available
      expect(budgetManager.getAvailableTokens()).toBe(100);
    });
  });

  describe('budget reset and management', () => {
    it('should reset usage when requested', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 400, completionTokens: 300, totalTokens: 700 },
      });

      expect(budgetManager.getTotalUsage()).toBe(700);

      budgetManager.reset();

      expect(budgetManager.getTotalUsage()).toBe(0);
      expect(budgetManager.getPromptTokens()).toBe(0);
      expect(budgetManager.getCompletionTokens()).toBe(0);
    });

    it('should update budget configuration', () => {
      budgetManager.updateConfig({
        maxTokens: 2000,
        warningThreshold: 0.9,
        reserveTokens: 200,
      });

      const status = budgetManager.getBudgetStatus();
      expect(status.maxTokens).toBe(2000);
      expect(status.effectiveLimit).toBe(1800); // 2000 - 200 reserve
    });
  });

  describe('conversation context estimation', () => {
    it('should estimate token count for conversation messages', () => {
      const messages = [
        { role: 'user' as const, content: 'Hello, how are you?' },
        { role: 'assistant' as const, content: 'I am doing well, thank you for asking!' },
      ];

      const estimate = budgetManager.estimateConversationTokens(messages);

      expect(estimate).toBeGreaterThan(0);
      expect(typeof estimate).toBe('number');
    });

    it('should provide conservative estimates for token counting', () => {
      const longMessage = 'A'.repeat(1000); // 1000 characters
      const messages = [{ role: 'user' as const, content: longMessage }];

      const estimate = budgetManager.estimateConversationTokens(messages);

      // Should be roughly 250 tokens (4 chars per token), but conservative
      expect(estimate).toBeGreaterThan(200);
      expect(estimate).toBeLessThan(400);
    });
  });

  describe('proactive warnings and recommendations', () => {
    it('should provide recommendations when approaching limits', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 700, completionTokens: 150, totalTokens: 850 },
      });

      const recommendations = budgetManager.getRecommendations();

      expect(recommendations.shouldSummarize).toBe(true);
      expect(recommendations.shouldPrune).toBe(true);
      expect(recommendations.maxRequestSize).toBeLessThan(100);
      expect(recommendations.warningMessage).toContain('approaching token limit');
    });

    it('should not recommend action when budget is healthy', () => {
      budgetManager.recordUsage({
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      });

      const recommendations = budgetManager.getRecommendations();

      expect(recommendations.shouldSummarize).toBe(false);
      expect(recommendations.shouldPrune).toBe(false);
      expect(recommendations.warningMessage).toBeUndefined();
    });
  });

  describe('error cases and edge conditions', () => {
    it('should handle negative token values gracefully', () => {
      const invalidResponse: ProviderResponse = {
        content: 'Test',
        toolCalls: [],
        usage: { promptTokens: -10, completionTokens: 50, totalTokens: 40 },
      };

      budgetManager.recordUsage(invalidResponse);

      // Should handle gracefully, possibly ignoring negative values
      expect(budgetManager.getTotalUsage()).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large token requests', () => {
      expect(budgetManager.canMakeRequest(10000)).toBe(false);
      expect(budgetManager.canMakeRequest(Number.MAX_SAFE_INTEGER)).toBe(false);
    });

    it('should handle zero-token budget edge case', () => {
      const zeroBudgetManager = new TokenBudgetManager({
        maxTokens: 0,
        warningThreshold: 0.8,
        reserveTokens: 0,
      });

      expect(zeroBudgetManager.canMakeRequest(1)).toBe(false);
      expect(zeroBudgetManager.isNearLimit()).toBe(true);
    });
  });
});
