// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionEvents } from '@lace/web/components/providers/EventStreamProvider';
import type { ThreadId, CombinedTokenUsage, ThreadTokenUsage } from '@lace/web/types/core';
import type { LaceEvent } from '@lace/web/types/core';
import type { AgentWithTokenUsage } from '@lace/web/types/api';
import { api } from '@lace/web/lib/api-client';
import { AbortError } from '@lace/web/lib/api-errors';

// Use the same type structure as the API
type AgentTokenUsage = ThreadTokenUsage;

export interface UseAgentTokenUsageResult {
  tokenUsage: AgentTokenUsage | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useAgentTokenUsage(agentId: ThreadId): UseAgentTokenUsageResult {
  const [tokenUsage, setTokenUsage] = useState<AgentTokenUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load initial token usage from agent API
  const fetchTokenUsage = useCallback(async () => {
    // Abort previous request to prevent race conditions
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      setError(null);

      const data = await api.get<AgentWithTokenUsage>(`/api/agents/${agentId}`, {
        signal: controller.signal,
      });

      // If request was aborted, don't update state
      if (controller.signal.aborted) {
        return;
      }

      if (data.tokenUsage) {
        setTokenUsage(data.tokenUsage);
      }
    } catch (err) {
      // Check for both DOMException AbortError and our custom AbortError class
      if ((err instanceof DOMException && err.name === 'AbortError') || err instanceof AbortError) {
        // Abort is intentional when component unmounts or agentId changes
        // Don't log or set error state
        return;
      }

      console.error('[useAgentTokenUsage] Error fetching token usage:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch token usage');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Extract token usage from event data
  const extractTokenUsageFromEvent = useCallback((tokenUsageData: CombinedTokenUsage) => {
    // Extract context window usage (try new format first, fallback to old)
    const contextData =
      tokenUsageData?.context || (tokenUsageData as unknown as Record<string, unknown>)?.thread;

    if (!contextData || typeof contextData !== 'object') {
      return null;
    }

    const ctx = contextData as unknown as Record<string, unknown>;

    const currentTokens =
      typeof ctx.totalPromptTokens === 'number'
        ? ctx.totalPromptTokens
        : typeof ctx.currentTokens === 'number'
          ? ctx.currentTokens
          : 0;

    const contextLimit =
      typeof ctx.contextLimit === 'number'
        ? ctx.contextLimit
        : typeof ctx.limit === 'number'
          ? ctx.limit
          : 0;

    return {
      totalPromptTokens: currentTokens,
      totalCompletionTokens: 0, // Not separately tracked
      totalTokens: currentTokens,
      contextLimit,
      percentUsed: typeof ctx.percentUsed === 'number' ? ctx.percentUsed : 0,
      nearLimit: !!ctx.nearLimit,
    };
  }, []);

  // Listen for AGENT_MESSAGE and TOKEN_USAGE_UPDATE events
  const handleTokenUpdate = useCallback(
    (event: LaceEvent) => {
      // Skip events not for this agent
      if (event.context?.threadId !== agentId) {
        return;
      }

      // Both AGENT_MESSAGE and TOKEN_USAGE_UPDATE can contain token usage
      if (
        (event.type === 'AGENT_MESSAGE' || event.type === 'TOKEN_USAGE_UPDATE') &&
        event.data &&
        typeof event.data === 'object' &&
        'tokenUsage' in event.data
      ) {
        const tokenUsageData = (event.data as { tokenUsage: CombinedTokenUsage }).tokenUsage;
        const extracted = extractTokenUsageFromEvent(tokenUsageData);

        if (extracted) {
          setTokenUsage(extracted);
        }
      }
    },
    [agentId, extractTokenUsageFromEvent]
  );

  // Use shared event stream context for real-time updates
  const { events } = useSessionEvents();

  // Find latest token-relevant event (AGENT_MESSAGE or TOKEN_USAGE_UPDATE) with O(1) reverse scan
  const latestTokenEvent = useMemo(() => {
    // Reverse scan to find the latest event with token data for this agent
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (
        event.context?.threadId === agentId &&
        (event.type === 'AGENT_MESSAGE' || event.type === 'TOKEN_USAGE_UPDATE')
      ) {
        return event;
      }
    }
    return null;
  }, [events, agentId]);

  // Handle latest token event for token updates
  useEffect(() => {
    if (latestTokenEvent) {
      handleTokenUpdate(latestTokenEvent);
    }
  }, [latestTokenEvent, handleTokenUpdate]);

  // Initial load on mount or agentId change
  useEffect(() => {
    void fetchTokenUsage();

    // Cleanup function to abort request on unmount
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [fetchTokenUsage]);

  return {
    tokenUsage,
    loading,
    error,
    refetch: fetchTokenUsage,
  };
}
