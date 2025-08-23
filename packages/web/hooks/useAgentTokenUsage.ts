// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback, useRef } from 'react';
import { useEventStream } from './useEventStream';
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
  refetch: () => void;
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
        event.threadId === agentId &&
        event.type === 'AGENT_MESSAGE' &&
        event.data &&
        typeof event.data === 'object' &&
        'tokenUsage' in event.data
      ) {
        const tokenUsageData = (event.data as { tokenUsage: CombinedTokenUsage }).tokenUsage;

        // Transform CombinedTokenUsage to AgentTokenUsage by extracting thread-level data
        const threadData = tokenUsageData?.thread;
        if (
          threadData &&
          typeof threadData === 'object' &&
          typeof (threadData as { totalTokens?: number }).totalTokens === 'number'
        ) {
          const safeThreadData = threadData as Partial<AgentTokenUsage>;
          const completeTokenUsage: AgentTokenUsage = {
            totalPromptTokens: safeThreadData.totalPromptTokens ?? 0,
            totalCompletionTokens: safeThreadData.totalCompletionTokens ?? 0,
            totalTokens: safeThreadData.totalTokens!,
            contextLimit: safeThreadData.contextLimit ?? 0,
            percentUsed: safeThreadData.percentUsed ?? 0,
            nearLimit: !!safeThreadData.nearLimit,
          };

          setTokenUsage(completeTokenUsage);
        }
      }
    },
    [agentId]
  );

  // Set up SSE event listener for real-time updates
  useEventStream({
    threadIds: [agentId],
    onAgentMessage: handleAgentMessage,
  });

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
