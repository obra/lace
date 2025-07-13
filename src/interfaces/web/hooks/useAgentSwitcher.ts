// ABOUTME: Agent switcher hook for multi-agent UI management
// ABOUTME: Handles agent switching, status tracking, and UI state management

import { useState, useCallback, useEffect } from 'react';
import { AgentMetadata } from '../types/agent';
import { logger } from '../utils/client-logger';

export interface UseAgentSwitcherOptions {
  sessionId?: string;
  initialAgentId?: string;
  onAgentSwitch?: (agentId: string, agentInfo: AgentMetadata) => void;
}

export function useAgentSwitcher(options: UseAgentSwitcherOptions = {}) {
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(options.initialAgentId);
  const [agents, setAgents] = useState<AgentMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load agents for current session
  const loadAgents = useCallback(async (sessionId?: string) => {
    const targetSessionId = sessionId || options.sessionId;
    if (!targetSessionId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents?sessionId=${targetSessionId}`);
      if (!response.ok) {
        throw new Error(`Failed to load agents: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const agentList = data.agents || [];
      setAgents(agentList);

      // Set current agent if none selected
      if (!currentAgentId && agentList.length > 0) {
        setCurrentAgentId(agentList[0].id);
      }

      return agentList;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load agents';
      setError(errorMessage);
      logger.error('Failed to load agents:', err);
    } finally {
      setIsLoading(false);
    }
  }, [options.sessionId, currentAgentId]);

  // Switch to different agent
  const switchToAgent = useCallback(async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    setCurrentAgentId(agentId);
    options.onAgentSwitch?.(agentId, agent);

    // TODO: Load conversation history for the agent
    try {
      const response = await fetch(`/api/conversations?agentId=${agentId}`);
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (err) {
      logger.warn('Failed to load agent conversation history:', err);
    }

    return agent;
  }, [agents, options]);

  // Get current agent info
  const getCurrentAgent = useCallback(() => {
    return agents.find(a => a.id === currentAgentId);
  }, [agents, currentAgentId]);

  // Add new agent to the list
  const addAgent = useCallback((agent: AgentMetadata) => {
    setAgents(prev => {
      const exists = prev.some(a => a.id === agent.id);
      if (exists) {
        return prev.map(a => a.id === agent.id ? agent : a);
      }
      return [...prev, agent];
    });
  }, []);

  // Update agent status
  const updateAgentStatus = useCallback((agentId: string, status: AgentMetadata['status']) => {
    setAgents(prev => 
      prev.map(agent => 
        agent.id === agentId 
          ? { ...agent, status, lastActivity: new Date().toISOString() }
          : agent
      )
    );
  }, []);

  // Remove agent from list
  const removeAgent = useCallback((agentId: string) => {
    setAgents(prev => {
      const filtered = prev.filter(a => a.id !== agentId);
      
      // Switch to another agent if removing current one
      if (currentAgentId === agentId) {
        if (filtered.length > 0) {
          // Schedule state update for next tick to avoid updating during render
          Promise.resolve().then(() => switchToAgent(filtered[0].id));
        } else {
          setCurrentAgentId(undefined);
        }
      }
      
      return filtered;
    });
  }, [currentAgentId, switchToAgent]);

  // Get agents by status
  const getAgentsByStatus = useCallback((status: AgentMetadata['status']) => {
    return agents.filter(agent => agent.status === status);
  }, [agents]);

  // Auto-load agents when session changes
  useEffect(() => {
    if (options.sessionId) {
      loadAgents(options.sessionId);
    }
  }, [options.sessionId, loadAgents]);

  return {
    // State
    currentAgentId,
    agents,
    isLoading,
    error,

    // Current agent
    currentAgent: getCurrentAgent(),

    // Actions
    loadAgents,
    switchToAgent,
    addAgent,
    updateAgentStatus,
    removeAgent,

    // Utilities
    getAgentsByStatus,
    activeAgents: getAgentsByStatus('active'),
    busyAgents: getAgentsByStatus('busy'),
    idleAgents: getAgentsByStatus('idle'),
    completedAgents: getAgentsByStatus('completed'),
  };
}