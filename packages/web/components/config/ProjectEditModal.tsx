// ABOUTME: Modal component for editing existing project configuration
// ABOUTME: Handles project editing form with provider/model selection, environment variables, and tool policies

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash, faServer } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { DirectoryField } from '@/components/ui';
import { ToolPolicyList } from '@/components/config/ToolPolicyList';
import { MCPProjectConfig } from '@/components/mcp/MCPProjectConfig';
import { AddMCPServerModal } from '@/components/modals/AddMCPServerModal';
import type { ProjectInfo, MCPServerConfig } from '@/types/core';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import type { ProviderInfo, SessionConfiguration } from '@/types/api';
import { api } from '@/lib/api-client';

interface ProjectConfiguration {
  providerInstanceId?: string;
  modelId?: string;
  maxTokens?: number;
  tools?: string[];
  toolPolicies?: Record<string, ToolPolicy>;
  workingDirectory?: string;
  environmentVariables?: Record<string, string>;
  [key: string]: unknown;
}

interface ProjectEditModalProps {
  isOpen: boolean;
  project: ProjectInfo | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (
    projectId: string,
    updates: {
      name: string;
      description?: string;
      workingDirectory: string;
      configuration: ProjectConfiguration;
    }
  ) => Promise<void>;
  initialConfig?: ProjectConfiguration;
}

export function ProjectEditModal({
  isOpen,
  project,
  loading,
  onClose,
  onSubmit,
  initialConfig = {},
}: ProjectEditModalProps) {
  // Get providers from ProviderInstanceProvider context
  const { availableProviders } = useProviderInstances();
  const [editName, setEditName] = useState(project?.name || '');
  const [editDescription, setEditDescription] = useState(project?.description || '');
  const [editWorkingDirectory, setEditWorkingDirectory] = useState(project?.workingDirectory || '');
  const [editConfig, setEditConfig] = useState<ProjectConfiguration>(initialConfig);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  // MCP modal state
  const [showMcpAddModal, setShowMcpAddModal] = useState(false);
  const [addingMcpServer, setAddingMcpServer] = useState(false);

  // Update state when project changes
  React.useEffect(() => {
    if (project) {
      setEditName(project.name);
      setEditDescription(project.description || '');
      setEditWorkingDirectory(project.workingDirectory);
    }
  }, [project]);

  React.useEffect(() => {
    setEditConfig(initialConfig);
  }, [initialConfig]);

  // Get available models for selected provider
  const availableModels = React.useMemo(() => {
    const provider = availableProviders.find((p) => p.instanceId === editConfig.providerInstanceId);
    return provider?.models || [];
  }, [availableProviders, editConfig.providerInstanceId]);

  // Handle environment variable addition
  const handleAddEnvironmentVariable = () => {
    if (!newEnvKey.trim() || !newEnvValue.trim()) return;

    setEditConfig((prev) => ({
      ...prev,
      environmentVariables: {
        ...(prev.environmentVariables ?? {}),
        [newEnvKey.trim()]: newEnvValue.trim(),
      },
    }));

    setNewEnvKey('');
    setNewEnvValue('');
  };

  // Handle environment variable removal
  const handleRemoveEnvironmentVariable = (key: string) => {
    setEditConfig((prev) => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  // Handle tool policy changes
  const handleToolPolicyChange = (tool: string, policy: ToolPolicy) => {
    setEditConfig((prev) => ({
      ...prev,
      toolPolicies: {
        ...(prev.toolPolicies ?? {}),
        [tool]: policy,
      },
    }));
  };

  // MCP server management
  const handleOpenMcpAddModal = () => {
    console.warn('[MCP Debug] Opening MCP add modal');
    setShowMcpAddModal(true);
  };

  const handleCloseMcpAddModal = () => {
    console.warn('[MCP Debug] Closing MCP add modal');
    setShowMcpAddModal(false);
  };

  const [mcpConfigKey, setMcpConfigKey] = useState(0); // Force reload

  const handleAddMcpServer = async (serverId: string, config: MCPServerConfig) => {
    setAddingMcpServer(true);
    try {
      await api.post(`/api/projects/${project?.id}/mcp/servers`, { id: serverId, ...config });
      setShowMcpAddModal(false);
      // Force reload of MCP configuration
      setMcpConfigKey((prev) => prev + 1);
    } catch (error) {
      // Error handling
    } finally {
      setAddingMcpServer(false);
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !editName.trim()) return;

    await onSubmit(project.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      workingDirectory: editWorkingDirectory.trim(),
      configuration: editConfig,
    });
    onClose();
  };

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Project: ${project.name}`}
      size="full"
      className="flex flex-col"
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        <div className="flex-1 overflow-y-auto px-1 space-y-6">
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
          <DirectoryField
            label="Working Directory *"
            value={editWorkingDirectory}
            onChange={setEditWorkingDirectory}
            placeholder="/path/to/project"
            required
          />

          {/* Default Provider and Model Configuration */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label">
                <span className="label-text font-medium">Default Provider</span>
              </label>
              <select
                value={editConfig.providerInstanceId || ''}
                onChange={(e) => {
                  const newInstanceId = e.target.value;
                  const provider = availableProviders.find((p) => p.instanceId === newInstanceId);
                  const providerModels = provider?.models || [];
                  setEditConfig((prev) => ({
                    ...prev,
                    providerInstanceId: newInstanceId,
                    modelId: providerModels[0]?.id || prev.modelId,
                  }));
                }}
                className="select select-bordered w-full"
              >
                {availableProviders.length === 0 ? (
                  <option value="">No providers available</option>
                ) : (
                  <>
                    {!editConfig.providerInstanceId && <option value="">Select a provider</option>}
                    {availableProviders.map((provider) => (
                      <option key={provider.instanceId} value={provider.instanceId}>
                        {provider.displayName}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="label">
                <span className="label-text font-medium">Default Model</span>
              </label>
              <select
                value={editConfig.modelId || ''}
                onChange={(e) => setEditConfig((prev) => ({ ...prev, modelId: e.target.value }))}
                className="select select-bordered w-full"
              >
                {availableModels.length === 0 ? (
                  <option value="">No models available</option>
                ) : (
                  <>
                    {!editConfig.modelId && <option value="">Select a model</option>}
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.displayName}
                      </option>
                    ))}
                  </>
                )}
              </select>
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

          {/* MCP Configuration */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <FontAwesomeIcon icon={faServer} className="w-5 h-5 text-primary" />
              <span className="text-lg font-medium">MCP Servers</span>
            </div>
            <div className="rounded-xl p-4 bg-base-100/60 backdrop-blur-sm border border-base-300/60">
              <MCPProjectConfig
                key={mcpConfigKey}
                projectId={project.id}
                onOpenAddModal={handleOpenMcpAddModal}
              />
            </div>
          </div>

          {/* Tool Access Policies */}
          <div>
            <label className="label">
              <span className="label-text font-medium">Tool Access Policies</span>
            </label>
            <ToolPolicyList
              tools={(initialConfig as SessionConfiguration).availableTools || []}
              policies={editConfig.toolPolicies || {}}
              onChange={handleToolPolicyChange}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
          <button type="button" onClick={onClose} className="btn btn-ghost">
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

      {/* MCP Add Server Modal - managed by this component */}
      <AddMCPServerModal
        isOpen={showMcpAddModal}
        onClose={handleCloseMcpAddModal}
        onAddServer={handleAddMcpServer}
        loading={addingMcpServer}
      />
    </Modal>
  );
}
