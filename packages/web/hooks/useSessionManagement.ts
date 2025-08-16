// ABOUTME: Custom hook for session management operations
// ABOUTME: Handles session loading, creation, and project configuration

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, ThreadId } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';
import { stringify } from '@/lib/serialization';

interface UseSessionManagementResult {
  sessions: SessionInfo[];
  loading: boolean;
  projectConfig: Record<string, unknown> | null;
  createSession: (sessionData: {
    name: string;
    description?: string;
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
      const res = await fetch(`/api/projects/${projectId}/sessions`);
      const data: unknown = await parseResponse<unknown>(res);

      if (isApiError(data)) {
        console.error('Failed to load sessions:', data.error);
        setSessions([]);
        return;
      }

      const sessionsData = data as SessionInfo[];
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
      const res = await fetch(`/api/projects/${projectId}/configuration`);
      const data = await parseResponse<{ configuration?: Record<string, unknown> }>(res);

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
      name: string;
      description?: string;
      configuration?: Record<string, unknown>;
    }) => {
      if (!projectId) return;

      try {
        const res = await fetch(`/api/projects/${projectId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(sessionData),
        });

        if (res.ok) {
          // Reload sessions to show the new one
          await loadSessions();
        } else {
          const errorData = await parseResponse<{ error?: string }>(res);
          console.error('Failed to create session:', errorData.error);
        }
      } catch (error) {
        console.error('Failed to create session:', error);
      }
    },
    [projectId, loadSessions]
  );

  const loadSessionConfiguration = useCallback(
    async (sessionId: string): Promise<Record<string, unknown>> => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/configuration`);

        if (!res.ok) {
          throw new Error(`Failed to load session configuration: ${res.status}`);
        }

        const data = await parseResponse<{ configuration: Record<string, unknown> }>(res);
        if (isApiError(data)) {
          throw new Error(data.error);
        }

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
        const res = await fetch(`/api/sessions/${sessionId}/configuration`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(config),
        });

        if (!res.ok) {
          const errorData = await parseResponse<{ error: string }>(res);
          throw new Error(
            errorData.error || `Failed to update session configuration: ${res.status}`
          );
        }
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
        const res = await fetch(`/api/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: stringify(updates),
        });

        if (!res.ok) {
          const errorData = await parseResponse<{ error: string }>(res);
          throw new Error(errorData.error || `Failed to update session: ${res.status}`);
        }

        // Reload sessions to reflect the changes
        await loadSessions();
      } catch (error) {
        console.error('Error updating session:', error);
        throw error;
      }
    },
    [loadSessions]
  );

  // Load sessions when project changes
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Load project config when project changes
  useEffect(() => {
    void loadProjectConfig();
  }, [loadProjectConfig]);

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
  };
}
