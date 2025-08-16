// ABOUTME: Context provider for app-wide state management (project/session/agent selections)
// ABOUTME: Eliminates prop drilling by centralizing state from useHashRouter and management hooks

'use client';

import React, { createContext, useContext, type ReactNode } from 'react';
import { useHashRouter } from '@/hooks/useHashRouter';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import type { SessionInfo, AgentInfo, ThreadId } from '@/types/core';
import type { CreateAgentRequest } from '@/types/api';

// Types for the context
interface AppSelections {
  selectedProject: string | null;
  selectedSession: string | null;
  selectedAgent: string | null;
  urlStateHydrated: boolean;
}

interface AppSessions {
  sessions: SessionInfo[];
  loading: boolean;
  projectConfig: Record<string, unknown> | null;
}

interface AppAgents {
  sessionDetails: SessionInfo | null;
  loading: boolean;
}

interface AppActions {
  // Selection actions (match useHashRouter return type)
  setSelectedProject: (project: string | null, replace?: boolean) => void;
  setSelectedSession: (session: ThreadId | string | null, replace?: boolean) => void;
  setSelectedAgent: (agent: ThreadId | string | null, replace?: boolean) => void;
  updateHashState: (
    newState: Partial<{ project?: string; session?: string; agent?: string }>,
    replace?: boolean
  ) => void;
  clearAll: (replace?: boolean) => void;

  // Session actions (match useSessionManagement return type)
  createSession: (sessionData: {
    name: string;
    description?: string;
    configuration?: Record<string, unknown>;
  }) => Promise<void>;
  loadProjectConfig: () => Promise<void>;
  reloadSessions: () => Promise<void>;

  // Agent actions
  createAgent: (sessionId: string, request: CreateAgentRequest) => Promise<void>;
  updateAgentState: (agentId: string, fromState: string, toState: string) => void;
  reloadSessionDetails: () => Promise<void>;
}

interface AppStateContextType {
  selections: AppSelections;
  sessions: AppSessions;
  agents: AppAgents;
  actions: AppActions;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

interface AppStateProviderProps {
  children: ReactNode;
}

export function AppStateProvider({ children }: AppStateProviderProps) {
  // Hash-based routing state
  const hashRouter = useHashRouter();

  // Business logic hooks
  const sessionManagement = useSessionManagement(hashRouter.project);
  const agentManagement = useAgentManagement(hashRouter.session);

  // Create context value
  const contextValue: AppStateContextType = {
    selections: {
      selectedProject: hashRouter.project,
      selectedSession: hashRouter.session,
      selectedAgent: hashRouter.agent,
      urlStateHydrated: hashRouter.isHydrated,
    },

    sessions: {
      sessions: sessionManagement.sessions,
      loading: sessionManagement.loading,
      projectConfig: sessionManagement.projectConfig,
    },

    agents: {
      sessionDetails: agentManagement.sessionDetails,
      loading: agentManagement.loading,
    },

    actions: {
      // Selection actions
      setSelectedProject: hashRouter.setProject,
      setSelectedSession: hashRouter.setSession,
      setSelectedAgent: hashRouter.setAgent,
      updateHashState: hashRouter.updateState,
      clearAll: hashRouter.clearAll,

      // Session actions
      createSession: sessionManagement.createSession,
      loadProjectConfig: sessionManagement.loadProjectConfig,
      reloadSessions: sessionManagement.reloadSessions,

      // Agent actions
      createAgent: agentManagement.createAgent,
      updateAgentState: agentManagement.updateAgentState,
      reloadSessionDetails: agentManagement.reloadSessionDetails,
    },
  };

  return <AppStateContext.Provider value={contextValue}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextType {
  const context = useContext(AppStateContext);

  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }

  return context;
}

// Convenience hooks for specific parts of the state
export function useAppSelections() {
  const { selections } = useAppState();
  return selections;
}

export function useAppSessions() {
  const { sessions } = useAppState();
  return sessions;
}

export function useAppAgents() {
  const { agents } = useAppState();
  return agents;
}

export function useAppActions() {
  const { actions } = useAppState();
  return actions;
}
