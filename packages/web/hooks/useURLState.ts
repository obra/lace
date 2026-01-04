// ABOUTME: React Router v7 URL state management hook
// ABOUTME: Provides clean navigation with automatic cascade clearing through route structure

'use client';

import { useParams, useNavigate } from 'react-router';
import { useCallback } from 'react';
import type { ThreadId, WorkspaceSessionId } from '@lace/web/types/core';

export interface URLState {
  project: string | null;
  session: WorkspaceSessionId | null;
  agent: ThreadId | null;
}

export interface URLActions {
  navigateToProject: (projectId: string) => void;
  navigateToSession: (
    projectId: string,
    sessionId: WorkspaceSessionId,
    options?: { initialMessage?: string }
  ) => void;
  navigateToAgent: (projectId: string, sessionId: WorkspaceSessionId, agentId: ThreadId) => void;
  navigateToRoot: () => void;
}

export function useURLState(): URLState & URLActions {
  const navigate = useNavigate();
  const params = useParams();

  // Extract current state from URL params
  const project = (params?.projectId as string) || null;
  const session = (params?.sessionId as WorkspaceSessionId) || null;
  const agent = (params?.agentId as ThreadId) || null;

  // Navigation functions with automatic cascade clearing
  const navigateToProject = useCallback(
    (projectId: string) => {
      navigate(`/project/${projectId}`);
    },
    [navigate]
  );

  const navigateToSession = useCallback(
    (projectId: string, sessionId: WorkspaceSessionId, options?: { initialMessage?: string }) => {
      navigate(`/project/${projectId}/session/${sessionId}`, {
        state: options?.initialMessage ? { initialMessage: options.initialMessage } : undefined,
      });
    },
    [navigate]
  );

  const navigateToAgent = useCallback(
    (projectId: string, sessionId: WorkspaceSessionId, agentId: ThreadId) => {
      navigate(`/project/${projectId}/session/${sessionId}/agent/${agentId}`);
    },
    [navigate]
  );

  const navigateToRoot = useCallback(() => {
    navigate('/');
  }, [navigate]);

  return {
    // Current state
    project,
    session,
    agent,

    // Navigation actions
    navigateToProject,
    navigateToSession,
    navigateToAgent,
    navigateToRoot,
  };
}
