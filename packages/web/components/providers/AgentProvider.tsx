// ABOUTME: Context provider for shared agent selection state across the app
// ABOUTME: Manages which agent is selected and provides computed values based on selection

'use client';

import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import { useHashRouter } from '@/hooks/useHashRouter';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';

// Types for agent context
interface AgentContextType {
  // Agent data (from useAgentManagement hook)
  sessionDetails: SessionInfo | null;
  loading: boolean;

  // Selection state (managed by this provider)
  selectedAgent: string | null;
  foundAgent: AgentInfo | null;

  // Selection actions
  selectAgent: (agentId: string | null) => void;
  onAgentSelect: (agent: { id: string }) => void;

  // Data operations (passed through from hook)
  createAgent: (sessionId: string, request: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, fromState: string, toState: string) => void;
  reloadSessionDetails: () => Promise<void>;
}

const AgentContext = createContext<AgentContextType | null>(null);

interface AgentProviderProps {
  children: ReactNode;
  sessionId: string | null;
  onAgentChange?: (agentId: string | null) => void;
}

export function AgentProvider({ children, sessionId, onAgentChange }: AgentProviderProps) {
  // Get agent data from pure data hook
  const { sessionDetails, loading, createAgent, updateAgentState, reloadSessionDetails } =
    useAgentManagement(sessionId);

  // Get selection state from hash router
  const { agent: selectedAgent, setAgent: setSelectedAgent } = useHashRouter();

  // Compute derived state based on data + selection
  const foundAgent = useMemo(() => {
    return selectedAgent && sessionDetails
      ? (sessionDetails.agents || []).find((a) => a.threadId === selectedAgent) || null
      : null;
  }, [selectedAgent, sessionDetails]);

  // Selection actions
  const selectAgent = useCallback(
    (agentId: string | null) => {
      setSelectedAgent(agentId as ThreadId | null);
      if (onAgentChange) {
        onAgentChange(agentId);
      }
    },
    [setSelectedAgent, onAgentChange]
  );

  const onAgentSelect = useCallback(
    (agent: { id: string }) => {
      // Handle empty string as null (for clearing selection)
      const agentId = agent.id === '' ? null : agent.id;
      selectAgent(agentId);
    },
    [selectAgent]
  );

  const value: AgentContextType = {
    // Agent data (from hook)
    sessionDetails,
    loading,

    // Selection state (managed here)
    selectedAgent,
    foundAgent,

    // Selection actions
    selectAgent,
    onAgentSelect,

    // Data operations (passed through)
    createAgent,
    updateAgentState,
    reloadSessionDetails,
  };

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

// Hook to use agent context
export function useAgentContext(): AgentContextType {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgentContext must be used within an AgentProvider');
  }
  return context;
}
