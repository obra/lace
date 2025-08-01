// ABOUTME: React hook for session and agent management API calls
// ABOUTME: Provides methods for CRUD operations on sessions and agents

import { useState, useCallback } from 'react';
import {
  Session,
  Agent,
  CreateSessionRequest,
  CreateAgentRequest,
  ThreadId,
  SessionResponse,
  SessionsResponse,
  AgentResponse,
  isApiError,
  isApiSuccess,
} from '@/types/api';

interface APIState {
  loading: boolean;
  error: string | null;
}

export function useSessionAPI() {
  const [state, setState] = useState<APIState>({
    loading: false,
    error: null,
  });

  const setLoading = (loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  };

  const setError = (error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  };

  const createSession = useCallback(
    async (request: CreateSessionRequest): Promise<Session | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = await response.json();
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to create session');
          }
          throw new Error('Failed to create session');
        }

        const data: unknown = await response.json();
        if (isApiSuccess<SessionResponse>(data) && 'session' in data) {
          return data['session'] as Session;
        }
        throw new Error('Invalid response format');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const listSessions = useCallback(async (): Promise<Session[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/sessions');

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to list sessions');
        }
        throw new Error('Failed to list sessions');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<SessionsResponse>(data) && 'sessions' in data) {
        return data['sessions'] as Session[];
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const getSession = useCallback(async (sessionId: ThreadId): Promise<Session | null> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`);

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to get session');
        }
        throw new Error('Failed to get session');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<SessionResponse>(data) && 'session' in data) {
        return data['session'] as Session;
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const spawnAgent = useCallback(
    async (sessionId: ThreadId, request: CreateAgentRequest): Promise<Agent | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = await response.json();
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to spawn agent');
          }
          throw new Error('Failed to spawn agent');
        }

        const data: unknown = await response.json();
        if (isApiSuccess<AgentResponse>(data) && 'agent' in data) {
          return data['agent'] as Agent;
        }
        throw new Error('Invalid response format');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const listAgents = useCallback(async (sessionId: ThreadId): Promise<Agent[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/agents`);

      if (!response.ok) {
        const error: unknown = await response.json();
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to list agents');
        }
        throw new Error('Failed to list agents');
      }

      const data: unknown = await response.json();
      if (isApiSuccess<{ agents: Agent[] }>(data) && 'agents' in data) {
        return data['agents'] as Agent[];
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const sendMessage = useCallback(async (threadId: ThreadId, message: string): Promise<boolean> => {
    console.log('[SEND_MESSAGE] sendMessage called with:', { threadId, message });
    setLoading(true);
    setError(null);

    try {
      const url = `/api/threads/${threadId}/message`;
      const body = JSON.stringify({ message });
      console.log('[SEND_MESSAGE] Making fetch request to:', url);
      console.log('[SEND_MESSAGE] Request body:', body);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      console.log('[SEND_MESSAGE] Response status:', response.status);
      console.log('[SEND_MESSAGE] Response ok:', response.ok);

      if (!response.ok) {
        console.log('[SEND_MESSAGE] Response not ok, parsing error');
        const error: unknown = await response.json();
        console.log('[SEND_MESSAGE] Error response:', error);
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to send message');
        }
        throw new Error('Failed to send message');
      }

      const responseData = await response.json();
      console.log('[SEND_MESSAGE] Success response:', responseData);
      return true;
    } catch (error) {
      console.error('[SEND_MESSAGE] Error occurred:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    } finally {
      console.log('[SEND_MESSAGE] Setting loading to false');
      setLoading(false);
    }
  }, []);

  return {
    loading: state.loading,
    error: state.error,
    createSession,
    listSessions,
    getSession,
    spawnAgent,
    listAgents,
    sendMessage,
  };
}
