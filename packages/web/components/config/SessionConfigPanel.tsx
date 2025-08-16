// ABOUTME: Comprehensive session configuration panel for main pane
// ABOUTME: Handles session creation/editing with full configuration options

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faCog, faRobot, faFolder, faInfoCircle, faTrash, faEdit } from '@/lib/fontawesome';
import { ModelSelectionForm } from './ModelSelectionForm';
import { ModelDropdown } from '@/components/config/ModelDropdown';
import { SessionHeader } from './SessionHeader';
import { SessionsList } from './SessionsList';
import { SessionCreateModal } from './SessionCreateModal';
import type { ProviderInfo, ModelInfo, CreateAgentRequest } from '@/types/api';
import type { SessionInfo, ProjectInfo } from '@/types/core';
import { parseResponse } from '@/lib/serialization';
import { useProjectContext } from '@/components/providers/ProjectProvider';
import { useSessionContext } from '@/components/providers/SessionProvider';
import { useAgentContext } from '@/components/providers/AgentProvider';
import { useAppState } from '@/components/providers/AppStateProvider';
import { useProviders } from '@/hooks/useProviders';

interface SessionConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, 'allow' | 'require-approval' | 'deny'>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

interface SessionConfigPanelProps {
  // No props needed - all data comes from providers
}

const AVAILABLE_TOOLS = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_find',
  'url_fetch',
  'ripgrep_search',
  'file_insert',
  'delegate',
  'task_add',
  'task_list',
  'task_complete',
  'task_update',
  'task_add_note',
  'task_view',
];

const DEFAULT_CONFIG: SessionConfiguration = {
  // Note: providerInstanceId and modelId should be set by user selection, not defaults
  maxTokens: 4096,
  tools: AVAILABLE_TOOLS,
  toolPolicies: {},
  environmentVariables: {},
};

export function SessionConfigPanel({}: SessionConfigPanelProps) {
  // Get data from providers instead of props
  const { currentProject } = useProjectContext();
  const { sessions, projectConfig, createSession, loading: sessionLoading } = useSessionContext();
  const {
    sessionDetails: selectedSession,
    createAgent,
    reloadSessionDetails,
    loading: agentLoading,
  } = useAgentContext();
  const {
    actions: { updateHashState },
  } = useAppState();
  const { providers, loading: providersLoading } = useProviders();

  const loading = sessionLoading || agentLoading || providersLoading;
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [showEditConfig, setShowEditConfig] = useState(false);
  const [showEditAgent, setShowEditAgent] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{
    threadId: string;
    name: string;
    providerInstanceId: string;
    modelId: string;
  } | null>(null);

  // Session creation state
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionDescription, setNewSessionDescription] = useState('');
  const [sessionConfig, setSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);

  // Agent creation state
  const [newAgentName, setNewAgentName] = useState('');
  const [selectedInstanceId, setSelectedInstanceId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  // Session edit state
  const [editSessionName, setEditSessionName] = useState('');
  const [editSessionDescription, setEditSessionDescription] = useState('');
  const [editSessionConfig, setEditSessionConfig] = useState<SessionConfiguration>(DEFAULT_CONFIG);
  const [editNewEnvKey, setEditNewEnvKey] = useState('');
  const [editNewEnvValue, setEditNewEnvValue] = useState('');

  // Get available providers (only those that are configured with instance IDs)
  const availableProviders = useMemo(() => {
    return providers.filter((p): p is ProviderInfo & { instanceId: string } =>
      Boolean(p.configured && p.instanceId)
    );
  }, [providers]);

  // Reset form when project or project configuration changes
  const projectId = currentProject.id;
  useEffect(() => {
    setShowCreateSession(false);
    setShowCreateAgent(false);
    setShowEditConfig(false);
    setShowEditAgent(false);
    setEditingAgent(null);
    resetSessionForm();
    resetAgentForm();
    resetEditSessionForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projectConfig]);

  const resetSessionForm = useCallback(() => {
    setNewSessionName('');
    setNewSessionDescription('');
    // Use project configuration as defaults if available
    const defaultConfig = { ...DEFAULT_CONFIG };
    if (projectConfig) {
      if (projectConfig.providerInstanceId) {
        defaultConfig.providerInstanceId = projectConfig.providerInstanceId as string;
      }
      if (projectConfig.modelId) {
        defaultConfig.modelId = projectConfig.modelId as string;
      }
      if (projectConfig.workingDirectory) {
        defaultConfig.workingDirectory = projectConfig.workingDirectory as string;
      }
      if (projectConfig.environmentVariables) {
        defaultConfig.environmentVariables = projectConfig.environmentVariables as Record<
          string,
          string
        >;
      }
      if (projectConfig.toolPolicies) {
        defaultConfig.toolPolicies = projectConfig.toolPolicies as Record<
          string,
          'allow' | 'require-approval' | 'deny'
        >;
      }
    }
    setSessionConfig(defaultConfig);
  }, [projectConfig]);

  const resetAgentForm = () => {
    setNewAgentName('');
    setSelectedInstanceId('');
    setSelectedModelId('');
  };

  const resetEditSessionForm = () => {
    setEditSessionName('');
    setEditSessionDescription('');
    setEditSessionConfig(DEFAULT_CONFIG);
    setEditNewEnvKey('');
    setEditNewEnvValue('');
  };

  const handleProviderInstanceSelection = (instanceId: string, modelId: string) => {
    setSelectedInstanceId(instanceId);
    setSelectedModelId(modelId);
  };

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionName.trim()) return;

    createSession({
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

    // All agents now require provider instances - no fallback to legacy system
    if (!selectedInstanceId || !selectedModelId) {
      // Should not happen with proper UI validation
      console.error('Cannot create agent without provider instance and model selection');
      return;
    }

    createAgent(selectedSession.id, {
      name: newAgentName.trim(),
      providerInstanceId: selectedInstanceId,
      modelId: selectedModelId,
    });

    resetAgentForm();
    setShowCreateAgent(false);
  };

  // Handle session edit
  const handleEditSessionClick = async () => {
    if (!selectedSession) return;

    try {
      // Load session configuration from API
      const res = await fetch(`/api/sessions/${selectedSession.id}/configuration`);

      if (res.ok) {
        const data = await parseResponse<{ configuration: SessionConfiguration }>(res);
        setEditSessionName(selectedSession.name);
        setEditSessionDescription(''); // Session descriptions not currently stored

        // Merge with defaults and ensure provider instance is set
        const config = {
          ...DEFAULT_CONFIG,
          ...data.configuration,
        };

        // If no provider instance configured, use first available
        if (!config.providerInstanceId && availableProviders.length > 0) {
          config.providerInstanceId = availableProviders[0].instanceId;
          config.modelId = availableProviders[0].models[0]?.id || '';
        }

        setEditSessionConfig(config);
        setShowEditConfig(true);
      } else {
        // Fallback to default configuration with first available provider
        const config = { ...DEFAULT_CONFIG };
        if (availableProviders.length > 0) {
          config.providerInstanceId = availableProviders[0].instanceId;
          config.modelId = availableProviders[0].models[0]?.id || '';
        }
        setEditSessionName(selectedSession.name);
        setEditSessionDescription('');
        setEditSessionConfig(config);
        setShowEditConfig(true);
      }
    } catch (error) {
      console.error('Error loading session configuration:', error);
      // Fallback to default configuration with first available provider
      const config = { ...DEFAULT_CONFIG };
      if (availableProviders.length > 0) {
        config.providerInstanceId = availableProviders[0].instanceId;
        config.modelId = availableProviders[0].models[0]?.id || '';
      }
      setEditSessionName(selectedSession.name);
      setEditSessionDescription('');
      setEditSessionConfig(config);
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
          const errorData = await parseResponse<{ error: string }>(sessionRes);
          console.error('Failed to update session name/description:', errorData.error);
        }
      }

      if (configRes.ok) {
        // Trigger local state update by reloading session details
        await reloadSessionDetails();

        setShowEditConfig(false);
        resetEditSessionForm();
      } else {
        const errorData = await parseResponse<{ error: string }>(configRes);
        console.error('Failed to update session configuration:', errorData.error);
      }
    } catch (error) {
      console.error('Error updating session:', error);
    }
  };

  // Handle edit session environment variables
  const handleAddEditEnvironmentVariable = () => {
    if (!editNewEnvKey.trim() || !editNewEnvValue.trim()) return;

    setEditSessionConfig((prev) => ({
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
    setEditSessionConfig((prev) => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  const handleEditToolPolicyChange = (
    tool: string,
    policy: 'allow' | 'require-approval' | 'deny'
  ) => {
    setEditSessionConfig((prev) => ({
      ...prev,
      toolPolicies: {
        ...prev.toolPolicies,
        [tool]: policy,
      },
    }));
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
          providerInstanceId: editingAgent.providerInstanceId,
          modelId: editingAgent.modelId,
        }),
      });

      if (res.ok) {
        // Trigger a refresh by reloading session details
        await reloadSessionDetails();
        setShowEditAgent(false);
        setEditingAgent(null);
      } else {
        const errorData = await parseResponse<{ error: string }>(res);
        console.error('Failed to update agent:', errorData.error);
      }
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  };

  // Callback functions for SessionsList
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      updateHashState({ session: sessionId });
    },
    [updateHashState]
  );

  const handleCreateSessionClick = useCallback(() => {
    resetSessionForm(); // Reset with project defaults
    setShowCreateSession(true);
  }, [resetSessionForm]);

  const handleAgentSelect = useCallback(
    (agentId: string) => {
      updateHashState({ agent: agentId });
    },
    [updateHashState]
  );

  const handleCreateAgentClick = useCallback(() => {
    setShowCreateAgent(true);
  }, []);

  const handleEditAgentClick = useCallback(
    async (agent: { threadId: string; name: string; status: string }) => {
      try {
        // Fetch agent's actual configuration
        const res = await fetch(`/api/agents/${agent.threadId}`);
        if (!res.ok) {
          console.error('Failed to fetch agent configuration');
          return;
        }

        const agentDetails = await parseResponse<{
          name: string;
          providerInstanceId: string;
          modelId: string;
        }>(res);

        setEditingAgent({
          threadId: agent.threadId,
          name: agentDetails.name,
          providerInstanceId: agentDetails.providerInstanceId,
          modelId: agentDetails.modelId,
        });
        setShowEditAgent(true);
      } catch (error) {
        console.error('Failed to load agent for editing:', error);
      }
    },
    []
  );

  // Session creation modal handlers
  const handleSessionNameChange = useCallback((name: string) => {
    setNewSessionName(name);
  }, []);

  const handleSessionDescriptionChange = useCallback((description: string) => {
    setNewSessionDescription(description);
  }, []);

  const handleSessionConfigChange = useCallback((config: SessionConfiguration) => {
    setSessionConfig(config);
  }, []);

  const handleCloseCreateSession = useCallback(() => {
    setShowCreateSession(false);
  }, []);

  return (
    <div className="bg-base-100 rounded-lg border border-base-300 p-6">
      <SessionHeader project={currentProject} />

      <SessionsList
        sessions={sessions}
        selectedSession={selectedSession}
        loading={loading}
        onSessionSelect={handleSessionSelect}
        onEditSession={handleEditSessionClick}
        onCreateAgent={handleCreateAgentClick}
        onCreateSession={handleCreateSessionClick}
        onEditAgent={handleEditAgentClick}
        onAgentSelect={handleAgentSelect}
      />

      <SessionCreateModal
        isOpen={showCreateSession}
        currentProject={currentProject}
        providers={providers}
        sessionConfig={sessionConfig}
        sessionName={newSessionName}
        sessionDescription={newSessionDescription}
        loading={loading}
        onClose={handleCloseCreateSession}
        onSubmit={handleCreateSession}
        onSessionNameChange={handleSessionNameChange}
        onSessionDescriptionChange={handleSessionDescriptionChange}
        onSessionConfigChange={handleSessionConfigChange}
      />

      {/* Create Agent Modal */}
      {showCreateAgent && selectedSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Launch Agent in {selectedSession.name}</h3>
              <button onClick={() => setShowCreateAgent(false)} className="btn btn-ghost btn-sm">
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

              {/* Provider Instance Selection Toggle */}
              <ModelSelectionForm
                providers={providers}
                providerInstanceId={selectedInstanceId}
                modelId={selectedModelId}
                onProviderChange={setSelectedInstanceId}
                onModelChange={setSelectedModelId}
                className="mb-4"
              />

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
                  disabled={
                    !newAgentName.trim() || loading || !selectedInstanceId || !selectedModelId
                  }
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
              <button onClick={() => setShowEditConfig(false)} className="btn btn-ghost btn-sm">
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

                {/* Provider and Model Selection */}
                <ModelSelectionForm
                  providers={providers}
                  providerInstanceId={editSessionConfig.providerInstanceId}
                  modelId={editSessionConfig.modelId}
                  onProviderChange={(instanceId) =>
                    setEditSessionConfig((prev) => ({ ...prev, providerInstanceId: instanceId }))
                  }
                  onModelChange={(modelId) =>
                    setEditSessionConfig((prev) => ({ ...prev, modelId }))
                  }
                />

                {/* Working Directory */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Working Directory</span>
                  </label>
                  <input
                    type="text"
                    value={editSessionConfig.workingDirectory || currentProject.workingDirectory}
                    onChange={(e) =>
                      setEditSessionConfig((prev) => ({
                        ...prev,
                        workingDirectory: e.target.value,
                      }))
                    }
                    className="input input-bordered w-full"
                    placeholder={currentProject.workingDirectory}
                  />
                </div>

                {/* Environment Variables */}
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Environment Variables</span>
                  </label>
                  <div className="space-y-2">
                    {Object.entries(editSessionConfig.environmentVariables || {}).map(
                      ([key, value]) => (
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
                      )
                    )}
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
                      <div
                        key={tool}
                        className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                      >
                        <span className="font-medium text-sm">{tool}</span>
                        <select
                          value={editSessionConfig.toolPolicies?.[tool] || 'require-approval'}
                          onChange={(e) =>
                            handleEditToolPolicyChange(
                              tool,
                              e.target.value as 'allow' | 'require-approval' | 'deny'
                            )
                          }
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
              <button onClick={() => setShowEditAgent(false)} className="btn btn-ghost btn-sm">
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
                  onChange={(e) =>
                    setEditingAgent((prev) => (prev ? { ...prev, name: e.target.value } : null))
                  }
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
                  value={editingAgent.providerInstanceId}
                  onChange={(e) => {
                    const newInstanceId = e.target.value;
                    const provider = providers.find((p) => p.instanceId === newInstanceId);
                    const providerModels = provider?.models || [];
                    setEditingAgent((prev) =>
                      prev
                        ? {
                            ...prev,
                            providerInstanceId: newInstanceId,
                            modelId: providerModels[0]?.id || prev.modelId,
                          }
                        : null
                    );
                  }}
                  className="select select-bordered w-full"
                >
                  {availableProviders.map((provider) => (
                    <option key={provider.instanceId} value={provider.instanceId}>
                      {provider.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">
                  <span className="label-text font-medium">Model</span>
                </label>
                <select
                  value={editingAgent.modelId}
                  onChange={(e) =>
                    setEditingAgent((prev) => (prev ? { ...prev, modelId: e.target.value } : null))
                  }
                  className="select select-bordered w-full"
                >
                  {providers
                    .find((p) => p.instanceId === editingAgent.providerInstanceId)
                    ?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    )) || []}
                </select>
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
