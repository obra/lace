// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback, useRef } from 'react';
import { useEventStream } from './useEventStream';
import type { ThreadId, CombinedTokenUsage, AgentInfo, ThreadTokenUsage } from '@/types/core';
import type { LaceEvent } from '@/types/core';
import type { AgentWithTokenUsage } from '@/types/api';
import { api } from '@/lib/api-client';

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

      console.log('[useAgentTokenUsage] Fetching token usage for agent:', agentId);
      const data = await api.get<AgentWithTokenUsage>(`/api/agents/${agentId}`, {
        signal: controller.signal,
      });
      console.log('[useAgentTokenUsage] API response:', {
        hasTokenUsage: !!data.tokenUsage,
        tokenUsage: data.tokenUsage,
      });

      if (data.tokenUsage) {
        console.log('[useAgentTokenUsage] Setting initial token usage:', data.tokenUsage);
        setTokenUsage(data.tokenUsage);
      } else {
        console.log('[useAgentTokenUsage] No token usage data in API response');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[useAgentTokenUsage] Error fetching token usage:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch token usage');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Listen for AGENT_MESSAGE events that include token usage updates
  const handleAgentMessage = useCallback(
    (event: LaceEvent) => {
      console.log('[useAgentTokenUsage] Received event:', {
        eventType: event.type,
        eventThreadId: event.threadId,
        targetAgentId: agentId,
        eventData: event.data,
        hasTokenUsage: !!(
          event.data &&
          typeof event.data === 'object' &&
          'tokenUsage' in event.data &&
          (event.data as { tokenUsage?: unknown }).tokenUsage
        ),
      });

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
        console.log('[useAgentTokenUsage] Processing token usage data:', tokenUsageData);

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

          console.log('[useAgentTokenUsage] Setting token usage:', completeTokenUsage);
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
  }, [fetchTokenUsage]);

  return {
    tokenUsage,
    loading,
    error,
    refetch: fetchTokenUsage,
  };
}
