// ABOUTME: Root home page content - handles project selection with proper state logic
// ABOUTME: Extracted from LaceApp to handle onboarding and project selection flow

'use client';

import React, { useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';
import { ProjectSelectorPanel } from '@/components/config/ProjectSelectorPanel';
import { FirstProjectHero } from '@/components/onboarding/FirstProjectHero';
import { LoadingView } from '@/components/pages/views/LoadingView';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { SettingsContainer } from '@/components/settings/SettingsContainer';

export function HomePage() {
  const { projects, loading: loadingProjects } = useProjectContext();
  const { autoOpenCreateProject, setAutoOpenCreateProject, sidebarOpen, toggleSidebar } =
    useUIContext();
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

  const handleSwitchProject = useCallback(() => {
    // Already on homepage - no navigation needed
  }, []);

  const loading = loadingProjects;

  return (
    <motion.div
      className="flex h-screen bg-gradient-to-br from-base-100 via-base-200/50 to-base-200 text-base-content font-ui overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Unified Sidebar */}
      <div data-testid="sidebar" className="flex-shrink-0 h-full">
        <SettingsContainer>
          {({ onOpenSettings }: { onOpenSettings: () => void }) => (
            <Sidebar
              open={sidebarOpen}
              onToggle={toggleSidebar}
              onSettingsClick={onOpenSettings as () => void}
            >
              <SidebarContent
                isMobile={false} // Component now handles mobile/desktop internally
                onCloseMobileNav={toggleSidebar as () => void}
                onSwitchProject={handleSwitchProject}
                onAgentSelect={() => {}} // No agent navigation on home page
                onClearAgent={() => {}} // No agent clearing on home page
                onConfigureAgent={() => {}} // No agent configuration on home page
                onConfigureSession={() => {}} // No session configuration on home page
              />
            </Sidebar>
          )}
        </SettingsContainer>
      </div>

      {/* Main Content */}
      <motion.div className="flex-1 flex flex-col min-w-0 h-screen">
        {/* Top Bar */}
        <motion.div className="bg-base-100/90 backdrop-blur-md border-b border-base-300/50 flex-shrink-0 z-30">
          <div className="flex items-center justify-between p-4 lg:px-6">
            <div className="flex items-center gap-3">
              <motion.button
                onClick={toggleSidebar as () => void}
                className="p-2 hover:bg-base-200 rounded-lg lg:hidden"
              >
                <FontAwesomeIcon icon={faBars} className="w-6 h-6" />
              </motion.button>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-base-content truncate">Projects</h1>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm">
          {loading ? (
            <LoadingView />
          ) : (
            <div className="flex-1 p-6 min-h-0 space-y-6">
              {projects && projects.length === 0 && (
                <FirstProjectHero onCreateFirstProject={() => setAutoOpenCreateProject(true)} />
              )}
              {((projects && projects.length > 0) || autoOpenCreateProject) && (
                <ProjectSelectorPanel />
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
