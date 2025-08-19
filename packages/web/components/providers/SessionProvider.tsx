// ABOUTME: Context provider for shared session selection state across the app
// ABOUTME: Manages which session is selected and provides computed values based on selection

'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useSessionManagement } from '@/hooks/useSessionManagement';
import type { SessionInfo, ThreadId } from '@/types/core';

// Types for session context
export interface SessionContextType {
  // Session data (from useSessionManagement hook)
  sessions: SessionInfo[];
  loading: boolean;
  projectConfig: Record<string, unknown> | null;

  // Selection state (managed by this provider)
  selectedSession: string | null;
  foundSession: SessionInfo | null;

  // Selection actions
  selectSession: (sessionId: string | null) => void;
  onSessionSelect: (session: { id: string }) => void;

  // Data operations (passed through from hook)
  createSession: (sessionData: {
    name: string;
    description?: string;
    providerInstanceId?: string;
    modelId?: string;
    configuration?: Record<string, unknown>;
  }) => Promise<void>;
  loadProjectConfig: () => Promise<void>;
  reloadSessions: () => Promise<void>;
  loadSessionConfiguration: (sessionId: string) => Promise<Record<string, unknown>>;
  updateSessionConfiguration: (sessionId: string, config: Record<string, unknown>) => Promise<void>;
  updateSession: (
    sessionId: string,
    updates: { name: string; description?: string }
  ) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  loadSessionsForProject: (projectId: string) => Promise<SessionInfo[]>;

  // Agent auto-selection control
  enableAgentAutoSelection: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

interface SessionProviderProps {
  children: ReactNode;
  projectId: string | null;
  selectedSessionId?: string | null; // Session ID from URL params
  onSessionChange?: (sessionId: string | null) => void;
}

// Simple enableAgentAutoSelection function (kept for compatibility)
function useAgentAutoSelection() {
  return {
    enableAgentAutoSelection: useCallback(() => {
      // No-op in route-based navigation - routes handle navigation directly
    }, []),
  };
}

export function SessionProvider({
  children,
  projectId,
  selectedSessionId,
  onSessionChange,
}: SessionProviderProps) {
  // Get session data from pure data hook
  const {
    sessions,
    loading,
    projectConfig,
    createSession,
    loadProjectConfig,
    reloadSessions,
    loadSessionConfiguration,
    updateSessionConfiguration,
    updateSession,
    deleteSession,
    loadSessionsForProject,
  } = useSessionManagement(projectId);

  // Use session from URL params, not hash router
  const selectedSession = selectedSessionId || null;

  // Compute derived state based on data + selection
  const foundSession = useMemo(() => {
    return selectedSession ? (sessions || []).find((s) => s.id === selectedSession) || null : null;
  }, [selectedSession, sessions]);

  // Agent auto-selection logic (simplified)
  const { enableAgentAutoSelection } = useAgentAutoSelection();

  // Selection actions
  const selectSession = useCallback(
    (sessionId: string | null) => {
      if (onSessionChange) {
        onSessionChange(sessionId);
      }
    },
    [onSessionChange]
  );

  const onSessionSelect = useCallback(
    (session: { id: string }) => {
      // Handle empty string as null (for clearing selection)
      const sessionId = session.id === '' ? null : session.id;
      selectSession(sessionId);
    },
    [selectSession]
  );

  const value: SessionContextType = useMemo(
    () => ({
      // Session data (from hook)
      sessions,
      loading,
      projectConfig,

      // Selection state (managed here)
      selectedSession,
      foundSession,

      // Selection actions
      selectSession,
      onSessionSelect,

      // Data operations (passed through)
      createSession,
      loadProjectConfig,
      reloadSessions,
      loadSessionConfiguration,
      updateSessionConfiguration,
      updateSession,
      deleteSession,
      loadSessionsForProject,

      // Agent auto-selection control
      enableAgentAutoSelection,
    }),
    [
      sessions,
      loading,
      projectConfig,
      selectedSession,
      foundSession,
      selectSession,
      onSessionSelect,
      createSession,
      loadProjectConfig,
      reloadSessions,
      loadSessionConfiguration,
      updateSessionConfiguration,
      updateSession,
      deleteSession,
      loadSessionsForProject,
      enableAgentAutoSelection,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// Optional hook - returns null if not within provider
export function useOptionalSessionContext(): SessionContextType | null {
  return useContext(SessionContext);
}

// Hook to use session context
export function useSessionContext(): SessionContextType {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return context;
}
