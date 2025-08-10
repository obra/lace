// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback } from 'react';
import { useEventStream } from './useEventStream';
import type { ThreadId } from '@/types/core';
import type { AgentResponse } from '@/types/api';
import type { SessionEvent } from '@/types/web-sse';

// Use the same type structure as the API
export type AgentTokenUsage = NonNullable<AgentResponse['agent']['tokenUsage']>;

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

      const response = await fetch(`/api/agents/${agentId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch agent data: ${response.status}`);
      }

      const data = (await response.json()) as AgentResponse;
      if (data.agent?.tokenUsage) {
        setTokenUsage(data.agent.tokenUsage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch token usage');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  // Listen for AGENT_MESSAGE events that include token usage updates
  const handleAgentMessage = useCallback(
    (event: SessionEvent) => {
      // Check if this event is for our agent, is AGENT_MESSAGE type, and has token usage data
      if (event.threadId === agentId && event.type === 'AGENT_MESSAGE' && event.data?.tokenUsage) {
        const tokenUsageData = event.data.tokenUsage;
        // Transform core TokenUsage to AgentTokenUsage by providing defaults for any missing fields
        const completeTokenUsage: AgentTokenUsage = {
          totalPromptTokens: tokenUsageData.totalPromptTokens ?? tokenUsageData.promptTokens,
          totalCompletionTokens:
            tokenUsageData.totalCompletionTokens ?? tokenUsageData.completionTokens,
          totalTokens: tokenUsageData.totalTokens ?? tokenUsageData.totalTokens,
          contextLimit: tokenUsageData.contextLimit ?? 200000,
          percentUsed: tokenUsageData.percentUsed ?? 0,
          nearLimit: tokenUsageData.nearLimit ?? false,
          eventCount: tokenUsageData.eventCount ?? 0,
          lastCompactionAt: tokenUsageData.lastCompactionAt,
        };
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
