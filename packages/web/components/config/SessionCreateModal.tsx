// ABOUTME: Modal component for creating new sessions with full configuration
// ABOUTME: Handles session creation form with provider/model selection, working directory, environment variables, and tool policies

'use client';

import React, { memo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash, faExclamationTriangle } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { ModelSelectionForm } from './ModelSelectionForm';
import { Alert } from '@/components/ui/Alert';
import type { ProviderInfo, SessionConfiguration } from '@/types/api';
import type { ProjectInfo } from '@/types/core';

interface SessionCreateModalProps {
  isOpen: boolean;
  currentProject: ProjectInfo;
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

export const SessionCreateModal = memo(function SessionCreateModal({
  isOpen,
  currentProject,
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
}: SessionCreateModalProps) {
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleToolPolicyChange = (tool: string, policy: 'allow' | 'require-approval' | 'deny') => {
    onSessionConfigChange({
      ...sessionConfig,
      toolPolicies: {
        ...(sessionConfig.toolPolicies ?? {}),
        [tool]: policy,
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit(e);
    } catch (error) {
      // Extract meaningful error message
      let errorMessage = 'Failed to create session';

      if (error && typeof error === 'object') {
        // Check for API error response structure
        if ('json' in error && error.json && typeof error.json === 'object') {
          const json = error.json as Record<string, unknown>;
          if ('message' in json && typeof json.message === 'string') {
            errorMessage = json.message;
          }
        } else if ('message' in error && typeof error.message === 'string') {
          errorMessage = error.message;
        }
      }

      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setNewEnvKey('');
    setNewEnvValue('');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Session"
      size="xl"
      className="max-h-[90vh] flex flex-col"
    >
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[80vh]">
        <div className="flex-1 overflow-y-auto px-1 space-y-6">
          {/* Error Message */}
          {error && (
            <Alert
              variant="error"
              title="Session creation failed"
              description={error}
              onDismiss={() => setError(null)}
            />
          )}
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
                  <select
                    value={sessionConfig.toolPolicies?.[tool] || 'require-approval'}
                    onChange={(e) =>
                      handleToolPolicyChange(
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
        <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
          <button type="button" onClick={handleClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!sessionName.trim() || loading || isSubmitting}
          >
            {isSubmitting ? (
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
    </Modal>
  );
});
