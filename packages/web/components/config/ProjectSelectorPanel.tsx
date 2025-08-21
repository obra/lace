// ABOUTME: Project selection and management panel for main pane
// ABOUTME: Handles project selection with detailed information display

'use client';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faPlus,
  faFileText,
  faHistory,
  faEllipsisV,
  faEdit,
  faTrash,
} from '@/lib/fontawesome';
import type { ProjectInfo } from '@/types/core';
import { AddInstanceModal } from '@/components/providers/AddInstanceModal';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ProjectEditModal } from '@/components/config/ProjectEditModal';
import { ProjectCreateModal } from '@/components/config/ProjectCreateModal';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useUIContext } from '@/components/providers/UIProvider';
import { useOnboarding } from '@/hooks/useOnboarding';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';

interface ProjectSelectorPanelProps {
  // No props needed - all data comes from providers
}

type ProjectFilter = 'active' | 'archived' | 'all';
type ProjectTimeFrame = 'week' | 'month' | 'all';

interface ProjectConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

const DEFAULT_PROJECT_CONFIG: ProjectConfiguration = {
  // providerInstanceId and modelId will be set from available instances
  maxTokens: 4096,
  tools: [],
  toolPolicies: {},
  environmentVariables: {},
};

export function ProjectSelectorPanel({}: ProjectSelectorPanelProps) {
  // Get data from providers instead of props
  const {
    projects,
    currentProject,
    loading: projectLoading,
    onProjectSelect,
    updateProject,
    createProject,
    deleteProject,
    loadProjectConfiguration,
    reloadProjects,
  } = useProjectContext();
  const { enableAgentAutoSelection, loadSessionsForProject } = useSessionContext();
  const { autoOpenCreateProject, setAutoOpenCreateProject } = useUIContext();
  const { handleOnboardingComplete } = useOnboarding(
    setAutoOpenCreateProject,
    enableAgentAutoSelection
  );
  const { availableProviders } = useProviderInstances();

  const router = useRouter();
  const loading = projectLoading;
  const selectedProject = currentProject.id ? currentProject : null;
  const autoOpenCreate = autoOpenCreateProject;
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [timeFrame, setTimeFrame] = useState<ProjectTimeFrame>('week');
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);
  const [editConfig, setEditConfig] = useState<ProjectConfiguration>(DEFAULT_PROJECT_CONFIG);

  // Project creation state
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  // Project deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingProject, setDeletingProject] = useState<ProjectInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Provider setup state
  const [showAddProvider, setShowAddProvider] = useState(false);

  // External trigger: open modal when parent requests (e.g., empty-state button)
  // Only open once per toggle of autoOpenCreate to avoid reopening after user closes
  const autoOpenHandledRef = useRef(false);
  useEffect(() => {
    if (autoOpenCreate && !autoOpenHandledRef.current) {
      autoOpenHandledRef.current = true;
      if (!showCreateProject) {
        setShowCreateProject(true);
      }
      // Do not call onAutoCreateHandled here to avoid unmounting before user interacts
    }
    if (!autoOpenCreate) {
      autoOpenHandledRef.current = false;
    }
  }, [autoOpenCreate, showCreateProject]);

  // Handle provider instance creation success
  const handleProviderAdded = useCallback(() => {
    // Provider data will automatically update via context
    setShowAddProvider(false);
  }, []);

  // Helper function to check if project was active in given timeframe
  const isProjectActiveInTimeframe = (
    project: ProjectInfo,
    timeframe: ProjectTimeFrame
  ): boolean => {
    const now = new Date();
    const lastUsed = new Date(project.lastUsedAt);
    const diffMs = now.getTime() - lastUsed.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    switch (timeframe) {
      case 'week':
        return diffDays <= 7;
      case 'month':
        return diffDays <= 30;
      case 'all':
        return true;
      default:
        return true;
    }
  };

  // Filter projects based on search query, filter type, and timeframe
  const filteredProjects = projects.filter((project) => {
    // Search filter
    const matchesSearch =
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (project.description ?? '').toLowerCase().includes(searchQuery.toLowerCase());

    // Archive filter
    const matchesArchiveFilter =
      filter === 'all'
        ? true
        : filter === 'archived'
          ? project.isArchived
          : filter === 'active'
            ? !project.isArchived
            : true;

    // Timeframe filter (only applies to active projects)
    const matchesTimeFrame =
      filter === 'archived'
        ? true // Don't apply timeframe to archived projects
        : isProjectActiveInTimeframe(project, timeFrame);

    return matchesSearch && matchesArchiveFilter && matchesTimeFrame;
  });

  const getRelativeTime = (dateString: string | Date) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  // Handle context menu actions
  const handleContextMenuAction = async (
    projectId: string,
    action: 'archive' | 'unarchive' | 'edit' | 'delete'
  ) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    try {
      switch (action) {
        case 'archive':
          await updateProject(projectId, { isArchived: true });
          break;
        case 'unarchive':
          await updateProject(projectId, { isArchived: false });
          break;
        case 'edit':
          setEditingProject(project);
          // Load actual project configuration using provider
          await loadProjectConfig(project.id);
          break;
        case 'delete':
          setDeletingProject(project);
          setShowDeleteConfirm(true);
          break;
      }
    } catch (error) {
      console.error('Project action failed:', { projectId, action, error });
    }

    setShowContextMenu(null);
  };

  // Handle edit project form submission
  const handleEditProject = async (
    projectId: string,
    updates: {
      name: string;
      description?: string;
      workingDirectory: string;
      configuration: ProjectConfiguration;
    }
  ) => {
    try {
      // Use provider method instead of direct API call
      await updateProject(projectId, updates);
      setEditingProject(null);
      setEditConfig(DEFAULT_PROJECT_CONFIG);
    } catch (error) {
      console.error('Project update error:', { projectId, error });
      throw error;
    }
  };

  // Cancel edit project
  const handleCancelEdit = () => {
    setEditingProject(null);
    setEditConfig(DEFAULT_PROJECT_CONFIG);
  };

  // Handle delete project confirmation
  const handleDeleteProject = async () => {
    if (!deletingProject || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteProject(deletingProject.id);
      // Only close modal and clear state on success
      setShowDeleteConfirm(false);
      setDeletingProject(null);
      setIsDeleting(false);
      setDeleteError(null);
    } catch (error) {
      console.error('Project delete error:', { projectId: deletingProject.id, error });
      setIsDeleting(false);
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete project. Please try again.'
      );
      // Don't close modal or clear deletingProject - let user retry
    }
  };

  // Cancel delete project
  const handleCancelDelete = () => {
    if (isDeleting) return; // Don't allow cancel during deletion
    setShowDeleteConfirm(false);
    setDeletingProject(null);
    setDeleteError(null);
  };

  // Load project configuration using provider method
  const loadProjectConfig = async (projectId: string) => {
    try {
      const configData = await loadProjectConfiguration(projectId);
      // If no provider instance configured, use first available
      const config = {
        ...DEFAULT_PROJECT_CONFIG,
        ...configData,
      };
      if (!config.providerInstanceId && availableProviders.length > 0) {
        config.providerInstanceId = availableProviders[0].instanceId;
        config.modelId = availableProviders[0].models[0]?.id || '';
      }
      setEditConfig(config);
    } catch (error) {
      console.error('Project config load error:', { projectId, error });
      // Fallback to default configuration with first available provider
      const config = { ...DEFAULT_PROJECT_CONFIG };
      if (availableProviders.length > 0) {
        config.providerInstanceId = availableProviders[0].instanceId;
        config.modelId = availableProviders[0].models[0]?.id || '';
      }
      setEditConfig(config);
    }
  };

  // Handle project creation
  const handleCreateProject = async (projectData: {
    name: string;
    description?: string;
    workingDirectory: string;
    configuration: ProjectConfiguration;
  }) => {
    setIsCreatingProject(true);

    try {
      // Step 1: Create project using provider method
      const createdProject = await createProject(projectData);
      const projectId = createdProject.id;

      // Step 2: Navigate directly to chat - modal stays open until page changes
      const sessionsData = await loadSessionsForProject(projectId);

      const sessionId = sessionsData[0]?.id;
      if (sessionId) {
        const coordinatorAgentId = sessionId; // coordinator has same threadId

        // Complete onboarding and navigate to agent
        await handleOnboardingComplete(projectId, sessionId, coordinatorAgentId);

        // Don't reset state here - let page navigation handle component unmount
        return;
      }

      // Only reset modal state if navigation workflow failed
      setIsCreatingProject(false);
      setShowCreateProject(false);
      setAutoOpenCreateProject(false);
      throw new Error('Failed to complete project creation workflow');
    } catch (error) {
      console.error('Project create error:', error);
      // Only close modal on error
      setIsCreatingProject(false);
      setShowCreateProject(false);
      setAutoOpenCreateProject(false);
      throw error;
    }
  };

  // Close context menu on click outside
  const handleBackdropClick = () => {
    setShowContextMenu(null);
  };

  return (
    <ProviderInstanceProvider>
      <div
        className="bg-base-100 rounded-lg border border-base-300 p-6 flex flex-col h-full"
        onClick={handleBackdropClick}
      >
        {/* Header (hidden until at least one project exists) */}
        {projects.length > 0 && (
          <div className="flex items-start justify-between mb-6 flex-shrink-0">
            <div className="flex-1">
              {/* Intentionally omit 'Select Project' title per UX request */}

              {/* Tabs and Filters */}
              <div className="flex items-center gap-4 mt-4">
                {/* Archive Filter Tabs */}
                <div className="tabs tabs-boxed">
                  <button
                    className={`tab ${filter === 'active' ? 'tab-active' : ''}`}
                    onClick={() => setFilter('active')}
                  >
                    Active
                  </button>
                  <button
                    className={`tab ${filter === 'archived' ? 'tab-active' : ''}`}
                    onClick={() => setFilter('archived')}
                  >
                    Archived
                  </button>
                </div>

                {/* Timeframe Filter (only for active projects) */}
                {filter === 'active' && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-base-content/60">Show:</span>
                    <select
                      data-testid="project-timeframe-filter"
                      value={timeFrame}
                      onChange={(e) => setTimeFrame(e.target.value as ProjectTimeFrame)}
                      className="select select-bordered select-sm"
                    >
                      <option value="week">This week</option>
                      <option value="month">This month</option>
                      <option value="all">All time</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        {projects.length > 6 && (
          <div className="mb-6 flex-shrink-0">
            <input
              type="text"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-bordered w-full max-w-md"
            />
          </div>
        )}

        {/* Projects Grid - Scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <div className="loading loading-spinner loading-md"></div>
                <span>Loading projects...</span>
              </div>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="text-center py-12">
              {projects.length === 0 ? (
                <>
                  <FontAwesomeIcon
                    icon={faFolder}
                    className="w-16 h-16 text-base-content/20 mb-4"
                  />
                  <h3 className="text-lg font-medium text-base-content mb-2">No Projects Yet</h3>
                  <p className="text-base-content/60">
                    Create your first project to start working with AI agents
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-base-content mb-2">
                    No matching projects
                  </h3>
                  <p className="text-base-content/60">Try adjusting your search terms</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3 pb-4">
              {/* New Project Button */}
              <div
                onClick={() => setShowCreateProject(true)}
                className="border-2 border-dashed border-primary/50 rounded-lg p-4 cursor-pointer transition-all hover:border-primary hover:bg-primary/5 flex items-center gap-4"
                data-testid="create-project-button"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowCreateProject(true);
                  }
                }}
              >
                <FontAwesomeIcon icon={faPlus} className="w-6 h-6 text-primary" />
                <div className="text-left">
                  <h3 className="font-semibold text-base-content">Create New Project</h3>
                  <p className="text-sm text-base-content/60">
                    Start a new project to organize your AI conversations
                  </p>
                </div>
              </div>

              {filteredProjects.map((project) => (
                <div
                  key={project.id}
                  data-testid="project-list-entry"
                  className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg ${
                    selectedProject?.id === project.id
                      ? 'border-primary bg-primary/5 shadow-md'
                      : 'border-base-300 hover:border-primary/50'
                  }`}
                  onClick={() => router.push(`/project/${project.id}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-focus rounded-lg flex items-center justify-center">
                        <FontAwesomeIcon icon={faFolder} className="w-5 h-5 text-primary-content" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-base-content truncate">{project.name}</h3>
                        {project.description && (
                          <p className="text-sm text-base-content/60 truncate">
                            {project.description}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedProject?.id === project.id && (
                        <div className="badge badge-primary badge-sm">Active</div>
                      )}

                      {/* Context Menu Button */}

                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowContextMenu(showContextMenu === project.id ? null : project.id);
                          }}
                          className="btn btn-ghost btn-xs opacity-60 hover:opacity-100"
                        >
                          <FontAwesomeIcon icon={faEllipsisV} className="w-3 h-3" />
                        </button>

                        {/* Context Menu Dropdown */}
                        {showContextMenu === project.id && (
                          <div className="absolute right-0 top-8 bg-base-100 border border-base-300 rounded-lg shadow-lg py-2 min-w-40 z-10">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleContextMenuAction(project.id, 'edit');
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-base-200 flex items-center gap-2"
                            >
                              <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                              Edit
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleContextMenuAction(
                                  project.id,
                                  project.isArchived ? 'unarchive' : 'archive'
                                );
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-base-200 flex items-center gap-2"
                            >
                              <FontAwesomeIcon
                                icon={project.isArchived ? faFolder : faTrash}
                                className="w-3 h-3"
                              />
                              {project.isArchived ? 'Unarchive' : 'Archive'}
                            </button>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleContextMenuAction(project.id, 'delete');
                              }}
                              className="w-full px-4 py-2 text-left hover:bg-base-200 flex items-center gap-2 text-error"
                            >
                              <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-base-content/60">
                      <div className="flex items-center gap-1">
                        <FontAwesomeIcon icon={faFileText} className="w-3 h-3" />
                        <span>{project.sessionCount || 0} sessions</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <FontAwesomeIcon icon={faHistory} className="w-3 h-3" />
                        <span>{getRelativeTime(project.lastUsedAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Archive Status */}
                  {project.isArchived && (
                    <div className="pt-2">
                      <span className="badge badge-warning badge-xs">Archived</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Edit Project Modal */}
        <ProjectEditModal
          isOpen={!!editingProject}
          project={editingProject}
          loading={loading}
          onClose={handleCancelEdit}
          onSubmit={handleEditProject}
          initialConfig={editConfig}
        />

        {/* Create Project Modal */}
        <ProjectCreateModal
          isOpen={showCreateProject}
          loading={isCreatingProject}
          onClose={() => {
            setShowCreateProject(false);
            setAutoOpenCreateProject(false);
          }}
          onSubmit={handleCreateProject}
          onAddProvider={() => setShowAddProvider(true)}
        />

        {/* Add Provider Modal */}
        <AddInstanceModal
          isOpen={showAddProvider}
          onClose={() => setShowAddProvider(false)}
          onSuccess={handleProviderAdded}
        />

        {/* Delete Confirmation Modal */}
        {deletingProject && (
          <AnimatedModal
            isOpen={showDeleteConfirm}
            onClose={handleCancelDelete}
            title="Delete Project"
          >
            <div className="space-y-4">
              <p className="text-base-content">
                Are you sure you want to delete the project <strong>{deletingProject.name}</strong>?
              </p>
              <p className="text-base-content/60 text-sm">
                This will permanently delete the project and all its sessions and conversations.
                This action cannot be undone.
              </p>

              {deleteError && (
                <div className="alert alert-error">
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelDelete}
                  className="btn btn-ghost"
                  type="button"
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteProject()}
                  className={`btn btn-error ${isDeleting ? 'loading' : ''}`}
                  type="button"
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete Project'}
                </button>
              </div>
            </div>
          </AnimatedModal>
        )}
      </div>
    </ProviderInstanceProvider>
  );
}
