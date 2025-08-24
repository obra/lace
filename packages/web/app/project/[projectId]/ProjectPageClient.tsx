// ABOUTME: Client component wrapper for project page with providers
// ABOUTME: Handles interactive logic and provider setup for project dashboard

'use client';

import { useCallback } from 'react';
import { motion } from 'motion/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars } from '@/lib/fontawesome';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { ProjectProvider } from '@/components/providers/ProjectProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { AgentProvider } from '@/components/providers/AgentProvider';
import { TaskProvider } from '@/components/providers/TaskProvider';
import { SessionConfigPanel } from '@/components/config/SessionConfigPanel';
import { UIProvider, useUIContext } from '@/components/providers/UIProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { SidebarContent } from '@/components/sidebar/SidebarContent';
import { SettingsContainer } from '@/components/settings/SettingsContainer';

interface ProjectPageClientProps {
  projectId: string;
}

// Define stable callback functions outside component to prevent re-renders
const noOpCallback = () => {};

function ProjectPageContent({ projectId }: { projectId: string }) {
  const { sidebarOpen, toggleSidebar } = useUIContext();
  const { currentProject } = useProjectContext();

  const handleSwitchProject = useCallback(() => {
    // Navigate to root to show project selection
    window.location.href = '/';
  }, []);

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
                onAgentSelect={() => {}} // No agent navigation on project page
                onClearAgent={() => {}} // No agent clearing on project page
                onConfigureAgent={() => {}} // No agent configuration on project page
                onConfigureSession={() => {}} // No session configuration on project page
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
                <h1 className="font-semibold text-base-content truncate">
                  {currentProject?.name || `Project ${projectId}`} - Configuration
                </h1>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 text-base-content bg-base-100/30 backdrop-blur-sm p-6">
          <SessionConfigPanel />
        </div>
      </motion.div>
    </motion.div>
  );
}

export function ProjectPageClient({ projectId }: ProjectPageClientProps) {
  return (
    <UIProvider>
      <ProjectProvider
        selectedProject={projectId}
        onProjectSelect={noOpCallback} // No-op for individual project page
        onProjectChange={noOpCallback} // No-op for individual project page
      >
        <SessionProvider projectId={projectId} selectedSessionId={null}>
          <AgentProvider sessionId={null} selectedAgentId={null} onAgentChange={noOpCallback}>
            <TaskProvider
              projectId={projectId}
              sessionId={null}
              agents={[]} // No agents on project page
            >
              <ProjectPageContent projectId={projectId} />
            </TaskProvider>
          </AgentProvider>
        </SessionProvider>
      </ProjectProvider>
    </UIProvider>
  );
}
