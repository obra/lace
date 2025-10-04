// ABOUTME: Hook for fetching and managing workspace information for a session
// ABOUTME: Provides workspace mode and detailed workspace info with loading/error states

import { useState, useEffect, useCallback } from 'react';
import { api } from '@lace/web/lib/api-client';
import type { WorkspaceInfo } from '@lace/core/workspace/workspace-container-manager';

export interface WorkspaceDetails {
  mode: 'container' | 'worktree' | 'local';
  info: WorkspaceInfo | null;
}

export interface UseWorkspaceDetailsReturn {
  workspaceMode: 'container' | 'worktree' | 'local' | null;
  workspaceInfo: WorkspaceInfo | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useWorkspaceDetails(sessionId: string | null): UseWorkspaceDetailsReturn {
  const [workspaceMode, setWorkspaceMode] = useState<'container' | 'worktree' | 'local' | null>(
    null
  );
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchWorkspaceDetails = useCallback(async () => {
    if (!sessionId) {
      setWorkspaceMode(null);
      setWorkspaceInfo(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.get<WorkspaceDetails>(`/api/sessions/${sessionId}/workspace`);

      setWorkspaceMode(data.mode);
      setWorkspaceInfo(data.info);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch workspace details'));
      setWorkspaceMode(null);
      setWorkspaceInfo(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchWorkspaceDetails();
  }, [fetchWorkspaceDetails]);

  return {
    workspaceMode,
    workspaceInfo,
    loading,
    error,
    reload: fetchWorkspaceDetails,
  };
}
