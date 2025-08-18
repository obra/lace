// ABOUTME: Modal component for editing existing agents configuration
// ABOUTME: Handles agent editing form with provider/model selection and validation

'use client';

import React, { memo } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { ProviderInfo } from '@/types/api';

interface EditingAgent {
  threadId: string;
  name: string;
  providerInstanceId: string;
  modelId: string;
}

interface AgentEditModalProps {
  isOpen: boolean;
  editingAgent: EditingAgent | null;
  providers: ProviderInfo[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onAgentChange: (agent: EditingAgent | null) => void;
}

export const AgentEditModal = memo(function AgentEditModal({
  isOpen,
  editingAgent,
  providers,
  loading,
  onClose,
  onSubmit,
  onAgentChange,
}: AgentEditModalProps) {
  // Get available providers (only those that are configured with instance IDs)
  const availableProviders = providers.filter((p): p is ProviderInfo & { instanceId: string } =>
    Boolean(p.configured && p.instanceId)
  );

  if (!editingAgent) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Edit Agent: ${editingAgent.name}`} size="sm">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">
            <span className="label-text font-medium">Agent Name *</span>
          </label>
          <input
            type="text"
            value={editingAgent.name}
            onChange={(e) =>
              onAgentChange(editingAgent ? { ...editingAgent, name: e.target.value } : null)
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
              onAgentChange(
                editingAgent
                  ? {
                      ...editingAgent,
                      providerInstanceId: newInstanceId,
                      modelId: providerModels[0]?.id || editingAgent.modelId,
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
              onAgentChange(editingAgent ? { ...editingAgent, modelId: e.target.value } : null)
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

        <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
          <button type="button" onClick={onClose} className="btn btn-ghost">
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
    </Modal>
  );
});
