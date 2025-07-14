// ABOUTME: Real Anthropic API token usage tracking and billing estimation

import { getEnvVar } from '~/config/env-loader';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number; // in USD
  timestamp: Date;
}

export interface UsagePeriod {
  daily: TokenUsage;
  monthly: TokenUsage;
  total: TokenUsage;
}

// Current Anthropic pricing (as of 2024)
const ANTHROPIC_PRICING = {
  'claude-3-5-sonnet-20241022': {
    input: 3.0 / 1_000_000, // $3.00 per million input tokens
    output: 15.0 / 1_000_000, // $15.00 per million output tokens
  },
  'claude-3-haiku-20240307': {
    input: 0.25 / 1_000_000, // $0.25 per million input tokens
    output: 1.25 / 1_000_000, // $1.25 per million output tokens
  },
  'claude-3-opus-20240229': {
    input: 15.0 / 1_000_000, // $15.00 per million input tokens
    output: 75.0 / 1_000_000, // $75.00 per million output tokens
  },
};

export class TokenUsageTracker {
  private static instance: TokenUsageTracker;
  private usage: Map<string, TokenUsage[]> = new Map(); // key: date string

  static getInstance(): TokenUsageTracker {
    if (!this.instance) {
      this.instance = new TokenUsageTracker();
    }
    return this.instance;
  }

  // Track token usage from Anthropic response
  trackUsage(
    inputTokens: number,
    outputTokens: number,
    model: string = 'claude-3-5-sonnet-20241022'
  ): void {
    const today = new Date().toISOString().split('T')[0];
    const pricing =
      ANTHROPIC_PRICING[model as keyof typeof ANTHROPIC_PRICING] ||
      ANTHROPIC_PRICING['claude-3-5-sonnet-20241022'];

    const cost = inputTokens * pricing.input + outputTokens * pricing.output;

    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCost: cost,
      timestamp: new Date(),
    };

    const dayUsage = this.usage.get(today) || [];
    dayUsage.push(usage);
    this.usage.set(today, dayUsage);

    // Keep only last 30 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    for (const [date] of this.usage.entries()) {
      if (new Date(date) < cutoffDate) {
        this.usage.delete(date);
      }
    }
  }

  // Get usage for different periods
  getUsage(): UsagePeriod {
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    const dailyUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      timestamp: new Date(),
    };

    const monthlyUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      timestamp: new Date(),
    };

    const totalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      timestamp: new Date(),
    };

    // Calculate daily usage
    const todayUsage = this.usage.get(today) || [];
    for (const usage of todayUsage) {
      dailyUsage.inputTokens += usage.inputTokens;
      dailyUsage.outputTokens += usage.outputTokens;
      dailyUsage.totalTokens += usage.totalTokens;
      dailyUsage.estimatedCost += usage.estimatedCost;
    }

    // Calculate monthly and total usage
    for (const [date, dayUsages] of this.usage.entries()) {
      for (const usage of dayUsages) {
        totalUsage.inputTokens += usage.inputTokens;
        totalUsage.outputTokens += usage.outputTokens;
        totalUsage.totalTokens += usage.totalTokens;
        totalUsage.estimatedCost += usage.estimatedCost;

        if (date.startsWith(thisMonth)) {
          monthlyUsage.inputTokens += usage.inputTokens;
          monthlyUsage.outputTokens += usage.outputTokens;
          monthlyUsage.totalTokens += usage.totalTokens;
          monthlyUsage.estimatedCost += usage.estimatedCost;
        }
      }
    }

    return {
      daily: dailyUsage,
      monthly: monthlyUsage,
      total: totalUsage,
    };
  }

  // Get API key info (masked)
  getApiKeyInfo(): { hasKey: boolean; maskedKey?: string } {
    const apiKey = getEnvVar('ANTHROPIC_KEY');
    if (!apiKey) {
      return { hasKey: false };
    }

    return {
      hasKey: true,
      maskedKey: `sk-ant-...${apiKey.slice(-6)}`,
    };
  }

  // Format cost as currency
  static formatCost(cost: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4,
    }).format(cost);
  }

  // Format token count with commas
  static formatTokens(tokens: number): string {
    return new Intl.NumberFormat('en-US').format(tokens);
  }
}

// Export singleton instance
export const tokenUsageTracker = TokenUsageTracker.getInstance();
