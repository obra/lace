// ABOUTME: Custom hook for session management operations
// ABOUTME: Handles session loading, creation, and project configuration

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo } from '@/types/core';
import { api } from '@/lib/api-client';

interface UseSessionManagementResult {
  sessions: SessionInfo[];
  loading: boolean;
  projectConfig: Record<string, unknown> | null;
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
}

export function useSessionManagement(projectId: string | null): UseSessionManagementResult {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectConfig, setProjectConfig] = useState<Record<string, unknown> | null>(null);

  const loadSessions = useCallback(async () => {
    if (!projectId) {
      setSessions([]);
      return;
    }

    setLoading(true);
    try {
      const sessionsData = await api.get<SessionInfo[]>(`/api/projects/${projectId}/sessions`);
      setSessions(sessionsData || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadProjectConfig = useCallback(async () => {
    if (!projectId) {
      setProjectConfig(null);
      return;
    }

    try {
      const data = await api.get<{ configuration?: Record<string, unknown> }>(
        `/api/projects/${projectId}/configuration`
      );

      if (data.configuration) {
        setProjectConfig(data.configuration);
      } else {
        setProjectConfig({});
      }
    } catch (error) {
      console.error('Failed to load project configuration:', error);
      setProjectConfig(null);
    }
  }, [projectId]);

  const createSession = useCallback(
    async (sessionData: {
      name?: string;
      initialMessage?: string;
      description?: string;
      providerInstanceId?: string;
      modelId?: string;
      configuration?: Record<string, unknown>;
    }): Promise<SessionInfo | null> => {
      if (!projectId) return null;

      try {
        const newSession = await api.post<SessionInfo>(
          `/api/projects/${projectId}/sessions`,
          sessionData
        );
        // Reload sessions to show the new one
        await loadSessions();
        return newSession;
      } catch (error) {
        console.error('Failed to create session:', error);
        // Re-throw the error so the UI can handle it
        throw error;
      }
    },
    [projectId, loadSessions]
  );

  const loadSessionConfiguration = useCallback(
    async (sessionId: string): Promise<Record<string, unknown>> => {
      try {
        const data = await api.get<{ configuration: Record<string, unknown> }>(
          `/api/sessions/${sessionId}/configuration`
        );
        return data.configuration || {};
      } catch (error) {
        console.error('Error loading session configuration:', error);
        throw error;
      }
    },
    []
  );

  const updateSessionConfiguration = useCallback(
    async (sessionId: string, config: Record<string, unknown>): Promise<void> => {
      try {
        await api.put(`/api/sessions/${sessionId}/configuration`, { configuration: config });
      } catch (error) {
        console.error('Error updating session configuration:', error);
        throw error;
      }
    },
    []
  );

  const updateSession = useCallback(
    async (sessionId: string, updates: { name: string; description?: string }): Promise<void> => {
      try {
        await api.patch(`/api/sessions/${sessionId}`, updates);
        // Reload sessions to reflect the changes
        await loadSessions();
      } catch (error) {
        console.error('Error updating session:', error);
        throw error;
      }
    },
    [loadSessions]
  );

  const deleteSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!projectId) return;

      try {
        await api.delete(`/api/projects/${projectId}/sessions/${sessionId}`);
        // Reload sessions to remove the deleted one
        await loadSessions();
      } catch (error) {
        console.error('Error deleting session:', error);
        throw error;
      }
    },
    [projectId, loadSessions]
  );

  const loadSessionsForProject = useCallback(
    async (targetProjectId: string): Promise<SessionInfo[]> => {
      try {
        const data: unknown = await api.get<unknown>(`/api/projects/${targetProjectId}/sessions`);

        // Normalize response shape - could be SessionInfo[] or { sessions: SessionInfo[] }
        if (Array.isArray(data)) {
          return data as SessionInfo[];
        } else if (data && typeof data === 'object' && 'sessions' in data) {
          return (data as { sessions: SessionInfo[] }).sessions || [];
        } else {
          console.error('Invalid response shape for sessions:', data);
          return [];
        }
      } catch (error) {
        console.error('Failed to load sessions for project:', error);
        return [];
      }
    },
    []
  );

  // Load sessions when project changes
  useEffect(() => {
    void loadSessions();
  }, [projectId, loadSessions]);

  // Load project config when project changes
  useEffect(() => {
    void loadProjectConfig();
  }, [projectId, loadProjectConfig]);

  // Clear sessions when no project is selected
  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setProjectConfig(null);
    }
  }, [projectId]);

  return {
    sessions,
    loading,
    projectConfig,
    createSession,
    loadProjectConfig,
    reloadSessions: loadSessions,
    loadSessionConfiguration,
    updateSessionConfiguration,
    updateSession,
    deleteSession,
    loadSessionsForProject,
  };
}
