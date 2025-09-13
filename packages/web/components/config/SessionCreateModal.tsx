// ABOUTME: Simplified modal component for creating new sessions with task focus
// ABOUTME: Shows project context and asks "What are we working on?" - no configuration options

'use client';

import React, { memo, useState, useRef, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { CondensedChatInput } from '@/components/ui/CondensedChatInput';
import type { ProjectInfo } from '@/types/core';

interface SessionCreateModalProps {
  isOpen: boolean;
  currentProject: ProjectInfo;
  loading: boolean;
  onClose: () => void;
  onSubmit: (userInput: string) => Promise<void>;
}

export const SessionCreateModal = memo(function SessionCreateModal({
  isOpen,
  currentProject,
  loading,
  onClose,
  onSubmit,
}: SessionCreateModalProps) {
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const chatInputRef = useRef<{ focus: () => void } | null>(null);
  const mountedRef = useRef(true);

  // Track component mount state to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [isOpen]);

  const submit = async () => {
    if (!userInput.trim() || loading || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(userInput.trim());
    } finally {
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleClose = () => {
    if (mountedRef.current) {
      setUserInput('');
      setIsSubmitting(false);
    }
    onClose();
  };

  if (!isOpen) return null;

  const isButtonLoading = loading || isSubmitting;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={currentProject.name}
      size="lg"
      className="flex flex-col"
    >
      <div className="space-y-6">
        {/* Working Directory as subtitle */}
        <div className="text-base-content/70 text-sm">{currentProject.workingDirectory}</div>

        {/* Question */}
        <div>
          <label className="label">
            <span className="label-text text-lg font-medium">What are we working on?</span>
          </label>
          <CondensedChatInput
            ref={chatInputRef}
            value={userInput}
            onChange={setUserInput}
            onSend={submit}
            placeholder="Describe what you'd like to work on..."
            disabled={isButtonLoading}
            minRows={3}
            sendButtonText="Let's go"
            allowEmptySubmit={false}
          />
        </div>
      </div>
    </Modal>
  );
});
