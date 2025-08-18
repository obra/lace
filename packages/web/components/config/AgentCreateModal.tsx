// ABOUTME: Modal component for creating new agents in sessions
// ABOUTME: Handles agent creation form with provider/model selection and validation

'use client';

import React, { memo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { ModelSelectionForm } from './ModelSelectionForm';
import type { ProviderInfo } from '@/types/api';
import type { SessionInfo } from '@/types/core';

interface AgentCreateModalProps {
  isOpen: boolean;
  selectedSession: SessionInfo | null;
  providers: ProviderInfo[];
  agentName: string;
  selectedInstanceId: string;
  selectedModelId: string;
  loading: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onAgentNameChange: (name: string) => void;
  onProviderChange: (instanceId: string) => void;
  onModelChange: (modelId: string) => void;
}

export const AgentCreateModal = memo(function AgentCreateModal({
  isOpen,
  selectedSession,
  providers,
  agentName,
  selectedInstanceId,
  selectedModelId,
  loading,
  onClose,
  onSubmit,
  onAgentNameChange,
  onProviderChange,
  onModelChange,
}: AgentCreateModalProps) {
  if (!selectedSession) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Launch Agent in ${selectedSession.name}`}
      size="sm"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">
            <span className="label-text font-medium">Agent Name *</span>
          </label>
          <input
            type="text"
            value={agentName}
            onChange={(e) => onAgentNameChange(e.target.value)}
            className="input input-bordered w-full"
            placeholder="e.g., Code Reviewer"
            required
            autoFocus
          />
        </div>

        {/* Provider Instance Selection */}
        <ModelSelectionForm
          providers={providers}
          providerInstanceId={selectedInstanceId}
          modelId={selectedModelId}
          onProviderChange={onProviderChange}
          onModelChange={onModelChange}
          className="mb-4"
        />

        <div className="flex justify-end gap-3 pt-4 border-t border-base-300">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!agentName.trim() || loading || !selectedInstanceId || !selectedModelId}
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
    </Modal>
  );
});
