// ABOUTME: React hook for agent-specific API calls
// ABOUTME: Handles messaging and control of individual agents

import { useState, useCallback } from 'react';
import type { ThreadId } from '@/types/core';
import { api } from '@/lib/api-client';

interface AgentAPIState {
  error: string | null;
}

export function useAgentAPI() {
  const [state, setState] = useState<AgentAPIState>({
    error: null,
  });

  const setError = (error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  };

  const sendMessage = useCallback(async (agentId: ThreadId, message: string): Promise<boolean> => {
    setError(null);

    try {
      await api.post(`/api/agents/${agentId}/message`, { message });
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }, []);

  const stopAgent = useCallback(async (agentId: ThreadId): Promise<boolean> => {
    setError(null);

    try {
      const data = await api.post<{ success: boolean }>(`/api/agents/${agentId}/stop`);
      return data.success ?? true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    error: state.error,
    sendMessage,
    stopAgent,
  };
}

type UseAgentAPIReturn = ReturnType<typeof useAgentAPI>;
