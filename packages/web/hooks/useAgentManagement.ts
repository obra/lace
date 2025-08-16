// ABOUTME: Custom hook for agent management operations
// ABOUTME: Handles agent creation, selection, and state updates

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, ThreadId, CreateAgentRequest, AgentState } from '@/types/core';
import { parseResponse } from '@/lib/serialization';

interface UseAgentManagementResult {
  sessionDetails: SessionInfo | null;
  loading: boolean;
  createAgent: (sessionId: string, agentData: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, from: string, to: string) => void;
  reloadSessionDetails: () => Promise<void>;
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
          body: JSON.stringify(agentData),
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
  };
}
