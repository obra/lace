// ABOUTME: Custom hook for loading and managing AI model provider information
// ABOUTME: Handles fetching provider catalog from API with loading states and error handling

import { useState, useEffect, useCallback } from 'react';
import type { ProviderInfo } from '@/types/api';
import { isApiError } from '@/types/api';
import { parseResponse } from '@/lib/serialization';

interface UseProvidersResult {
  providers: ProviderInfo[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useProviders(): UseProvidersResult {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/providers');
      const data: unknown = await parseResponse<unknown>(res);

      if (isApiError(data)) {
        const errorMessage = `Failed to load providers: ${data.error}`;
        console.error(errorMessage);
        setError(errorMessage);
        return;
      }

      const providersData = data as ProviderInfo[];
      setProviders(providersData || []);
    } catch (err) {
      const errorMessage = `Failed to load providers: ${err instanceof Error ? err.message : 'Unknown error'}`;
      console.error(errorMessage);
      setError(errorMessage);
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load providers on mount only - dependency on loadProviders would cause infinite re-render loop
  // since loadProviders is recreated on every render despite useCallback
  useEffect(() => {
    void loadProviders();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    providers,
    loading,
    error,
    refetch: loadProviders,
  };
}
