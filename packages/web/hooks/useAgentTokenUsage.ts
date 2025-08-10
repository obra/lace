// ABOUTME: Hook for agent token usage tracking without polling
// ABOUTME: Loads token data from agent API + real-time updates from SSE events

import { useState, useEffect, useCallback } from 'react';
import { useEventStream } from './useEventStream';
import type { ThreadId } from '@/types/core';
import type { AgentResponse } from '@/types/api';
import type { SessionEvent } from '@/types/web-sse';

export interface AgentTokenUsage {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  contextLimit: number;
  percentUsed: number;
  nearLimit: boolean;
  eventCount: number;
  lastCompactionAt?: Date;
}

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
        setTokenUsage(event.data.tokenUsage);
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
