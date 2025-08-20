// ABOUTME: Centralized navigation hook using Next.js router
// ABOUTME: Replaces window.location.href usage with proper Next.js navigation

'use client';

import { useRouter } from 'next/navigation';

export function useNavigation() {
  const router = useRouter();

  return {
    /**
     * Navigate to home page (project selection)
     */
    toHome: () => {
      router.push('/');
    },

    /**
     * Navigate to project configuration page
     */
    toProject: (projectId: string) => {
      router.push(`/project/${projectId}`);
    },

    /**
     * Navigate to session configuration page
     */
    toSession: (projectId: string, sessionId: string) => {
      router.push(`/project/${projectId}/session/${sessionId}`);
    },

    /**
     * Navigate to agent chat page
     */
    toAgent: (projectId: string, sessionId: string, agentId: string) => {
      router.push(`/project/${projectId}/session/${sessionId}/agent/${agentId}`);
    },

    /**
     * Navigate back in browser history
     */
    back: () => {
      router.back();
    },

    /**
     * Replace current route (no history entry)
     */
    replace: (path: string) => {
      router.replace(path);
    },
  };
}
