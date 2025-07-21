// ABOUTME: Project selection and management panel for main pane
// ABOUTME: Handles project selection with detailed information display

'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faPlus, faFileText, faHistory, faEllipsisV, faEdit, faTrash } from '@/lib/fontawesome';
import type { ProjectInfo } from '@/types/api';

interface ProjectSelectorPanelProps {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  onProjectSelect: (project: ProjectInfo) => void;
  onProjectCreate?: () => void;
  onProjectUpdate?: (projectId: string, updates: { isArchived?: boolean; name?: string; description?: string }) => void;
  loading?: boolean;
}

type ProjectFilter = 'active' | 'archived' | 'all';
type ProjectTimeFrame = 'week' | 'month' | 'all';

export function ProjectSelectorPanel({
  projects,
  selectedProject,
  onProjectSelect,
  onProjectCreate,
  onProjectUpdate,
  loading = false,
}: ProjectSelectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [timeFrame, setTimeFrame] = useState<ProjectTimeFrame>('week');
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null);

  // Helper function to check if project was active in given timeframe
  const isProjectActiveInTimeframe = (project: ProjectInfo, timeframe: ProjectTimeFrame): boolean => {
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
  const filteredProjects = projects.filter(project => {
    // Search filter
    const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         project.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Archive filter
    const matchesArchiveFilter = 
      filter === 'all' ? true :
      filter === 'archived' ? project.isArchived :
      filter === 'active' ? !project.isArchived : true;
    
    // Timeframe filter (only applies to active projects)
    const matchesTimeFrame = 
      filter === 'archived' ? true : // Don't apply timeframe to archived projects
      isProjectActiveInTimeframe(project, timeFrame);
    
    return matchesSearch && matchesArchiveFilter && matchesTimeFrame;
  });

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

  // Handle context menu actions
  const handleContextMenuAction = (projectId: string, action: 'archive' | 'unarchive' | 'edit') => {
    if (!onProjectUpdate) return;
    
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    switch (action) {
      case 'archive':
        onProjectUpdate(projectId, { isArchived: true });
        break;
      case 'unarchive':
        onProjectUpdate(projectId, { isArchived: false });
        break;
      case 'edit':
        // TODO: Implement edit modal
        // Edit functionality to be implemented
        break;
    }
    
    setShowContextMenu(null);
  };

  // Close context menu on click outside
  const handleBackdropClick = () => {
    setShowContextMenu(null);
  };

  return (
    <div 
      className="bg-base-100 rounded-lg border border-base-300 p-6 flex flex-col h-full"
      onClick={handleBackdropClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-shrink-0">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-base-content">Select Project</h1>
          <p className="text-base-content/60 mt-1">
            Choose a project to manage sessions and agents
          </p>
          
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 pb-4">
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
                <div className="flex items-center gap-3 flex-1 min-w-0">
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
                
                <div className="flex items-center gap-2">
                  {selectedProject?.id === project.id && (
                    <div className="badge badge-primary badge-sm">
                      Active
                    </div>
                  )}
                  
                  {/* Context Menu Button */}
                  {onProjectUpdate && (
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
                              handleContextMenuAction(project.id, 'edit');
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-base-200 flex items-center gap-2"
                          >
                            <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                            Edit
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleContextMenuAction(project.id, project.isArchived ? 'unarchive' : 'archive');
                            }}
                            className="w-full px-4 py-2 text-left hover:bg-base-200 flex items-center gap-2"
                          >
                            <FontAwesomeIcon icon={project.isArchived ? faFolder : faTrash} className="w-3 h-3" />
                            {project.isArchived ? 'Unarchive' : 'Archive'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Project Stats */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faFileText} className="w-3 h-3" />
                  <span>
                    {project.sessionCount ? `${project.sessionCount} sessions` : 'No sessions'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faFolder} className="w-3 h-3" />
                  <span>Created {formatDate(project.createdAt)}</span>
                </div>

                <div className="flex items-center gap-2 text-sm text-base-content/60">
                  <FontAwesomeIcon icon={faHistory} className="w-3 h-3" />
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
    </div>
  );
}