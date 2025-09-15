// ABOUTME: React hook for session and agent management API calls
// ABOUTME: Provides methods for CRUD operations on sessions and agents

import { useState, useCallback } from 'react';
import { CreateSessionRequest, CreateAgentRequest } from '@/types/api';
import type { ThreadId, SessionInfo, AgentInfo } from '@/types/core';
import { api } from '@/lib/api-client';

interface APIState {
  error: string | null;
}

export function useSessionAPI() {
  const [state, setState] = useState<APIState>({
    error: null,
  });

  const setError = (error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  };

  const createSession = useCallback(
    async (request: CreateSessionRequest): Promise<SessionInfo | null> => {
      setError(null);

      try {
        const data = await api.post<SessionInfo>('/api/sessions', request);
        return data;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      }
    },
    []
  );

  const getSession = useCallback(async (sessionId: ThreadId): Promise<SessionInfo | null> => {
    setError(null);

    try {
      const data = await api.get<SessionInfo>(`/api/sessions/${sessionId}`);
      return data;
    } catch (error) {
      // Handle 404 as null instead of error
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      setError(error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }, []);

  const spawnAgent = useCallback(
    async (sessionId: ThreadId, request: CreateAgentRequest): Promise<AgentInfo | null> => {
      setError(null);

      try {
        const data = await api.post<AgentInfo>(`/api/sessions/${sessionId}/agents`, request);
        return data;
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      }
    },
    []
  );

  const listAgents = useCallback(async (sessionId: ThreadId): Promise<AgentInfo[]> => {
    setError(null);

    try {
      const data = await api.get<AgentInfo[]>(`/api/sessions/${sessionId}/agents`);
      return data;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }, []);

  return {
    error: state.error,
    createSession,
    getSession,
    spawnAgent,
    listAgents,
  };
}
