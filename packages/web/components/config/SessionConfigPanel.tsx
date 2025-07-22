// ABOUTME: Comprehensive session configuration panel for main pane
// ABOUTME: Handles session creation/editing with full configuration options

'use client';

import { useState, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faCog, faRobot, faFolder, faInfoCircle, faTrash, faEdit } from '@/lib/fontawesome';
import { ModelDropdown } from './ModelDropdown';
import { ProviderDropdown } from './ProviderDropdown';
import type { 
  Session, 
  ProjectInfo, 
  ProviderInfo, 
  ModelInfo, 
  CreateAgentRequest 
} from '@/types/api';

interface SessionConfiguration {
  provider?: string;
  model?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
}

interface SessionConfigPanelProps {
  selectedProject: ProjectInfo;
  sessions: Session[];
  selectedSession: Session | null;
  providers: ProviderInfo[];
  onSessionCreate: (sessionData: { name: string; description?: string; configuration?: SessionConfiguration }) => void;
  onSessionSelect: (session: Session) => void;
  onAgentCreate: (sessionId: string, agentData: CreateAgentRequest) => void;
  onAgentSelect?: (agentId: string) => void;
  onAgentUpdate?: () => void | Promise<void>;
  onSessionUpdate?: (sessionId: string, updates: Partial<Session & { configuration?: SessionConfiguration }>) => void;
  loading?: boolean;
}

const DEFAULT_CONFIG: SessionConfiguration = {
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  maxTokens: 4096,
  tools: [],
  toolPolicies: {},
  environmentVariables: {},
};

const AVAILABLE_TOOLS = [
  'bash', 'file-read', 'file-write', 'file-edit', 'file-list', 
  'file-find', 'url-fetch', 'task-manager', 'delegate'
];

export function SessionConfigPanel({
  selectedProject,
  sessions,
  selectedSession,
  providers,
  onSessionCreate,
  onSessionSelect,
  onAgentCreate,
  onAgentSelect,
  onAgentUpdate,
  onSessionUpdate,
  loading = false,
}: SessionConfigPanelProps) {
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{ threadId: string; name: string; provider: string; model: string } | null>(null);
  
  // Session creation state
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionDescription, setNewSessionDescription] = useState('');
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);
  
  // Agent creation state  
  const [newAgentName, setNewAgentName] = useState('');
  const [agentProvider, setAgentProvider] = useState('anthropic');
  const [agentModel, setAgentModel] = useState('claude-3-sonnet-20241022');

  // Environment variables helper state
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  
  // Session edit state
  const [editSessionName, setEditSessionName] = useState('');
  const [editSessionDescription, setEditSessionDescription] = useState('');
  const [editSessionConfig, setEditSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);
  const [editNewEnvKey, setEditNewEnvKey] = useState('');
  const [editNewEnvValue, setEditNewEnvValue] = useState('');


  // Get available providers (only those that are configured)
  const availableProviders = useMemo(() => {
    return providers.filter(p => p.configured);
  }, [providers]);

  // Reset form when project changes
  useEffect(() => {
    setShowCreateSession(false);
    setShowCreateAgent(false);
    setShowEditConfig(false);
    setShowEditAgent(false);
    setEditingAgent(null);
    resetSessionForm();
    resetAgentForm();
    resetEditSessionForm();
  }, [selectedProject.id]);

  const resetSessionForm = () => {
    setNewSessionName('');
    setNewSessionDescription('');
    setSessionConfig(DEFAULT_CONFIG);
    setNewEnvKey('');
    setNewEnvValue('');
  };

  const resetAgentForm = () => {
    setNewAgentName('');
    setAgentProvider('anthropic');
    setAgentModel('claude-3-sonnet-20241022');
  };

  const resetEditSessionForm = () => {
    setEditSessionName('');
    setEditSessionDescription('');
    setEditSessionConfig(DEFAULT_CONFIG);
    setEditNewEnvKey('');
    setEditNewEnvValue('');
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;

    onSessionCreate({
      name: newSessionName.trim(),
      description: newSessionDescription.trim() || undefined,
      configuration: sessionConfig,
    });

    resetSessionForm();
    setShowCreateSession(false);
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || !selectedSession) return;

    onAgentCreate(selectedSession.id, {
      name: newAgentName.trim(),
      provider: agentProvider,
      model: agentModel,
    });

    resetAgentForm();
    setShowCreateAgent(false);
  };

  const handleAddEnvironmentVariable = () => {
    if (!newEnvKey.trim() || !newEnvValue.trim()) return;

    setSessionConfig(prev => ({
      ...prev,
      environmentVariables: {
        ...prev.environmentVariables,
        [newEnvKey.trim()]: newEnvValue.trim(),
      },
    }));

    setNewEnvKey('');
    setNewEnvValue('');
  };

  const handleRemoveEnvironmentVariable = (key: string) => {
    setSessionConfig(prev => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  const handleToolPolicyChange = (tool: string, policy: 'allow' | 'require-approval' | 'deny') => {
    setSessionConfig(prev => ({
      ...prev,
      toolPolicies: {
        ...prev.toolPolicies,
        [tool]: policy,
      },
    }));
  };

  // Handle session edit
  const handleEditSessionClick = async () => {
    if (!selectedSession) return;
    
    try {
      // Load session configuration from API
      const res = await fetch(`/api/sessions/${selectedSession.id}/configuration`);
      
      if (res.ok) {
        const data = await res.json() as { configuration: SessionConfiguration };
        setEditSessionName(selectedSession.name);
        setEditSessionDescription(''); // Session descriptions not currently stored
        setEditSessionConfig(data.configuration);
        setShowEditConfig(true);
      } else {
        console.error('Failed to load session configuration');
        // Fallback to default configuration
        setEditSessionName(selectedSession.name);
        setEditSessionDescription('');
        setEditSessionConfig(DEFAULT_CONFIG);
        setShowEditConfig(true);
      }
    } catch (error) {
      console.error('Error loading session configuration:', error);
      // Fallback to default configuration
      setEditSessionName(selectedSession.name);
      setEditSessionDescription('');
      setEditSessionConfig(DEFAULT_CONFIG);
      setShowEditConfig(true);
    }
  };

  const handleEditSessionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSession || !editSessionName.trim()) return;

    try {
      // Update session configuration via API
      const configRes = await fetch(`/api/sessions/${selectedSession.id}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editSessionConfig),
      });

      // Update session name/description if changed via PATCH endpoint
      const nameChanged = editSessionName.trim() !== selectedSession.name;
      const descChanged = (editSessionDescription.trim() || undefined) !== undefined;
      
      if (nameChanged || descChanged) {
        const sessionRes = await fetch(`/api/sessions/${selectedSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editSessionName.trim(),
            description: editSessionDescription.trim() || undefined,
          }),
        });

        if (!sessionRes.ok) {
          const errorData = await sessionRes.json() as { error: string };
          console.error('Failed to update session name/description:', errorData.error);
        }
      }

      if (configRes.ok) {
        // Trigger local state update if callback is available
        if (onSessionUpdate) {
          onSessionUpdate(selectedSession.id, {
            name: editSessionName.trim(),
            configuration: editSessionConfig,
          });
        }
        
        setShowEditConfig(false);
        resetEditSessionForm();
      } else {
        const errorData = await configRes.json() as { error: string };
        console.error('Failed to update session configuration:', errorData.error);
      }
    } catch (error) {
      console.error('Error updating session:', error);
    }
  };

  // Handle edit session environment variables
  const handleAddEditEnvironmentVariable = () => {
    if (!editNewEnvKey.trim() || !editNewEnvValue.trim()) return;

    setEditSessionConfig(prev => ({
      ...prev,
      environmentVariables: {
        ...prev.environmentVariables,
        [editNewEnvKey.trim()]: editNewEnvValue.trim(),
      },
    }));

    setEditNewEnvKey('');
    setEditNewEnvValue('');
  };

  const handleRemoveEditEnvironmentVariable = (key: string) => {
    setEditSessionConfig(prev => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  const handleEditToolPolicyChange = (tool: string, policy: 'allow' | 'require-approval' | 'deny') => {
    setEditSessionConfig(prev => ({
      ...prev,
      toolPolicies: {
        ...prev.toolPolicies,
        [tool]: policy,
      },
    }));
  };

  // Handle agent edit
  const handleEditAgentClick = (agent: { threadId: string; name: string; provider: string; model: string }) => {
    setEditingAgent(agent);
    setShowEditAgent(true);
  };

  const handleEditAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent || !editingAgent.name.trim()) return;

    try {
      const res = await fetch(`/api/agents/${editingAgent.threadId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingAgent.name.trim(),
          provider: editingAgent.provider,
          model: editingAgent.model,
        }),
      });

      if (res.ok) {
        // Trigger a refresh by calling parent's agent update handler to reload session data
        if (onAgentUpdate) {
          await onAgentUpdate();
        }
        setShowEditAgent(false);
        setEditingAgent(null);
      } else {
        const errorData = await res.json() as { error: string };
        console.error('Failed to update agent:', errorData.error);
      }
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  };

  return (
    <div className="bg-base-100 rounded-lg border border-base-300 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FontAwesomeIcon icon={faFolder} className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold text-base-content">{selectedProject.name}</h2>
            <p className="text-sm text-base-content/60">{selectedProject.description}</p>
          </div>
        </div>
        
      </div>

      {/* Sessions List */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-base-content flex items-center gap-2">
          <FontAwesomeIcon icon={faRobot} className="w-4 h-4" />
          Sessions ({sessions.length})
        </h3>

        {sessions.length === 0 ? (
          <div className="text-center py-8 text-base-content/60">
            <FontAwesomeIcon icon={faRobot} className="w-12 h-12 text-base-content/20 mb-3" />
            <p>No sessions yet</p>
            <p className="text-sm">Create your first session to get started</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sessions
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((session) => (
              <div
                key={session.id}
                className={`border rounded-lg p-4 cursor-pointer transition-all hover:shadow-md ${
                  selectedSession?.id === session.id
                    ? 'border-primary bg-primary/5'
                    : 'border-base-300 hover:border-primary/50'
                }`}
                onClick={() => onSessionSelect(session)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-base-content">{session.name}</h4>
                    <div className="flex items-center gap-4 mt-2 text-sm text-base-content/60">
                      <span>Created {new Date(session.createdAt).toLocaleDateString()}</span>
                      <span>{session.agentCount || 0} agents</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    {selectedSession?.id === session.id && (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditSessionClick();
                          }}
                          className="btn btn-ghost btn-xs"
                          title="Edit Session"
                        >
                          <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowCreateAgent(true);
                          }}
                          className="btn btn-primary btn-xs"
                          title="Launch Agent"
                        >
                          <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Agents List */}
                {selectedSession?.id === session.id && selectedSession.agents && selectedSession.agents.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-base-300">
                    <div className="grid gap-2">
                      {selectedSession.agents.map((agent) => (
                        <div
                          key={agent.threadId}
                          className="flex items-center justify-between p-2 bg-base-50 rounded border border-base-200 cursor-pointer hover:bg-base-100 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAgentSelect?.(agent.threadId);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <FontAwesomeIcon icon={faRobot} className="w-3 h-3 text-primary" />
                            <span className="text-sm font-medium">{agent.name}</span>
                            <span className="text-xs text-base-content/60">
                              {agent.provider} • {agent.model}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditAgentClick(agent);
                              }}
                              className="btn btn-ghost btn-xs opacity-60 hover:opacity-100"
                              title="Edit Agent"
                            >
                              <FontAwesomeIcon icon={faEdit} className="w-3 h-3" />
                            </button>
                            <span className={`badge badge-xs ${
                              agent.status === 'idle' ? 'badge-success' :
                              (agent.status === 'streaming' || agent.status === 'thinking' || agent.status === 'tool_execution') ? 'badge-warning' :
                              'badge-neutral'
                            }`}>
                              {agent.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* New Session Button - moved to bottom */}
        <button
          onClick={() => setShowCreateSession(true)}
          className="btn btn-primary btn-sm w-full"
          disabled={loading}
        >
          <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* Create Session Modal */}
      {showCreateSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Create New Session</h3>
              <button
                onClick={() => setShowCreateSession(false)}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
                {/* Basic Information */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Session Name *</span>
                    </label>
                    <input
                      type="text"
                      value={newSessionName}
                      onChange={(e) => setNewSessionName(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="e.g., Backend API Development"
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
                      value={newSessionDescription}
                      onChange={(e) => setNewSessionDescription(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                {/* Provider and Model Configuration */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Default Provider</span>
                    </label>
                    <select
                      value={sessionConfig.provider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        const providerModels = providers.find(p => p.name === newProvider)?.models || [];
                        setSessionConfig(prev => ({
                          ...prev,
                          provider: newProvider,
                          model: providerModels[0]?.id || prev.model,
                        }));
                      }}
                      className="select select-bordered w-full"
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider.name} value={provider.name}>
                          {provider.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <ModelDropdown
                      providers={providers}
                      selectedProvider={sessionConfig.provider || ''}
                      selectedModel={sessionConfig.model || ''}
                      onChange={(model) => setSessionConfig(prev => ({ ...prev, model }))}
                      label="Default Model"
                    />
                  </div>

                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Max Tokens</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200000"
                      value={sessionConfig.maxTokens}
                      onChange={(e) => setSessionConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 4096 }))}
                      className="input input-bordered w-full"
                    />
                  </div>
                </div>

                {/* Working Directory */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Working Directory</span>
                  </label>
                  <input
                    type="text"
                    value={sessionConfig.workingDirectory || selectedProject.workingDirectory}
                    onChange={(e) => setSessionConfig(prev => ({ ...prev, workingDirectory: e.target.value }))}
                    className="input input-bordered w-full"
                    placeholder={selectedProject.workingDirectory}
                  />
                </div>

                {/* Environment Variables */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Environment Variables</span>
                  </label>
                  <div className="space-y-2">
                    {Object.entries(sessionConfig.environmentVariables || {}).map(([key, value]) => (
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

                {/* Tool Configuration */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Tool Access Policies</span>
                  </label>
                  <div className="grid md:grid-cols-2 gap-3">
                    {AVAILABLE_TOOLS.map((tool) => (
                      <div key={tool} className="flex items-center justify-between p-3 border border-base-300 rounded-lg">
                        <span className="font-medium text-sm">{tool}</span>
                        <select
                          value={sessionConfig.toolPolicies?.[tool] || 'require-approval'}
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
                  onClick={() => setShowCreateSession(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newSessionName.trim() || loading}
                >
                  {loading ? (
                    <>
                      <div className="loading loading-spinner loading-sm"></div>
                      Creating...
                    </>
                  ) : (
                    'Create Session'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Agent Modal */}
      {showCreateAgent && selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Launch Agent in {selectedSession.name}</h3>
              <button
                onClick={() => setShowCreateAgent(false)}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAgent} className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-medium">Agent Name *</span>
                </label>
                <input
                  type="text"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  className="input input-bordered w-full"
                  placeholder="e.g., Code Reviewer"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Provider</span>
                </label>
                <select
                  value={agentProvider}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    const providerModels = providers.find(p => p.name === newProvider)?.models || [];
                    setAgentProvider(newProvider);
                    setAgentModel(providerModels[0]?.id || agentModel);
                  }}
                  className="select select-bordered w-full"
                >
                  {availableProviders.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <ModelDropdown
                  providers={providers}
                  selectedProvider={agentProvider}
                  selectedModel={agentModel}
                  onChange={setAgentModel}
                  label="Model"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateAgent(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!newAgentName.trim() || loading}
                >
                  {loading ? (
                    <>
                      <div className="loading loading-spinner loading-sm"></div>
                      Launching...
                    </>
                  ) : (
                    'Launch Agent'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Session Configuration Modal */}
      {showEditConfig && selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Edit Session: {selectedSession.name}</h3>
              <button
                onClick={() => setShowEditConfig(false)}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditSessionSubmit} className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
                {/* Basic Information */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Session Name *</span>
                    </label>
                    <input
                      type="text"
                      value={editSessionName}
                      onChange={(e) => setEditSessionName(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="e.g., Backend API Development"
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
                      value={editSessionDescription}
                      onChange={(e) => setEditSessionDescription(e.target.value)}
                      className="input input-bordered w-full"
                      placeholder="Optional description"
                    />
                  </div>
                </div>

                {/* Provider and Model Configuration */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Default Provider</span>
                    </label>
                    <select
                      value={editSessionConfig.provider}
                      onChange={(e) => {
                        const newProvider = e.target.value;
                        const providerModels = providers.find(p => p.name === newProvider)?.models || [];
                        setEditSessionConfig(prev => ({
                          ...prev,
                          provider: newProvider,
                          model: providerModels[0]?.id || prev.model,
                        }));
                      }}
                      className="select select-bordered w-full"
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider.name} value={provider.name}>
                          {provider.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <ModelDropdown
                      providers={providers}
                      selectedProvider={editSessionConfig.provider || ''}
                      selectedModel={editSessionConfig.model || ''}
                      onChange={(model) => setEditSessionConfig(prev => ({ ...prev, model }))}
                      label="Default Model"
                    />
                  </div>

                  <div>
                    <label className="label">
                      <span className="label-text font-medium">Max Tokens</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="200000"
                      value={editSessionConfig.maxTokens}
                      onChange={(e) => setEditSessionConfig(prev => ({ ...prev, maxTokens: parseInt(e.target.value) || 4096 }))}
                      className="input input-bordered w-full"
                    />
                  </div>
                </div>

                {/* Working Directory */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Working Directory</span>
                  </label>
                  <input
                    type="text"
                    value={editSessionConfig.workingDirectory || selectedProject.workingDirectory}
                    onChange={(e) => setEditSessionConfig(prev => ({ ...prev, workingDirectory: e.target.value }))}
                    className="input input-bordered w-full"
                    placeholder={selectedProject.workingDirectory}
                  />
                </div>

                {/* Environment Variables */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Environment Variables</span>
                  </label>
                  <div className="space-y-2">
                    {Object.entries(editSessionConfig.environmentVariables || {}).map(([key, value]) => (
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
                          onClick={() => handleRemoveEditEnvironmentVariable(key)}
                          className="btn btn-error btn-sm btn-square"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editNewEnvKey}
                        onChange={(e) => setEditNewEnvKey(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        placeholder="Key"
                      />
                      <span className="text-base-content/60">=</span>
                      <input
                        type="text"
                        value={editNewEnvValue}
                        onChange={(e) => setEditNewEnvValue(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        placeholder="Value"
                      />
                      <button
                        type="button"
                        onClick={handleAddEditEnvironmentVariable}
                        className="btn btn-primary btn-sm"
                        disabled={!editNewEnvKey.trim() || !editNewEnvValue.trim()}
                      >
                        <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tool Configuration */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Tool Access Policies</span>
                  </label>
                  <div className="grid md:grid-cols-2 gap-3">
                    {AVAILABLE_TOOLS.map((tool) => (
                      <div key={tool} className="flex items-center justify-between p-3 border border-base-300 rounded-lg">
                        <span className="font-medium text-sm">{tool}</span>
                        <select
                          value={editSessionConfig.toolPolicies?.[tool] || 'require-approval'}
                          onChange={(e) => handleEditToolPolicyChange(tool, e.target.value as 'allow' | 'require-approval' | 'deny')}
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
                  onClick={() => setShowEditConfig(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!editSessionName.trim() || loading}
                >
                  {loading ? (
                    <>
                      <div className="loading loading-spinner loading-sm"></div>
                      Updating...
                    </>
                  ) : (
                    'Update Session'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Agent Modal */}
      {showEditAgent && editingAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Edit Agent: {editingAgent.name}</h3>
              <button
                onClick={() => setShowEditAgent(false)}
                className="btn btn-ghost btn-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEditAgentSubmit} className="space-y-4">
              <div>
                <label className="label">
                  <span className="label-text font-medium">Agent Name *</span>
                </label>
                <input
                  type="text"
                  value={editingAgent.name}
                  onChange={(e) => setEditingAgent(prev => prev ? { ...prev, name: e.target.value } : null)}
                  className="input input-bordered w-full"
                  placeholder="e.g., Code Reviewer"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Provider</span>
                </label>
                <select
                  value={editingAgent.provider}
                  onChange={(e) => {
                    const newProvider = e.target.value;
                    const providerModels = providers.find(p => p.name === newProvider)?.models || [];
                    setEditingAgent(prev => prev ? {
                      ...prev,
                      provider: newProvider,
                      model: providerModels[0]?.id || prev.model,
                    } : null);
                  }}
                  className="select select-bordered w-full"
                >
                  {availableProviders.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <ModelDropdown
                  providers={providers}
                  selectedProvider={editingAgent.provider}
                  selectedModel={editingAgent.model}
                  onChange={(model) => setEditingAgent(prev => prev ? { ...prev, model } : null)}
                  label="Model"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditAgent(false)}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!editingAgent.name.trim() || loading}
                >
                  {loading ? (
                    <>
                      <div className="loading loading-spinner loading-sm"></div>
                      Updating...
                    </>
                  ) : (
                    'Update Agent'
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