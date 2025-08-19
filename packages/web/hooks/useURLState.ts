// ABOUTME: Next.js App Router URL state management hook
// ABOUTME: Provides clean navigation with automatic cascade clearing through route structure

'use client';

import { useParams, useRouter, usePathname } from 'next/navigation';
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
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();

  // Extract current state from URL params
  const project = params?.projectId as string || null;
  const session = params?.sessionId as ThreadId || null;
  const agent = params?.agentId as ThreadId || null;

  // Navigation functions with automatic cascade clearing
  const navigateToProject = useCallback((projectId: string) => {
    router.push(`/project/${projectId}`);
  }, [router]);

  const navigateToSession = useCallback((projectId: string, sessionId: ThreadId) => {
    router.push(`/project/${projectId}/session/${sessionId}`);
  }, [router]);

  const navigateToAgent = useCallback((projectId: string, sessionId: ThreadId, agentId: ThreadId) => {
    router.push(`/project/${projectId}/session/${sessionId}/agent/${agentId}`);
  }, [router]);

  const navigateToRoot = useCallback(() => {
    router.push('/');
  }, [router]);

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