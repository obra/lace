// ABOUTME: Project sidebar section component displaying current workspace info
// ABOUTME: Shows project details, stats, and switch project functionality

'use client';

import React, { memo, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faComments,
  faRobot,
  faChevronUp,
  faChevronDown,
  faCog,
} from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { ProjectEditModal } from '@/components/config/ProjectEditModal';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useProviders } from '@/hooks/useProviders';

interface ProjectSectionProps {
  isMobile?: boolean;
  onCloseMobileNav?: () => void;
  onSwitchProject: () => void;
}

export const ProjectSection = memo(function ProjectSection({
  isMobile = false,
  onCloseMobileNav,
  onSwitchProject,
}: ProjectSectionProps) {
  // Modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editConfig, setEditConfig] = useState({});
  const [loading, setLoading] = useState(false);

  // Get project data from ProjectProvider
  const { selectedProject, foundProject, updateProject, loadProjectConfiguration } =
    useProjectContext();

  // Get session data from SessionProvider
  const { sessions } = useSessionContext();

  // Get agent data from AgentProvider
  const { sessionDetails } = useAgentContext();

  // Get providers data
  const { providers } = useProviders();

  // Load project configuration when modal opens
  useEffect(() => {
    if (showEditModal && selectedProject) {
      const loadConfig = async () => {
        setLoading(true);
        try {
          const config = await loadProjectConfiguration(selectedProject);
          setEditConfig(config);
        } catch (error) {
          console.error('Failed to load project configuration:', error);
          setEditConfig({});
        } finally {
          setLoading(false);
        }
      };
      void loadConfig();
    }
  }, [showEditModal, selectedProject, loadProjectConfiguration]);

  // Don't render if no project is selected
  if (!selectedProject || !foundProject) {
    return null;
  }

  const sessionsCount = sessions?.length || 0;
  const handleSwitchProject = () => {
    onSwitchProject();
    if (isMobile) {
      onCloseMobileNav?.();
    }
  };

  // Handle opening the settings modal
  const handleOpenSettings = () => {
    setShowEditModal(true);
  };

  // Handle closing the settings modal
  const handleCloseSettings = () => {
    setShowEditModal(false);
    setEditConfig({});
  };

  // Handle project update
  const handleUpdateProject = async (
    projectId: string,
    updates: {
      name: string;
      description?: string;
      workingDirectory: string;
      configuration: Record<string, unknown>;
    }
  ) => {
    setLoading(true);
    try {
      await updateProject(projectId, updates);
      setShowEditModal(false);
      setEditConfig({});
    } catch (error) {
      console.error('Failed to update project:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const testId = isMobile ? 'current-project-name' : 'current-project-name-desktop';

  // Header actions for workspace navigation (stacked left/right arrows as single icon)
  const headerActions = (
    <button
      onClick={handleSwitchProject}
      className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 flex-shrink-0 border border-transparent hover:border-base-300/30"
      title="Switch workspace"
      data-testid="workspace-switch-header-button"
    >
      <svg
        className="w-3.5 h-3.5 text-base-content/50 hover:text-base-content/70 transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
        />
      </svg>
    </button>
  );

  return (
    <SidebarSection
      title="Workspace"
      icon={faFolder}
      defaultCollapsed={false}
      collapsible={false}
      headerActions={headerActions}
    >
      {/* Project Overview Card */}
      <div className="bg-base-100/80 backdrop-blur-sm border border-base-300/30 rounded-xl p-4 mb-3 shadow-sm -ml-1">
        <div className="flex items-start justify-between mb-3">
          <div className="min-w-0 flex-1">
            <h3
              data-testid={testId}
              className="font-semibold text-base-content text-sm truncate leading-tight"
            >
              {foundProject.name}
            </h3>
            {foundProject.description && (
              <p className="text-xs text-base-content/60 truncate mt-0.5">
                {foundProject.description}
              </p>
            )}
          </div>
          <button
            onClick={handleOpenSettings}
            className="p-1.5 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 flex-shrink-0 border border-transparent hover:border-base-300/30"
            title="Workspace settings"
            data-testid="workspace-settings-button"
          >
            <FontAwesomeIcon
              icon={faCog}
              className="w-3.5 h-3.5 text-base-content/50 hover:text-base-content/70 transition-colors"
            />
          </button>
        </div>

        {/* Project Stats */}
        <div className="flex items-center gap-4 text-xs text-base-content/60">
          <div className="flex items-center gap-1.5">
            <FontAwesomeIcon icon={faComments} className="w-3 h-3" />
            <span data-testid="sessions-count">
              {sessionsCount} session{sessionsCount !== 1 ? 's' : ''}
            </span>
          </div>
          {sessionDetails && (
            <div className="flex items-center gap-1.5">
              <FontAwesomeIcon icon={faRobot} className="w-3 h-3" />
              <span data-testid="agents-count">
                {sessionDetails.agents?.length || 0} agent
                {sessionDetails.agents?.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Project Settings Modal */}
      <ProjectEditModal
        isOpen={showEditModal}
        project={foundProject}
        providers={providers}
        loading={loading}
        onClose={handleCloseSettings}
        onSubmit={handleUpdateProject}
        initialConfig={editConfig}
      />
    </SidebarSection>
  );
});
