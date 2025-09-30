// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSessionEvents } from '@/components/providers/EventStreamProvider';
import type { ThreadId, CombinedTokenUsage, ThreadTokenUsage } from '@/types/core';
import type { LaceEvent } from '@/types/core';
import type { AgentWithTokenUsage } from '@/types/api';
import { api } from '@/lib/api-client';
import { AbortError } from '@/lib/api-errors';

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

  // Listen for AGENT_MESSAGE events that include token usage updates
  const handleAgentMessage = useCallback(
    (event: LaceEvent) => {
      // Check if this event is for our agent, is AGENT_MESSAGE type, and has token usage data
      // Note: TokenUsage is now directly at event.data.tokenUsage (no more double nesting)
      if (
        event.context?.threadId === agentId &&
        event.type === 'AGENT_MESSAGE' &&
        event.data &&
        typeof event.data === 'object' &&
        'tokenUsage' in event.data
      ) {
        const tokenUsageData = (event.data as { tokenUsage: CombinedTokenUsage }).tokenUsage;

        // Extract context window usage (try new format first, fallback to old)
        const contextData =
          tokenUsageData?.context || (tokenUsageData as unknown as Record<string, unknown>)?.thread;

        if (contextData && typeof contextData === 'object') {
          const ctx = contextData as unknown as Record<string, unknown>;

          // Try new field names first
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

          const completeTokenUsage: AgentTokenUsage = {
            totalPromptTokens: currentTokens,
            totalCompletionTokens: 0, // Not separately tracked
            totalTokens: currentTokens,
            contextLimit,
            percentUsed: typeof ctx.percentUsed === 'number' ? ctx.percentUsed : 0,
            nearLimit: !!ctx.nearLimit,
          };

          setTokenUsage(completeTokenUsage);
        }
      }
    },
    [agentId]
  );

  // Use shared event stream context for real-time updates
  const { events } = useSessionEvents();

  // Find latest agent message with O(1) reverse scan using useMemo
  const latestAgentMessage = useMemo(() => {
    // Reverse scan to find the latest AGENT_MESSAGE for this agent
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.context?.threadId === agentId && event.type === 'AGENT_MESSAGE') {
        return event;
      }
    }
    return null;
  }, [events, agentId]);

  // Handle latest agent message for token updates
  useEffect(() => {
    if (latestAgentMessage) {
      handleAgentMessage(latestAgentMessage);
    }
  }, [latestAgentMessage, handleAgentMessage]);

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
