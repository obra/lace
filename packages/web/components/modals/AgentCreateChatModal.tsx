// ABOUTME: Chat-widget style modal for creating new agents
// ABOUTME: Combines persona selection, model selection, and optional messaging

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PersonaSelector } from '@/components/ui/PersonaSelector';
import { ModelSelector } from '@/components/ui/ModelSelector';
import { CondensedChatInput } from '@/components/ui/CondensedChatInput';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane } from '@/lib/fontawesome';
import type { PersonaInfo } from '@/types/core';
import type { ProviderInfo } from '@/types/api';

interface AgentCreateChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateAgent: (config: {
    personaName: string;
    providerInstanceId: string;
    modelId: string;
    initialMessage?: string;
  }) => Promise<void>;

  // Data
  personas: PersonaInfo[];
  providers: ProviderInfo[];

  // Smart defaults
  defaultPersonaName?: string;
  defaultProviderInstanceId?: string;
  defaultModelId?: string;

  // Loading state
  creating?: boolean;
  personasLoading?: boolean;
  personasError?: string | null;
}

export function AgentCreateChatModal({
  isOpen,
  onClose,
  onCreateAgent,
  personas,
  providers,
  defaultPersonaName,
  defaultProviderInstanceId,
  defaultModelId,
  creating = false,
  personasLoading = false,
  personasError = null,
}: AgentCreateChatModalProps) {
  const [selectedPersona, setSelectedPersona] = useState(defaultPersonaName || '');
  const [selectedProviderInstanceId, setSelectedProviderInstanceId] = useState(
    defaultProviderInstanceId || ''
  );
  const [selectedModelId, setSelectedModelId] = useState(defaultModelId || '');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset to defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPersona(defaultPersonaName || '');
      setSelectedProviderInstanceId(defaultProviderInstanceId || '');
      setSelectedModelId(defaultModelId || '');
      setMessage('');
      setIsSubmitting(false);
    }
  }, [isOpen, defaultPersonaName, defaultProviderInstanceId, defaultModelId]);

  const canCreate = selectedPersona && selectedProviderInstanceId && selectedModelId;

  const handleSend = async () => {
    if (!canCreate || isSubmitting || creating) return;

    setIsSubmitting(true);
    try {
      await onCreateAgent({
        personaName: selectedPersona,
        providerInstanceId: selectedProviderInstanceId,
        modelId: selectedModelId,
        initialMessage: message.trim() || undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create agent:', error);
      // Error handling - keep modal open so user can retry
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Agent"
      size="md"
      className="agent-create-chat-modal"
    >
      <div className="space-y-4">
        {/* Persona Selection */}
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-2">
            Who are you messaging?
          </label>
          {personasError && (
            <div className="mb-2 text-sm text-error">Failed to load personas: {personasError}</div>
          )}
          <PersonaSelector
            personas={personas}
            selectedPersona={selectedPersona}
            onChange={setSelectedPersona}
            placeholder={personasLoading ? 'Loading personas...' : 'Select persona...'}
            disabled={personasLoading}
            className="w-full"
          />
        </div>

        {/* Message Input */}
        <div>
          <CondensedChatInput
            value={message}
            onChange={setMessage}
            onSend={handleSend}
            placeholder="Type a message (optional)..."
            disabled={creating || isSubmitting}
            className="w-full"
          />
        </div>

        {/* Model Selection */}
        <div>
          <label className="block text-sm font-medium text-base-content/80 mb-2">Model</label>
          <ModelSelector
            providers={providers}
            selectedProviderInstanceId={selectedProviderInstanceId}
            selectedModelId={selectedModelId}
            onChange={(providerInstanceId, modelId) => {
              setSelectedProviderInstanceId(providerInstanceId);
              setSelectedModelId(modelId);
            }}
            className="select select-bordered w-full"
            placeholder="Select model..."
          />
        </div>

        {/* Send Button */}
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canCreate || creating || isSubmitting}
            className="btn btn-primary flex items-center gap-2"
            data-testid="create-agent-send-button"
          >
            {creating || isSubmitting ? (
              <>
                <div className="loading loading-spinner loading-sm"></div>
                Creating...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
                {message.trim() ? 'Send' : 'Create Agent'}
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
