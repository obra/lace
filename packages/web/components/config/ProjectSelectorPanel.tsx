// ABOUTME: Project selection and management panel for main pane
// ABOUTME: Handles project selection with detailed information display

'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faPlus, faCalendar, faHashtag, faClock } from '@/lib/fontawesome';
import type { ProjectInfo } from '@/types/api';

interface ProjectSelectorPanelProps {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  onProjectSelect: (project: ProjectInfo) => void;
  onProjectCreate?: () => void;
  loading?: boolean;
}

export function ProjectSelectorPanel({
  projects,
  selectedProject,
  onProjectSelect,
  onProjectCreate,
  loading = false,
}: ProjectSelectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter projects based on search query
  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (dateString: string | Date) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

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

  return (
    <div className="bg-base-100 rounded-lg border border-base-300 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-base-content">Select Project</h1>
          <p className="text-base-content/60 mt-1">
            Choose a project to manage sessions and agents
          </p>
        </div>
        
        {onProjectCreate && (
          <button
            onClick={onProjectCreate}
            className="btn btn-primary"
            disabled={loading}
          >
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            New Project
          </button>
        )}
      </div>

      {/* Search */}
      {projects.length > 6 && (
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input input-bordered w-full max-w-md"
          />
        </div>
      )}

      {/* Projects Grid */}
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
              <FontAwesomeIcon icon={faFolder} className="w-16 h-16 text-base-content/20 mb-4" />
              <h3 className="text-lg font-medium text-base-content mb-2">No Projects Yet</h3>
              <p className="text-base-content/60 mb-6">
                Create your first project to start working with AI agents
              </p>
              {onProjectCreate && (
                <button
                  onClick={onProjectCreate}
                  className="btn btn-primary"
                >
                  <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
                  Create First Project
                </button>
              )}
            </>
          ) : (
            <>
              <h3 className="text-lg font-medium text-base-content mb-2">No matching projects</h3>
              <p className="text-base-content/60">
                Try adjusting your search terms
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className={`border rounded-lg p-6 cursor-pointer transition-all hover:shadow-lg ${
                selectedProject?.id === project.id
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-base-300 hover:border-primary/50'
              }`}
              onClick={() => onProjectSelect(project)}
            >
              {/* Project Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary-focus rounded-lg flex items-center justify-center">
                    <FontAwesomeIcon icon={faFolder} className="w-5 h-5 text-primary-content" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base-content truncate">
                      {project.name}
                    </h3>
                    <p className="text-sm text-base-content/60 truncate">
                      {project.description || 'No description'}
                    </p>
                  </div>
                </div>
                
                {selectedProject?.id === project.id && (
                  <div className="badge badge-primary badge-sm">
                    Active
                  </div>
                )}
              </div>

              {/* Project Stats */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faHashtag} className="w-3 h-3" />
                  <span>
                    {project.sessionCount ? `${project.sessionCount} sessions` : 'No sessions'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faCalendar} className="w-3 h-3" />
                  <span>Created {formatDate(project.createdAt)}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faClock} className="w-3 h-3" />
                  <span>Active {getRelativeTime(project.lastUsedAt)}</span>
                </div>
              </div>

              {/* Working Directory */}
              <div className="pt-3 border-t border-base-300">
                <div className="text-xs text-base-content/50 font-mono truncate">
                  {project.workingDirectory}
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
  );
}