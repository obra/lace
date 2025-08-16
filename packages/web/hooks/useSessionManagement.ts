// ABOUTME: Custom hook for session management operations
// ABOUTME: Handles session loading, creation, and project configuration

import { useState, useEffect, useCallback } from 'react';
import type { SessionInfo, ThreadId } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';

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
          body: JSON.stringify(sessionData),
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
  };
}
