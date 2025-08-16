// ABOUTME: Custom hook for agent management operations
// ABOUTME: Handles agent creation, selection, and state updates

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, ThreadId, AgentState } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';
import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';
import { stringify } from '@/lib/serialization';

interface UseAgentManagementResult {
  sessionDetails: SessionInfo | null;
  loading: boolean;
  createAgent: (sessionId: string, agentData: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, from: string, to: string) => void;
  reloadSessionDetails: () => Promise<void>;
  loadAgentConfiguration: (
    agentId: string
  ) => Promise<{ name: string; providerInstanceId: string; modelId: string }>;
  updateAgent: (
    agentId: string,
    config: { name: string; providerInstanceId: string; modelId: string }
  ) => Promise<void>;
}

export function useAgentManagement(sessionId: string | null): UseAgentManagementResult {
  const [sessionDetails, setSessionDetails] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSessionDetails = useCallback(async () => {
    if (!sessionId) {
      setSessionDetails(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data: unknown = await parseResponse<unknown>(res);

      const sessionResponse = data as SessionInfo;
      setSessionDetails(sessionResponse);
    } catch (error) {
      console.error('Failed to load session details:', error);
      setSessionDetails(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const createAgent = useCallback(
    async (sessionId: string, agentData: CreateAgentRequest) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(agentData),
        });

        if (res.ok) {
          // Reload session details to show the new agent
          await loadSessionDetails();
        } else {
          console.error('Failed to create agent');
        }
      } catch (error) {
        console.error('Failed to create agent:', error);
      } finally {
        setLoading(false);
      }
    },
    [loadSessionDetails]
  );

  const updateAgentState = useCallback((agentId: string, from: string, to: string) => {
    setSessionDetails((prevSession) => {
      if (!prevSession?.agents) return prevSession;

      return {
        ...prevSession,
        agents: prevSession.agents.map((agent) =>
          agent.threadId === agentId ? { ...agent, status: to as AgentState } : agent
        ),
      };
    });
  }, []);

  const loadAgentConfiguration = useCallback(
    async (
      agentId: string
    ): Promise<{ name: string; providerInstanceId: string; modelId: string }> => {
      try {
        const res = await fetch(`/api/agents/${agentId}`);

        if (!res.ok) {
          throw new Error(`Failed to load agent configuration: ${res.status}`);
        }

        const data = await parseResponse<{
          name: string;
          providerInstanceId: string;
          modelId: string;
        }>(res);
        if (isApiError(data)) {
          throw new Error(data.error);
        }

        return data;
      } catch (error) {
        console.error('Error loading agent configuration:', error);
        throw error;
      }
    },
    []
  );

  const updateAgent = useCallback(
    async (
      agentId: string,
      config: { name: string; providerInstanceId: string; modelId: string }
    ): Promise<void> => {
      try {
        const res = await fetch(`/api/agents/${agentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(config),
        });

        if (!res.ok) {
          const errorData = await parseResponse<{ error: string }>(res);
          throw new Error(errorData.error || `Failed to update agent: ${res.status}`);
        }

        // Reload session details to reflect the changes
        await loadSessionDetails();
      } catch (error) {
        console.error('Error updating agent:', error);
        throw error;
      }
    },
    [loadSessionDetails]
  );

  // Load session details when session changes
  useEffect(() => {
    void loadSessionDetails();
  }, [loadSessionDetails]);

  // Clear session details when no session is selected
  useEffect(() => {
    if (!sessionId) {
      setSessionDetails(null);
    }
  }, [sessionId]);

  return {
    sessionDetails,
    loading,
    createAgent,
    updateAgentState,
    reloadSessionDetails: loadSessionDetails,
    loadAgentConfiguration,
    updateAgent,
  };
}
