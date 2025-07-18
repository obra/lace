// ABOUTME: Project management component with CRUD operations
// ABOUTME: Lists projects, handles selection, creation, and deletion

import React, { useState, useEffect, useCallback } from 'react';
import { ProjectInfo } from '@/types/api';
import { useProjectAPI } from '@/hooks/useProjectAPI';
import { CreateProjectModal } from '@/components/CreateProjectModal';
import { ProjectSettings } from '@/components/ProjectSettings';

interface ProjectWithConfiguration extends ProjectInfo {
  configuration: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    tools?: string[];
    toolPolicies?: Record<string, string>;
    environmentVariables?: Record<string, string>;
  };
}

interface ProjectManagerProps {
  selectedProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectCreated: (project: ProjectInfo) => void;
}

export function ProjectManager({ selectedProjectId, onProjectSelect, onProjectCreated }: ProjectManagerProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsProject, setSettingsProject] = useState<ProjectWithConfiguration | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const { listProjects, deleteProject, updateProject, loading, error } = useProjectAPI();

  const loadProjects = useCallback(async () => {
    const projectList = await listProjects();
    setProjects(projectList);
  }, [listProjects]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleProjectCreated = (project: ProjectInfo) => {
    setProjects(prev => [...prev, project]);
    onProjectCreated(project);
    onProjectSelect(project.id);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (confirm('Are you sure you want to delete this project? This will also delete all associated sessions and threads.')) {
      const success = await deleteProject(projectId);
      if (success) {
        setProjects(prev => prev.filter(p => p.id !== projectId));
        if (selectedProjectId === projectId) {
          onProjectSelect('');
        }
      }
    }
  };

  const handleToggleArchive = async (project: ProjectInfo) => {
    const updated = await updateProject(project.id, { isArchived: !project.isArchived });
    if (updated) {
      setProjects(prev => prev.map(p => p.id === project.id ? updated : p));
    }
  };

  const handleOpenSettings = async (project: ProjectInfo) => {
    setLoadingSettings(true);
    try {
      // Load project configuration
      const configResponse = await fetch(`/api/projects/${project.id}/configuration`);
      if (configResponse.ok) {
        const configData = (await configResponse.json()) as { configuration: Record<string, unknown> };
        const projectWithConfig: ProjectWithConfiguration = {
          ...project,
          configuration: configData.configuration || {}
        };
        setSettingsProject(projectWithConfig);
        setShowSettings(true);
      } else {
        console.error('Failed to load project configuration');
      }
    } catch (error) {
      console.error('Failed to load project configuration:', error);
    } finally {
      setLoadingSettings(false);
    }
  };

  const handleSaveSettings = async (updatedProject: ProjectWithConfiguration) => {
    try {
      // Update project basic info
      const updated = await updateProject(updatedProject.id, {
        name: updatedProject.name,
        description: updatedProject.description,
        workingDirectory: updatedProject.workingDirectory,
        isArchived: updatedProject.isArchived
      });

      if (updated) {
        // Update project configuration
        const configResponse = await fetch(`/api/projects/${updatedProject.id}/configuration`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedProject.configuration)
        });

        if (configResponse.ok) {
          setProjects(prev => prev.map(p => p.id === updatedProject.id ? { ...updated, configuration: updatedProject.configuration } : p));
          setShowSettings(false);
          setSettingsProject(null);
        } else {
          throw new Error('Failed to update project configuration');
        }
      }
    } catch (error) {
      console.error('Failed to save project settings:', error);
      // TODO: Show error message to user
    }
  };

  const filteredProjects = projects.filter(project => 
    showArchived || !project.isArchived
  );

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Projects</h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            New Project
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded mb-4">
          {error}
        </div>
      )}

      {loading && projects.length === 0 ? (
        <div className="text-gray-400 text-sm">Loading projects...</div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-gray-400 text-sm">
          {showArchived ? 'No archived projects' : 'No active projects'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className={`p-3 rounded cursor-pointer transition-colors ${
                selectedProjectId === project.id
                  ? 'bg-blue-600'
                  : 'bg-gray-700 hover:bg-gray-600'
              } ${project.isArchived ? 'opacity-60' : ''}`}
              onClick={() => onProjectSelect(project.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold">{project.name}</span>
                    {project.isArchived && (
                      <span className="text-xs bg-gray-600 px-2 py-1 rounded">
                        Archived
                      </span>
                    )}
                  </div>
                  {project.description && (
                    <div className="text-sm text-gray-300 mt-1">
                      {project.description}
                    </div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {project.sessionCount || 0} sessions • Created {formatDate(project.createdAt)}
                  </div>
                  <div className="text-xs text-gray-500 font-mono mt-1">
                    {project.workingDirectory}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleOpenSettings(project);
                    }}
                    disabled={loadingSettings}
                    className="text-xs px-2 py-1 bg-blue-600 rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
                  >
                    {loadingSettings ? 'Loading...' : 'Settings'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleToggleArchive(project);
                    }}
                    className="text-xs px-2 py-1 bg-gray-600 rounded hover:bg-gray-500 transition-colors"
                  >
                    {project.isArchived ? 'Unarchive' : 'Archive'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteProject(project.id);
                    }}
                    className="text-xs px-2 py-1 bg-red-600 rounded hover:bg-red-500 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onProjectCreated={handleProjectCreated}
      />

      {/* Project Settings Modal */}
      {showSettings && settingsProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <ProjectSettings
              project={settingsProject}
              onSave={handleSaveSettings}
              onCancel={() => {
                setShowSettings(false);
                setSettingsProject(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}