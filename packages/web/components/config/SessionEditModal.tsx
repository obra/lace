// ABOUTME: Modal component for editing existing sessions configuration
// ABOUTME: Handles session editing form with provider/model selection, working directory, environment variables, and tool policies

'use client';

import React, { memo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { ToolPolicyToggle } from '@/components/ui/ToolPolicyToggle';
import { ModelSelectionForm } from './ModelSelectionForm';
import type { ProviderInfo, SessionConfiguration } from '@/types/api';
import type { ProjectInfo, SessionInfo } from '@/types/core';
import type { ToolPolicy } from '@/components/ui/ToolPolicyToggle';
import { AVAILABLE_TOOLS } from '@/lib/available-tools';

interface SessionEditModalProps {
  isOpen: boolean;
  currentProject: ProjectInfo;
  selectedSession: SessionInfo | null;
  providers: ProviderInfo[];
  sessionConfig: SessionConfiguration;
  sessionName: string;
  sessionDescription: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onSessionNameChange: (name: string) => void;
  onSessionDescriptionChange: (description: string) => void;
  onSessionConfigChange: (config: SessionConfiguration) => void;
}

export const SessionEditModal = memo(function SessionEditModal({
  isOpen,
  currentProject,
  selectedSession,
  providers,
  sessionConfig,
  sessionName,
  sessionDescription,
  loading,
  onClose,
  onSubmit,
  onSessionNameChange,
  onSessionDescriptionChange,
  onSessionConfigChange,
}: SessionEditModalProps) {
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  const handleAddEnvironmentVariable = () => {
    if (!newEnvKey.trim() || !newEnvValue.trim()) return;

    onSessionConfigChange({
      ...sessionConfig,
      environmentVariables: {
        ...(sessionConfig.environmentVariables ?? {}),
        [newEnvKey.trim()]: newEnvValue.trim(),
      },
    });

    setNewEnvKey('');
    setNewEnvValue('');
  };

  const handleRemoveEnvironmentVariable = (key: string) => {
    onSessionConfigChange({
      ...sessionConfig,
      environmentVariables: Object.fromEntries(
        Object.entries(sessionConfig.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    });
  };

  const handleToolPolicyChange = (tool: string, policy: ToolPolicy) => {
    onSessionConfigChange({
      ...sessionConfig,
      toolPolicies: {
        ...(sessionConfig.toolPolicies ?? {}),
        [tool]: policy,
      },
    });
  };

  if (!selectedSession) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit Session: ${selectedSession.name}`}
      size="xl"
      className="max-h-[90vh] flex flex-col"
    >
      <form onSubmit={onSubmit} className="flex flex-col max-h-[80vh]">
        <div className="flex-1 overflow-y-auto px-1 space-y-6">
          {/* Basic Information */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">
                <span className="label-text font-medium">Session Name *</span>
              </label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => onSessionNameChange(e.target.value)}
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
                value={sessionDescription}
                onChange={(e) => onSessionDescriptionChange(e.target.value)}
                className="input input-bordered w-full"
                placeholder="Optional description"
              />
            </div>
          </div>

          {/* Provider and Model Selection */}
          <ModelSelectionForm
            providers={providers}
            providerInstanceId={sessionConfig.providerInstanceId}
            modelId={sessionConfig.modelId}
            onProviderChange={(instanceId) =>
              onSessionConfigChange({ ...sessionConfig, providerInstanceId: instanceId })
            }
            onModelChange={(modelId) => onSessionConfigChange({ ...sessionConfig, modelId })}
          />

          {/* Working Directory */}
          <div>
            <label className="label">
              <span className="label-text font-medium">Working Directory</span>
            </label>
            <input
              type="text"
              value={sessionConfig.workingDirectory || currentProject.workingDirectory}
              onChange={(e) =>
                onSessionConfigChange({ ...sessionConfig, workingDirectory: e.target.value })
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
                <div
                  key={tool}
                  className="flex items-center justify-between p-3 border border-base-300 rounded-lg"
                >
                  <span className="font-medium text-sm">{tool}</span>
                  <ToolPolicyToggle
                    value={(sessionConfig.toolPolicies?.[tool] || 'require-approval') as ToolPolicy}
                    onChange={(policy) => handleToolPolicyChange(tool, policy)}
                    size="sm"
                  />
                </div>
              ))}
            </div>
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
            disabled={!sessionName.trim() || loading}
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
    </Modal>
  );
});
