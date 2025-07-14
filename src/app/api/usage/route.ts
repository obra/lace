// ABOUTME: API endpoint for real Anthropic token usage and billing information

import { NextResponse } from 'next/server';
import { tokenUsageTracker, TokenUsageTracker } from '~/lib/tokenUsage';

export function GET() {
  try {
    const usage = tokenUsageTracker.getUsage();
    const apiKeyInfo = tokenUsageTracker.getApiKeyInfo();

    return NextResponse.json({
      success: true,
      data: {
        usage: {
          daily: {
            ...usage.daily,
            estimatedCostFormatted: TokenUsageTracker.formatCost(usage.daily.estimatedCost),
            totalTokensFormatted: TokenUsageTracker.formatTokens(usage.daily.totalTokens),
          },
          monthly: {
            ...usage.monthly,
            estimatedCostFormatted: TokenUsageTracker.formatCost(usage.monthly.estimatedCost),
            totalTokensFormatted: TokenUsageTracker.formatTokens(usage.monthly.totalTokens),
          },
          total: {
            ...usage.total,
            estimatedCostFormatted: TokenUsageTracker.formatCost(usage.total.estimatedCost),
            totalTokensFormatted: TokenUsageTracker.formatTokens(usage.total.totalTokens),
          },
        },
        apiKey: apiKeyInfo,
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Usage API error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch usage data',
      },
      { status: 500 }
    );
  }
}
