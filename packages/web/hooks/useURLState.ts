// ABOUTME: React Router v7 URL state management hook
// ABOUTME: Provides clean navigation with automatic cascade clearing through route structure

'use client';

import { useParams, useNavigate, useLocation } from 'react-router';
import { useCallback } from 'react';
import type { ThreadId } from '@/types/core';

export interface URLState {
  project: string | null;
  session: ThreadId | null;
  agent: ThreadId | null;
}

export interface URLActions {
  navigateToProject: (projectId: string) => void;
  navigateToSession: (projectId: string, sessionId: ThreadId) => void;
  navigateToAgent: (projectId: string, sessionId: ThreadId, agentId: ThreadId) => void;
  navigateToRoot: () => void;
}

export function useURLState(): URLState & URLActions {
  const navigate = useNavigate();
  const params = useParams();
  const location = useLocation();

  // Extract current state from URL params
  const project = (params?.projectId as string) || null;
  const session = (params?.sessionId as ThreadId) || null;
  const agent = (params?.agentId as ThreadId) || null;

  // Navigation functions with automatic cascade clearing
  const navigateToProject = useCallback(
    (projectId: string) => {
      navigate(`/project/${projectId}`);
    },
    [navigate]
  );

  const navigateToSession = useCallback(
    (projectId: string, sessionId: ThreadId) => {
      navigate(`/project/${projectId}/session/${sessionId}`);
    },
    [navigate]
  );

  const navigateToAgent = useCallback(
    (projectId: string, sessionId: ThreadId, agentId: ThreadId) => {
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
