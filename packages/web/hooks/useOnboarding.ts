// ABOUTME: Onboarding flow management for new project/session/agent creation
// ABOUTME: Handles coordinated state updates and navigation after onboarding completion

import { useCallback } from 'react';
import { useAppState } from '@/components/providers/AppStateProvider';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';

interface UseOnboardingResult {
  handleOnboardingComplete: (
    projectId: string,
    sessionId: string,
    agentId: string
  ) => Promise<void>;
  handleAutoOpenProjectCreation: (projectCount: number) => void;
}

export function useOnboarding(
  setAutoOpenCreateProject: (open: boolean) => void,
  enableAgentAutoSelection: () => void
): UseOnboardingResult {
  const {
    actions: { updateHashState },
  } = useAppState();
  const { reloadProjects } = useProjectContext();

  // Handle onboarding completion - navigate directly to chat
  const handleOnboardingComplete = useCallback(
    async (projectId: string, sessionId: string, agentId: string) => {
      // Reload projects first to ensure the newly created project is in the array
      await reloadProjects();

      // Set all three selections atomically to navigate directly to chat
      updateHashState({
        project: projectId,
        session: sessionId,
        agent: agentId,
      });

      // Clear auto-open state
      setAutoOpenCreateProject(false);

      // Enable auto-selection for this onboarding completion
      enableAgentAutoSelection();
    },
    [reloadProjects, updateHashState, setAutoOpenCreateProject, enableAgentAutoSelection]
  );

  // Auto-open project creation modal when no projects exist
  const handleAutoOpenProjectCreation = useCallback(
    (projectCount: number) => {
      // Only automatically close the modal if there are projects
      // Don't automatically open it - let manual triggers handle that
      if (projectCount > 0) {
        setAutoOpenCreateProject(false);
      }
    },
    [setAutoOpenCreateProject]
  );

  return {
    handleOnboardingComplete,
    handleAutoOpenProjectCreation,
  };
}
