// ABOUTME: Tabbed project edit modal using native DaisyUI radio tabs to prevent modal conflicts
// ABOUTME: Uses radio inputs for tab state management without JavaScript event handling

'use client';

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash, faServer, faUser, faCog, faTools } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { DirectoryField } from '@/components/ui';
import { ToolPolicyList } from '@/components/config/ToolPolicyList';
import { MCPProjectConfig } from '@/components/mcp/MCPProjectConfig';
import { AddMCPServerModal } from '@/components/modals/AddMCPServerModal';
import type { ProjectInfo, MCPServerConfig } from '@/types/core';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';
import type { SessionConfiguration } from '@/types/api';
import { isToolPolicyData } from '@/lib/type-guards';
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
  const [mcpConfigKey, setMcpConfigKey] = useState(0);

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

  // Environment variable handlers
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

  const handleRemoveEnvironmentVariable = (key: string) => {
    setEditConfig((prev) => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  // Tool policy handlers
  const handleToolPolicyChange = (tool: string, policy: ToolPolicy) => {
    setEditConfig((prev) => {
      const updatedPolicies = {
        ...(prev.toolPolicies ?? {}),
        [tool]: policy,
      };

      // Update both structures to keep them in sync
      const updatedConfig = {
        ...prev,
        toolPolicies: updatedPolicies,
      };

      // Also update the tools structure if it exists to reflect the new value
      if (prev.tools && prev.tools[tool]) {
        updatedConfig.tools = {
          ...prev.tools,
          [tool]: {
            ...prev.tools[tool],
            value: policy,
          },
        };
      }

      return updatedConfig;
    });
  };

  // MCP server management
  const handleOpenMcpAddModal = () => {
    setShowMcpAddModal(true);
  };

  const handleCloseMcpAddModal = () => {
    setShowMcpAddModal(false);
  };

  const handleAddMcpServer = async (serverId: string, config: MCPServerConfig) => {
    setAddingMcpServer(true);
    try {
      await api.post(`/api/projects/${project?.id}/mcp/servers`, { id: serverId, ...config });
      setShowMcpAddModal(false);
      setMcpConfigKey((prev) => prev + 1);
    } catch (error) {
      // Error handling
    } finally {
      setAddingMcpServer(false);
    }
  };

  // Form submission
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

  const modalId = `project-edit-modal-${project.id}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Project: ${project.name}`}
      size="xl"
      className="flex flex-col h-[80vh] max-h-[80vh]"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* DaisyUI Tabs with Radio Inputs */}
          <div role="tablist" className="tabs tabs-bordered mb-4">
            <input
              type="radio"
              name={`${modalId}-tabs`}
              role="tab"
              className="tab"
              aria-label="Basics"
              defaultChecked
            />
            <div role="tabpanel" className="tab-content p-6 space-y-6 overflow-y-auto max-h-[60vh]">
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

              <DirectoryField
                label="Working Directory *"
                value={editWorkingDirectory}
                onChange={setEditWorkingDirectory}
                placeholder="/path/to/project"
                required
              />

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Default Provider</span>
                  </label>
                  <select
                    value={editConfig.providerInstanceId || ''}
                    onChange={(e) => {
                      const newInstanceId = e.target.value;
                      const provider = availableProviders.find(
                        (p) => p.instanceId === newInstanceId
                      );
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
                        {!editConfig.providerInstanceId && (
                          <option value="">Select a provider</option>
                        )}
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
                    onChange={(e) =>
                      setEditConfig((prev) => ({ ...prev, modelId: e.target.value }))
                    }
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
            </div>

            <input
              type="radio"
              name={`${modalId}-tabs`}
              role="tab"
              className="tab"
              aria-label="Environment"
            />
            <div role="tabpanel" className="tab-content p-6 space-y-6 overflow-y-auto max-h-[60vh]">
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
            </div>

            <input
              type="radio"
              name={`${modalId}-tabs`}
              role="tab"
              className="tab"
              aria-label="MCP Servers"
            />
            <div role="tabpanel" className="tab-content p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              <div className="rounded-xl p-4 bg-base-100/60 backdrop-blur-sm border border-base-300/60">
                <MCPProjectConfig
                  key={mcpConfigKey}
                  projectId={project.id}
                  onOpenAddModal={handleOpenMcpAddModal}
                />
              </div>
            </div>

            <input
              type="radio"
              name={`${modalId}-tabs`}
              role="tab"
              className="tab"
              aria-label="Tool Policies"
            />
            <div role="tabpanel" className="tab-content p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              <div>
                <label className="label">
                  <span className="label-text font-medium">Tool Access Policies</span>
                </label>
                <ToolPolicyList
                  toolPolicyData={
                    isToolPolicyData(initialConfig.tools) ? initialConfig.tools : undefined
                  }
                  onChange={handleToolPolicyChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions - Always visible at bottom */}
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

      {/* MCP Add Server Modal */}
      <AddMCPServerModal
        isOpen={showMcpAddModal}
        onClose={handleCloseMcpAddModal}
        onAddServer={handleAddMcpServer}
        loading={addingMcpServer}
      />
    </Modal>
  );
}
