// ABOUTME: Project sidebar section component displaying current workspace info
// ABOUTME: Shows project details, stats, and switch project functionality

'use client';

import React, { memo, useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faCog } from '@/lib/fontawesome';
import { ProjectEditModal } from '@/components/config/ProjectEditModal';
import { SwitchIcon } from '@/components/ui/SwitchIcon';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';

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
  const { availableProviders: providers } = useProviderInstances();

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

  // Header actions for workspace navigation - both switch and edit on same line
  const headerActions = (
    <div className="flex items-center gap-1">
      <button
        onClick={handleOpenSettings}
        className="p-1 hover:bg-base-200/80 backdrop-blur-sm rounded-lg transition-all duration-200 border border-transparent hover:border-base-300/30"
        title="Workspace settings"
        data-testid="workspace-settings-button"
      >
        <FontAwesomeIcon
          icon={faCog}
          className="w-3 h-3 text-base-content/50 hover:text-base-content/70 transition-colors"
        />
      </button>
      <SwitchIcon
        onClick={handleSwitchProject}
        title="Switch workspace"
        aria-label="Switch to workspace selector"
        data-testid="workspace-switch-header-button"
      />
    </div>
  );

  return (
    <div className="px-6 py-2">
      {/* Custom header with project name */}
      <div className="w-full flex items-center justify-between text-sm font-medium text-base-content/60 mb-2">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon icon={faFolder} className="w-4 h-4" />
          <h3
            className="uppercase tracking-wider text-xs font-semibold truncate"
            data-testid={testId}
          >
            {foundProject.name}
          </h3>
        </div>
        <div className="flex items-center gap-2">{headerActions}</div>
      </div>

      {/* Project Description if available */}
      {foundProject.description && (
        <div className="text-xs text-base-content/60 mb-2 px-1 truncate">
          {foundProject.description}
        </div>
      )}

      {/* Project Settings Modal */}
      <ProjectEditModal
        isOpen={showEditModal}
        project={foundProject}
        loading={loading}
        onClose={handleCloseSettings}
        onSubmit={handleUpdateProject}
        initialConfig={editConfig}
      />
    </div>
  );
});
