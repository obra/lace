// ABOUTME: React hook for session and agent management API calls
// ABOUTME: Provides methods for CRUD operations on sessions and agents

import { useState, useCallback } from 'react';
import {
  CreateSessionRequest,
  CreateAgentRequest,
  SessionResponse,
  SessionsResponse,
  AgentResponse,
  isApiError,
  isApiSuccess,
} from '@/types/api';
import type { ThreadId, SessionInfo, AgentInfo } from '@/types/core';
import { parse } from '@/lib/serialization';

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
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = parse(await response.text());
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to create session');
          }
          throw new Error('Failed to create session');
        }

        const data: unknown = parse(await response.text());
        if (isApiSuccess<SessionResponse>(data) && 'session' in data) {
          return data['session'] as SessionInfo;
        }
        throw new Error('Invalid response format');
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Unknown error');
        return null;
      }
    },
    []
  );

  const listSessions = useCallback(async (): Promise<SessionInfo[]> => {
    setError(null);

    try {
      const response = await fetch('/api/sessions');

      if (!response.ok) {
        const error: unknown = parse(await response.text());
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to list sessions');
        }
        throw new Error('Failed to list sessions');
      }

      const data: unknown = parse(await response.text());
      if (isApiSuccess<SessionsResponse>(data) && 'sessions' in data) {
        return data['sessions'] as SessionInfo[];
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }, []);

  const getSession = useCallback(async (sessionId: ThreadId): Promise<SessionInfo | null> => {
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${sessionId}`);

      if (!response.ok) {
        const error: unknown = parse(await response.text());
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to get session');
        }
        throw new Error('Failed to get session');
      }

      const data: unknown = parse(await response.text());
      if (isApiSuccess<SessionResponse>(data) && 'session' in data) {
        return data['session'] as SessionInfo;
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }, []);

  const spawnAgent = useCallback(
    async (sessionId: ThreadId, request: CreateAgentRequest): Promise<AgentInfo | null> => {
      setError(null);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          const error: unknown = parse(await response.text());
          if (isApiError(error)) {
            throw new Error(error.error || 'Failed to spawn agent');
          }
          throw new Error('Failed to spawn agent');
        }

        const data: unknown = parse(await response.text());
        if (isApiSuccess<AgentResponse>(data) && 'agent' in data) {
          return data['agent'] as AgentInfo;
        }
        throw new Error('Invalid response format');
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
      const response = await fetch(`/api/sessions/${sessionId}/agents`);

      if (!response.ok) {
        const error: unknown = parse(await response.text());
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to list agents');
        }
        throw new Error('Failed to list agents');
      }

      const data: unknown = parse(await response.text());
      if (isApiSuccess<{ agents: AgentInfo[] }>(data) && 'agents' in data) {
        return data['agents'] as AgentInfo[];
      }
      throw new Error('Invalid response format');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return [];
    }
  }, []);

  const sendMessage = useCallback(async (threadId: ThreadId, message: string): Promise<boolean> => {
    setError(null);

    try {
      const url = `/api/threads/${threadId}/message`;
      const body = JSON.stringify({ message });

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!response.ok) {
        const error: unknown = parse(await response.text());
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to send message');
        }
        throw new Error('Failed to send message');
      }

      parse(await response.text());
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }, []);

  const stopAgent = useCallback(async (agentId: ThreadId): Promise<boolean> => {
    setError(null);

    try {
      const response = await fetch(`/api/agents/${agentId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const error: unknown = parse(await response.text());
        if (isApiError(error)) {
          throw new Error(error.error || 'Failed to stop agent');
        }
        throw new Error('Failed to stop agent');
      }

      const data: unknown = parse(await response.text());
      if (isApiSuccess<{ success: boolean }>(data) && 'success' in data) {
        return data['success'] as boolean;
      }
      return true; // Default to success if response format is unexpected
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }, []);

  return {
    error: state.error,
    createSession,
    listSessions,
    getSession,
    spawnAgent,
    listAgents,
    sendMessage,
    stopAgent,
  };
}
