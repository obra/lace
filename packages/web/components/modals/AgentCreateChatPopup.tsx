// ABOUTME: Chat popup for creating new agents (improved UX design)
// ABOUTME: Positioned popup without modal overlay, simplified form, navigation integration

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { PersonaSelector } from '@/components/ui/PersonaSelector';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPaperPlane, faTimes } from '@/lib/fontawesome';
import type { PersonaInfo } from '@/types/core';

interface AgentCreateChatPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateAgent: (config: { personaName: string; initialMessage?: string }) => Promise<string>; // Returns agent thread ID for navigation

  // Data
  personas: PersonaInfo[];

  // Smart defaults
  defaultPersonaName?: string;

  // Positioning
  anchorRef: React.RefObject<HTMLButtonElement | null>;

  // Loading state
  creating?: boolean;
  personasLoading?: boolean;
  personasError?: string | null;
}

export function AgentCreateChatPopup({
  isOpen,
  onClose,
  onCreateAgent,
  personas,
  defaultPersonaName,
  anchorRef,
  creating = false,
  personasLoading = false,
  personasError = null,
}: AgentCreateChatPopupProps) {
  const [selectedPersona, setSelectedPersona] = useState(defaultPersonaName || 'lace');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Reset to defaults when popup opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPersona(defaultPersonaName || 'lace'); // Honor defaultPersonaName prop
      setMessage('');
      setIsSubmitting(false);
      // Focus message input when opened
      setTimeout(() => messageInputRef.current?.focus(), 100);
    }
  }, [isOpen, defaultPersonaName]);

  const canCreate = selectedPersona && !personasLoading;

  const handleSend = async () => {
    if (!canCreate || isSubmitting || creating) return;

    setIsSubmitting(true);
    try {
      const agentThreadId = await onCreateAgent({
        personaName: selectedPersona,
        initialMessage: message.trim() || undefined,
      });

      // Close popup after successful creation
      onClose();

      // Navigation happens in parent component using returned agentThreadId
    } catch (error) {
      console.error('Failed to create agent:', error);
      // Keep popup open for retry on error
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canCreate) {
        handleSend();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={popupRef}
      className="absolute z-50 bg-base-100 border border-base-300 rounded-lg shadow-xl w-80 p-4"
      data-testid="agent-create-popup"
      style={{
        // Position relative to anchor element
        top: anchorRef.current
          ? anchorRef.current.offsetTop + anchorRef.current.offsetHeight + 8
          : 0,
        left: anchorRef.current ? anchorRef.current.offsetLeft : 0,
      }}
    >
      {/* Header: Persona selector and close button on same line */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 mr-3">
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
        <button
          onClick={onClose}
          className="p-1 hover:bg-base-200 rounded transition-colors flex-shrink-0"
          data-testid="close-popup-button"
        >
          <FontAwesomeIcon icon={faTimes} className="w-3 h-3 text-base-content/60" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Message Input - taller by default */}
        <div>
          <textarea
            ref={messageInputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message (optional)..."
            disabled={creating || isSubmitting}
            className="w-full px-3 py-3 bg-base-100 border border-base-300 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none outline-none placeholder:text-base-content/60 text-base-content"
            style={{
              minHeight: '80px', // Taller than CondensedChatInput (36px)
              maxHeight: '160px',
              lineHeight: '1.5',
            }}
            rows={3}
            data-testid="message-input-popup"
          />
        </div>

        {/* Send Button */}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={!canCreate || creating || isSubmitting}
            className="btn btn-primary btn-sm flex items-center gap-2"
            data-testid="create-agent-send-button"
          >
            {creating || isSubmitting ? (
              <>
                <div className="loading loading-spinner loading-xs"></div>
                Creating...
              </>
            ) : (
              <>
                <FontAwesomeIcon icon={faPaperPlane} className="w-3 h-3" />
                {message.trim() ? 'Send' : 'Create Agent'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
