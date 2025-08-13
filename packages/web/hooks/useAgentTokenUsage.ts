// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback } from 'react';
import { useEventStream } from './useEventStream';
import type { ThreadId, CombinedTokenUsage } from '@/types/core';
import type { AgentResponse } from '@/types/api';
import type { LaceEvent } from '@/types/core';
import { parse } from '@/lib/serialization';

// Use the same type structure as the API
type AgentTokenUsage = NonNullable<AgentResponse['agent']['tokenUsage']>;

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

  // Load initial token usage from agent API
  const fetchTokenUsage = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('[useAgentTokenUsage] Fetching token usage for agent:', agentId);
      const response = await fetch(`/api/agents/${agentId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch agent data: ${response.status}`);
      }

      const responseText = await response.text();
      const data = parse(responseText) as AgentResponse;
      console.log('[useAgentTokenUsage] API response:', {
        hasAgent: !!data.agent,
        hasTokenUsage: !!data.agent?.tokenUsage,
        tokenUsage: data.agent?.tokenUsage,
      });

      if (data.agent?.tokenUsage) {
        console.log('[useAgentTokenUsage] Setting initial token usage:', data.agent.tokenUsage);
        setTokenUsage(data.agent.tokenUsage);
      } else {
        console.log('[useAgentTokenUsage] No token usage data in API response');
      }
    } catch (err) {
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
        const threadData = tokenUsageData.thread;
        const completeTokenUsage: AgentTokenUsage = {
          totalPromptTokens: threadData.totalPromptTokens,
          totalCompletionTokens: threadData.totalCompletionTokens,
          totalTokens: threadData.totalTokens,
          contextLimit: threadData.contextLimit,
          percentUsed: threadData.percentUsed,
          nearLimit: threadData.nearLimit,
        };

        console.log('[useAgentTokenUsage] Setting token usage:', completeTokenUsage);
        setTokenUsage(completeTokenUsage);
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
