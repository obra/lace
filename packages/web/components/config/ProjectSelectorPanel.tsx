// ABOUTME: Project selection and management panel for main pane
// ABOUTME: Handles project selection with detailed information display

'use client';

import { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faPlus, faFileText, faHistory, faEllipsisV, faEdit, faTrash } from '@/lib/fontawesome';
import type { ProjectInfo, ProviderInfo } from '@/types/api';

interface ProjectSelectorPanelProps {
  projects: ProjectInfo[];
  selectedProject: ProjectInfo | null;
  providers?: ProviderInfo[];
  onProjectSelect: (project: ProjectInfo) => void;
  onProjectCreate?: () => void;
  onProjectUpdate?: (projectId: string, updates: { isArchived?: boolean; name?: string; description?: string; workingDirectory?: string; configuration?: ProjectConfiguration }) => void;
  loading?: boolean;
}

type ProjectFilter = 'active' | 'archived' | 'all';
type ProjectTimeFrame = 'week' | 'month' | 'all';

interface ProjectConfiguration {
  provider?: string;
  model?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
}

const DEFAULT_PROJECT_CONFIG: ProjectConfiguration = {
  provider: 'anthropic',
  model: 'claude-3-sonnet-20241022',
  maxTokens: 4096,
  tools: [],
  toolPolicies: {},
  environmentVariables: {},
};

const AVAILABLE_TOOLS = [
  'bash', 'file-read', 'file-write', 'file-edit', 'file-list', 
  'file-find', 'url-fetch', 'task-manager', 'delegate'
];

export function ProjectSelectorPanel({
  projects,
  selectedProject,
  providers = [],
  onProjectSelect,
  onProjectCreate,
  onProjectUpdate,
  loading = false,
}: ProjectSelectorPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [timeFrame, setTimeFrame] = useState<ProjectTimeFrame>('week');
  const [showContextMenu, setShowContextMenu] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<ProjectInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editWorkingDirectory, setEditWorkingDirectory] = useState('');
  const [editConfig, setEditConfig] = useState<ProjectConfiguration>(DEFAULT_PROJECT_CONFIG);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  // Get available models for project configuration
  const availableModels = useMemo(() => {
    const provider = providers.find(p => p.type === editConfig.provider);
    return provider?.models || [];
  }, [providers, editConfig.provider]);

  // Get available providers (only those that are available)
  const availableProviders = useMemo(() => {
    return providers.filter(p => p.available);
  }, [providers]);

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
        setEditingProject(project);
        setEditName(project.name);
        setEditDescription(project.description || '');
        setEditWorkingDirectory(project.workingDirectory);
        // TODO: Load actual project configuration from API
        setEditConfig(DEFAULT_PROJECT_CONFIG);
        break;
    }
    
    setShowContextMenu(null);
  };

  // Handle edit project form submission
  const handleEditProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject || !onProjectUpdate || !editName.trim()) return;

    onProjectUpdate(editingProject.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      workingDirectory: editWorkingDirectory.trim(),
      configuration: editConfig,
    });

    handleCancelEdit();
  };

  // Cancel edit project
  const handleCancelEdit = () => {
    setEditingProject(null);
    setEditName('');
    setEditDescription('');
    setEditWorkingDirectory('');
    setEditConfig(DEFAULT_PROJECT_CONFIG);
    setNewEnvKey('');
    setNewEnvValue('');
  };

  // Handle environment variable addition
  const handleAddEnvironmentVariable = () => {
    if (!newEnvKey.trim() || !newEnvValue.trim()) return;

    setEditConfig(prev => ({
      ...prev,
      environmentVariables: {
        ...prev.environmentVariables,
        [newEnvKey.trim()]: newEnvValue.trim(),
      },
    }));

    setNewEnvKey('');
    setNewEnvValue('');
  };

  // Handle environment variable removal
  const handleRemoveEnvironmentVariable = (key: string) => {
    setEditConfig(prev => ({
      ...prev,
      environmentVariables: {
        ...prev.environmentVariables,
        [key]: undefined,
      },
    }));
  };

  // Handle tool policy changes
  const handleToolPolicyChange = (tool: string, policy: 'allow' | 'require-approval' | 'deny') => {
    setEditConfig(prev => ({
      ...prev,
      toolPolicies: {
        ...prev.toolPolicies,
        [tool]: policy,
      },
    }));
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
            {/* New Project Card */}
            {onProjectCreate && (
              <div
                onClick={onProjectCreate}
                className="border-2 border-dashed border-primary/50 rounded-lg p-6 cursor-pointer transition-all hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center text-center min-h-48"
              >
                <FontAwesomeIcon icon={faPlus} className="w-8 h-8 text-primary mb-3" />
                <h3 className="font-semibold text-base-content mb-2">Create New Project</h3>
                <p className="text-sm text-base-content/60">
                  Start a new project to organize your AI conversations
                </p>
              </div>
            )}
            
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

      {/* Edit Project Modal */}
      {editingProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Edit Project: {editingProject.name}</h3>
              <button
                onClick={handleCancelEdit}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditProject} className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
                {/* Basic Information */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Project Name *</span>
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="Enter project name"
                      required
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Description</span>
                    </label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                {/* Working Directory */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Working Directory *</span>
                  </label>
                  <input
                    type="text"
                    value={editWorkingDirectory}
                    onChange={(e) => setEditWorkingDirectory(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="/path/to/project"
                    required
                  />
                </div>

                {/* Default Provider and Model Configuration */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Default Provider</span>
                    </label>
                    <select
                      value={editConfig.provider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        const providerModels = providers.find(p => p.type === newProvider)?.models || [];
                        setEditConfig(prev => ({
                          ...prev,
                          provider: newProvider,
                          model: providerModels[0]?.name || prev.model,
                        }));
                      }}
                      className="select select-bordered w-full"
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider.type} value={provider.type}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Default Model</span>
                    </label>
                    <select
                      value={editConfig.model}
                      onChange={(e) => setEditConfig(prev => ({ ...prev, model: e.target.value }))}
                      className="select select-bordered w-full"
                    >
                      {availableModels.map((model) => (
                        <option key={model.name} value={model.name}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Max Tokens</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200000"
                      value={editConfig.maxTokens}
                      onChange={(e) => setEditConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 4096 }))}
                      className="input input-bordered w-full"
                    />
                  </div>
                </div>

                {/* Environment Variables */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Environment Variables</span>
                  </label>
                  <div className="space-y-2">
                    {Object.entries(editConfig.environmentVariables || {}).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={key}
                          className="input input-bordered input-sm flex-1"
                          readOnly
                        />
                        <span className="text-base-content/60">=</span>
                        <input
                          type="text"
                          value={value}
                          className="input input-bordered input-sm flex-1"
                          readOnly
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvironmentVariable(key)}
                          className="btn btn-error btn-sm btn-square"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newEnvKey}
                        onChange={(e) => setNewEnvKey(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        placeholder="Key"
                      />
                      <span className="text-base-content/60">=</span>
                      <input
                        type="text"
                        value={newEnvValue}
                        onChange={(e) => setNewEnvValue(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        placeholder="Value"
                      />
                      <button
                        type="button"
                        onClick={handleAddEnvironmentVariable}
                        className="btn btn-primary btn-sm"
                        disabled={!newEnvKey.trim() || !newEnvValue.trim()}
                      >
                        <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tool Access Policies */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Tool Access Policies</span>
                  </label>
                  <div className="grid md:grid-cols-2 gap-3">
                    {AVAILABLE_TOOLS.map((tool) => (
                      <div key={tool} className="flex items-center justify-between p-3 border border-base-300 rounded-lg">
                        <span className="font-medium text-sm">{tool}</span>
                        <select
                          value={editConfig.toolPolicies?.[tool] || 'require-approval'}
                          onChange={(e) => handleToolPolicyChange(tool, e.target.value as 'allow' | 'require-approval' | 'deny')}
                          className="select select-bordered select-sm w-40"
                        >
                          <option value="allow">Allow</option>
                          <option value="require-approval">Require Approval</option>
                          <option value="deny">Deny</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-base-300">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!editName.trim() || !editWorkingDirectory.trim() || loading}
                >
                  {loading ? (
                    <>
                      <div className="loading loading-spinner loading-sm"></div>
                      Updating...
                    </>
                  ) : (
                    'Update Project'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}