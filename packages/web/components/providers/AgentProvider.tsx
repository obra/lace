// ABOUTME: Context provider for shared agent selection state across the app
// ABOUTME: Manages which agent is selected and provides computed values based on selection

'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import { useHashRouter } from '@/hooks/useHashRouter';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';

// Types for agent context
export interface AgentContextType {
  // Agent data (from useAgentManagement hook)
  sessionDetails: SessionInfo | null;
  loading: boolean;

  // Selection state (managed by this provider)
  selectedAgent: ThreadId | null;
  foundAgent: AgentInfo | null;

  // Computed agent state
  currentAgent: AgentInfo | null;
  agentBusy: boolean;

  // Selection actions
  selectAgent: (agentId: ThreadId | string | null) => void;
  onAgentSelect: (agent: { id: string }) => void;

  // Data operations (passed through from hook)
  createAgent: (sessionId: string, request: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, toState: string) => void;
  reloadSessionDetails: () => Promise<void>;
  loadAgentConfiguration: (
    agentId: string
  ) => Promise<{ name: string; providerInstanceId: string; modelId: string }>;
  updateAgent: (
    agentId: string,
    config: { name: string; providerInstanceId: string; modelId: string }
  ) => Promise<void>;
}

const AgentContext = createContext<AgentContextType | null>(null);

interface AgentProviderProps {
  children: ReactNode;
  sessionId: string | null;
  onAgentChange?: (agentId: string | null) => void;
}

export function AgentProvider({ children, sessionId, onAgentChange }: AgentProviderProps) {
  // Get agent data from pure data hook
  const {
    sessionDetails,
    loading,
    createAgent,
    updateAgentState,
    reloadSessionDetails,
    loadAgentConfiguration,
    updateAgent,
  } = useAgentManagement(sessionId);

  // Get selection state from hash router
  const { agent: selectedAgent, setAgent: setSelectedAgent } = useHashRouter();

  // Track whether auto-selection has been performed for this session
  const hasAutoSelectedRef = useRef<string | null>(null);

  // Compute derived state based on data + selection
  const foundAgent = useMemo(() => {
    return selectedAgent && sessionDetails
      ? (sessionDetails.agents || []).find((a) => a.threadId === selectedAgent) || null
      : null;
  }, [selectedAgent, sessionDetails]);

  // Get current agent (selected agent or first available agent)
  const currentAgent = useMemo(() => {
    return (
      (selectedAgent && sessionDetails?.agents?.find((a) => a.threadId === selectedAgent)) ||
      sessionDetails?.agents?.[0] ||
      null
    );
  }, [selectedAgent, sessionDetails]);

  // Determine if agent is busy (thinking, streaming, or executing tools)
  const agentBusy = useMemo(() => {
    return (
      currentAgent?.status === 'thinking' ||
      currentAgent?.status === 'streaming' ||
      currentAgent?.status === 'tool_execution'
    );
  }, [currentAgent]);

  // Selection actions
  const selectAgent = useCallback(
    (agentId: ThreadId | string | null) => {
      setSelectedAgent(agentId);
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

  // Auto-select coordinator agent when entering a session (only once per session)
  useEffect(() => {
    if (sessionId && sessionDetails && !selectedAgent && hasAutoSelectedRef.current !== sessionId) {
      // Coordinator agent has the same threadId as the sessionId
      const coordinatorAgent = sessionDetails.agents?.find((agent) => agent.threadId === sessionId);

      if (coordinatorAgent) {
        selectAgent(coordinatorAgent.threadId);
        hasAutoSelectedRef.current = sessionId;
      }
    }

    // Reset auto-selection tracking when session changes
    if (
      sessionId !== hasAutoSelectedRef.current &&
      hasAutoSelectedRef.current !== null &&
      !selectedAgent
    ) {
      hasAutoSelectedRef.current = null;
    }
  }, [sessionId, sessionDetails, selectedAgent, selectAgent]);

  const value: AgentContextType = useMemo(
    () => ({
      // Agent data (from hook)
      sessionDetails,
      loading,

      // Selection state (managed here)
      selectedAgent,
      foundAgent,

      // Computed agent state
      currentAgent,
      agentBusy,

      // Selection actions
      selectAgent,
      onAgentSelect,

      // Data operations (passed through)
      createAgent,
      updateAgentState,
      reloadSessionDetails,
      loadAgentConfiguration,
      updateAgent,
    }),
    [
      sessionDetails,
      loading,
      selectedAgent,
      foundAgent,
      currentAgent,
      agentBusy,
      selectAgent,
      onAgentSelect,
      createAgent,
      updateAgentState,
      reloadSessionDetails,
      loadAgentConfiguration,
      updateAgent,
    ]
  );

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
