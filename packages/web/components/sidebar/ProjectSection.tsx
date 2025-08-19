// ABOUTME: Project sidebar section component displaying current workspace info
// ABOUTME: Shows project details, stats, and switch project functionality

'use client';

import React, { memo, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faCog } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { ProjectEditModal } from '@/components/config/ProjectEditModal';
import { SwitchIcon } from '@/components/ui/SwitchIcon';
import { useProjectContext } from '@/components/providers/ProjectProvider';
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
    <SwitchIcon
      onClick={handleSwitchProject}
      title="Switch workspace"
      aria-label="Switch to workspace selector"
      data-testid="workspace-switch-header-button"
    />
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
      <div className="bg-base-100/80 backdrop-blur-sm border border-base-300/30 rounded-xl p-3 mb-3 shadow-sm -ml-1">
        <div className="flex items-center justify-between">
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
