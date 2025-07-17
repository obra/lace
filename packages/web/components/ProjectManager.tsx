// ABOUTME: Project management component with CRUD operations
// ABOUTME: Lists projects, handles selection, creation, and deletion

import React, { useState, useEffect, useCallback } from 'react';
import { ProjectInfo } from '@/types/api';
import { useProjectAPI } from '@/hooks/useProjectAPI';
import { CreateProjectModal } from '@/components/CreateProjectModal';

interface ProjectManagerProps {
  selectedProjectId: string | null;
  onProjectSelect: (projectId: string) => void;
  onProjectCreated: (project: ProjectInfo) => void;
}

export function ProjectManager({ selectedProjectId, onProjectSelect, onProjectCreated }: ProjectManagerProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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
    </div>
  );
}