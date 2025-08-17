// ABOUTME: Context provider for app-wide state management (project/session/agent selections)
// ABOUTME: Eliminates prop drilling by centralizing state from useHashRouter and management hooks

'use client';

import React, { createContext, useContext, type ReactNode } from 'react';
import { useHashRouter } from '@/hooks/useHashRouter';
import type { ThreadId } from '@/types/core';

// Types for the context
interface AppSelections {
  selectedProject: string | null;
  selectedSession: ThreadId | null;
  selectedAgent: ThreadId | null;
  urlStateHydrated: boolean;
}

interface AppActions {
  // Selection actions (match useHashRouter return type)
  setSelectedProject: (project: string | null, replace?: boolean) => void;
  setSelectedSession: (session: ThreadId | string | null, replace?: boolean) => void;
  setSelectedAgent: (agent: ThreadId | string | null, replace?: boolean) => void;
  updateHashState: (
    newState: Partial<{ project?: string; session?: ThreadId | string; agent?: ThreadId | string }>,
    replace?: boolean
  ) => void;
  clearAll: (replace?: boolean) => void;
}

interface AppStateContextType {
  selections: AppSelections;
  actions: AppActions;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

interface AppStateProviderProps {
  children: ReactNode;
}

export function AppStateProvider({ children }: AppStateProviderProps) {
  // Hash-based routing state
  const hashRouter = useHashRouter();

  // Create context value
  const contextValue: AppStateContextType = {
    selections: {
      selectedProject: hashRouter.project,
      selectedSession: hashRouter.session,
      selectedAgent: hashRouter.agent,
      urlStateHydrated: hashRouter.isHydrated,
    },

    actions: {
      // Selection actions
      setSelectedProject: hashRouter.setProject,
      setSelectedSession: hashRouter.setSession,
      setSelectedAgent: hashRouter.setAgent,
      updateHashState: hashRouter.updateState,
      clearAll: hashRouter.clearAll,
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
export function useAppActions() {
  const { actions } = useAppState();
  return actions;
}
