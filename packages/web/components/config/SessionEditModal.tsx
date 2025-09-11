// ABOUTME: Modal component for editing existing sessions configuration
// ABOUTME: Handles session editing form with provider/model selection, working directory, environment variables, and tool policies

'use client';

import React, { memo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash, faUser, faCog, faTools } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { ToolPolicyList } from '@/components/config/ToolPolicyList';
import { ModelSelector } from '@/components/ui/ModelSelector';
import type { ProviderInfo, SessionConfiguration } from '@/types/api';
import { isToolPolicyData, type ToolPolicyInfo } from '@/lib/type-guards';
import type { ProjectInfo, SessionInfo } from '@/types/core';
import type { ToolPolicy } from '@/types/core';
import { useSessionEditModal } from '@/hooks/useSessionEditModal';
import { useProviderInstances } from '@/components/providers/ProviderInstanceProvider';

interface SessionEditModalProps {
  isOpen: boolean;
  currentProject: ProjectInfo;
  selectedSession: SessionInfo | null;
  onClose: () => void;
  onSuccess?: () => Promise<void>;
}

export const SessionEditModal = memo(function SessionEditModal({
  isOpen,
  currentProject,
  selectedSession,
  onClose,
  onSuccess,
}: SessionEditModalProps) {
  const { availableProviders } = useProviderInstances();

  const {
    loading,
    sessionName,
    sessionDescription,
    sessionConfig,
    openModal,
    closeModal,
    handleSubmit,
    handleSessionNameChange,
    handleSessionDescriptionChange,
    handleSessionConfigChange,
    updateProviderInstanceId,
    updateModelId,
  } = useSessionEditModal({ onSuccess });

  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');

  // Sync external open state with internal modal state
  React.useEffect(() => {
    if (isOpen && selectedSession) {
      void openModal(selectedSession);
    } else if (!isOpen) {
      closeModal();
    }
  }, [isOpen, selectedSession, openModal, closeModal]);

  // Handle close - notify external component
  const handleClose = () => {
    onClose();
    closeModal();
  };

  const handleAddEnvironmentVariable = () => {
    if (!newEnvKey.trim() || !newEnvValue.trim()) return;

    handleSessionConfigChange((prev) => ({
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
    handleSessionConfigChange((prev) => ({
      ...prev,
      environmentVariables: Object.fromEntries(
        Object.entries(prev.environmentVariables || {}).filter(([k]) => k !== key)
      ),
    }));
  };

  const handleToolPolicyChange = (tool: string, policy: ToolPolicy) => {
    handleSessionConfigChange((prev) => {
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
      if (isToolPolicyData(prev.tools) && prev.tools[tool]) {
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

  if (!selectedSession) return null;

  const modalId = `session-edit-modal-${selectedSession.id}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={selectedSession ? `Edit Session: ${selectedSession.name}` : 'Edit Session'}
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
              {/* Basic Information */}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="label">
                    <span className="label-text font-medium">Session Name *</span>
                  </label>
                  <input
                    type="text"
                    value={sessionName}
                    onChange={(e) => handleSessionNameChange(e.target.value)}
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
                    onChange={(e) => handleSessionDescriptionChange(e.target.value)}
                    className="input input-bordered w-full"
                    placeholder="Optional description"
                  />
                </div>
              </div>

              {/* Provider and Model Selection */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Provider / Model</span>
                </label>
                <ModelSelector
                  providers={availableProviders}
                  selectedProviderInstanceId={sessionConfig.providerInstanceId}
                  selectedModelId={sessionConfig.modelId}
                  onChange={(providerInstanceId, modelId) => {
                    updateProviderInstanceId(providerInstanceId);
                    updateModelId(modelId);
                  }}
                  className="select select-bordered w-full"
                  placeholder="Select provider and model..."
                />
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
              {/* Working Directory */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Working Directory</span>
                </label>
                <input
                  type="text"
                  value={sessionConfig.workingDirectory || currentProject.workingDirectory}
                  onChange={(e) =>
                    handleSessionConfigChange((prev) => ({
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
            </div>

            <input
              type="radio"
              name={`${modalId}-tabs`}
              role="tab"
              className="tab"
              aria-label="Tool Policies"
            />
            <div role="tabpanel" className="tab-content p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Tool Configuration */}
              <div>
                <label className="label">
                  <span className="label-text font-medium">Tool Access Policies</span>
                </label>
                <ToolPolicyList
                  toolPolicyData={
                    isToolPolicyData(sessionConfig.tools) ? sessionConfig.tools : undefined
                  }
                  onChange={handleToolPolicyChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
          <button type="button" onClick={handleClose} className="btn btn-ghost">
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
