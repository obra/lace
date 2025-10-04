// ABOUTME: Context provider for sessions in a project and session selection state
// ABOUTME: Manages session collection for a project and which session is selected

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
import { useSessionManagement } from '@lace/web/hooks/useSessionManagement';
import { useEventStream, type AgentEvent } from '@lace/web/hooks/useEventStream';
import type { SessionInfo } from '@lace/web/types/core';

// Types for project context
export interface ProjectContextType {
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
    name?: string;
    initialMessage?: string;
    description?: string;
    providerInstanceId?: string;
    modelId?: string;
    configuration?: Record<string, unknown>;
  }) => Promise<SessionInfo | null>;
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

const ProjectContext = createContext<ProjectContextType | null>(null);

interface ProjectProviderProps {
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

export function ProjectProvider({
  children,
  projectId,
  selectedSessionId,
  onSessionChange,
}: ProjectProviderProps) {
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

  // Debounced reload to avoid spamming reloadSessions on rapid events
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleReload = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      void reloadSessions();
      timeoutRef.current = null;
    }, 150);
  }, [reloadSessions]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Subscribe to session and agent events to refresh session list in real-time
  useEventStream({
    projectId: projectId || undefined,
    onSessionUpdated: useCallback(() => {
      // Reload sessions to get the updated session name in the list
      scheduleReload();
    }, [scheduleReload]),
    onAgentSpawned: useCallback(
      (_agentEvent: AgentEvent) => {
        // When an agent is spawned, reload sessions to get updated agents list
        scheduleReload();
      },
      [scheduleReload]
    ),
  });

  // Use session from URL params, not hash router
  const selectedSession = selectedSessionId ?? null;

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

  const value: ProjectContextType = useMemo(
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

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

// Optional hook - returns null if not within provider
export function useOptionalProjectContext(): ProjectContextType | null {
  return useContext(ProjectContext);
}

// Hook to use project context
export function useProjectContext(): ProjectContextType {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectProvider');
  }
  return context;
}
