// ABOUTME: Root home page content - handles project selection with proper state logic
// ABOUTME: Extracted from LaceApp to handle onboarding and project selection flow

'use client';

import React, { useEffect } from 'react';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { FirstProjectHero } from '@/components/onboarding/FirstProjectHero';
import { LoadingView } from '@/components/pages/views/LoadingView';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSessionContext } from '@/components/providers/SessionProvider';

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
    if (!loadingProjects) {
      handleAutoOpenProjectCreation(projects?.length || 0);
    }
  }, [projects?.length, loadingProjects, handleAutoOpenProjectCreation]);

  const loading = loadingProjects;

  return (
    <div className="flex h-screen bg-base-200 text-base-content font-ui">
      <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
        {loading ? (
          <LoadingView />
        ) : (
          <div className="flex-1 p-6 min-h-0 space-y-6">
            {projects.length === 0 && (
              <FirstProjectHero onCreateFirstProject={() => setAutoOpenCreateProject(true)} />
            )}
            {(projects.length > 0 || autoOpenCreateProject) && <ProjectSelectorPanel />}
          </div>
        )}
      </div>
    </div>
  );
}
