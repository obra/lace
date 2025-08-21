// ABOUTME: Root home page content - handles project selection with proper state logic
// ABOUTME: Uses new PageLayout architecture for consistency and maintainability

'use client';

import React, { useEffect } from 'react';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { FirstProjectHero } from '@/components/onboarding/FirstProjectHero';
import { LoadingView } from '@/components/pages/views/LoadingView';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { PageLayout } from '@/components/layout/PageLayout';

export function HomePage() {
  const { projects, loading: loadingProjects } = useProjectContext();
  const { autoOpenCreateProject, setAutoOpenCreateProject } = useUIContext();
  const { enableAgentAutoSelection } = useSessionContext();

  // Onboarding flow management
  const { handleAutoOpenProjectCreation } = useOnboarding(
    setAutoOpenCreateProject,
    enableAgentAutoSelection
  );

  // Auto-open project creation modal when no projects exist
  useEffect(() => {
    if (!loadingProjects && projects) {
      handleAutoOpenProjectCreation(projects.length);
    }
  }, [projects?.length, loadingProjects, handleAutoOpenProjectCreation, projects]);

  return (
    <PageLayout
      title="Projects"
      // No navigation callbacks needed - already on home page
    >
      {loadingProjects ? (
        <LoadingView />
      ) : (
        <div className="flex-1 p-6 min-h-0 space-y-6">
          {projects && projects.length === 0 && (
            <FirstProjectHero onCreateFirstProject={() => setAutoOpenCreateProject(true)} />
          )}
          {((projects && projects.length > 0) || autoOpenCreateProject) && <ProjectSelectorPanel />}
        </div>
      )}
    </PageLayout>
  );
}
