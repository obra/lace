// ABOUTME: Custom hook for agent management operations
// ABOUTME: Handles agent creation, selection, and state updates

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, AgentState } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';
import { api } from '@/lib/api-client';

interface UseAgentManagementResult {
  sessionDetails: SessionInfo | null;
  loading: boolean;
  createAgent: (sessionId: string, agentData: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, to: string) => void;
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
      const sessionResponse = await api.get<SessionInfo>(`/api/sessions/${sessionId}`);
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
        await api.post(`/api/sessions/${sessionId}/agents`, agentData);
        // Reload session details to show the new agent
        await loadSessionDetails();
      } catch (error) {
        console.error('Failed to create agent:', error);
      } finally {
        setLoading(false);
      }
    },
    [loadSessionDetails]
  );

  const updateAgentState = useCallback((agentId: string, to: string) => {
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
        return await api.get<{
          name: string;
          providerInstanceId: string;
          modelId: string;
        }>(`/api/agents/${agentId}`);
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
        await api.put(`/api/agents/${agentId}`, config);
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
  }, [sessionId, loadSessionDetails]);

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
