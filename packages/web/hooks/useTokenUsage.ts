// ABOUTME: Hook for fetching real Anthropic token usage and billing data
// ABOUTME: Provides real-time token consumption statistics and cost estimates

import { useState, useEffect } from 'react';

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  estimatedCostFormatted: string;
  totalTokensFormatted: string;
  timestamp: Date;
}

export interface UsageResponse {
  success: boolean;
  data?: {
    usage: {
      daily: TokenUsageData;
      monthly: TokenUsageData;
      total: TokenUsageData;
    };
    apiKey: {
      hasKey: boolean;
      provider?: string;
      keyType?: string;
    };
    lastUpdated: string;
  };
  error?: string;
}

export function useTokenUsage() {
  const [usage, setUsage] = useState<UsageResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/usage');
      const data = (await response.json()) as UsageResponse;

      if (data.success && data.data) {
        setUsage(data.data);
      } else {
        setError(data.error || 'Failed to fetch usage data');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchUsage();

    // Refresh usage data every 30 seconds
    const interval = setInterval(() => {
      void fetchUsage();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return {
    usage,
    loading,
    error,
    refetch: fetchUsage,
  };
}