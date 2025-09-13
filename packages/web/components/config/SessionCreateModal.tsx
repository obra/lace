// ABOUTME: Simplified modal component for creating new sessions with task focus
// ABOUTME: Shows project context and asks "What are we working on?" - no configuration options

'use client';

import React, { memo, useState, useEffect, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || loading || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(userInput.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (userInput.trim()) {
        void handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const handleClose = () => {
    setUserInput('');
    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  const isButtonLoading = loading || isSubmitting;
  const isDisabled = !userInput.trim() || isButtonLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={currentProject.name}
      size="lg"
      className="flex flex-col"
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="space-y-6">
          {/* Working Directory as subtitle */}
          <div className="text-base-content/70 text-sm">{currentProject.workingDirectory}</div>

          {/* Question */}
          <div>
            <label className="label">
              <span className="label-text text-lg font-medium">What are we working on?</span>
            </label>
            <textarea
              ref={textareaRef}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="textarea textarea-bordered w-full h-32 text-base"
              placeholder="Describe what you'd like to work on..."
              disabled={isButtonLoading}
              rows={4}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end pt-6">
          <button type="submit" className="btn btn-primary" disabled={isDisabled}>
            {isButtonLoading ? (
              <>
                <div className="loading loading-spinner loading-sm"></div>
                Creating...
              </>
            ) : (
              "Let's go"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
});
