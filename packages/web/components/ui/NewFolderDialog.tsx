// ABOUTME: Dialog for creating new folders in directory browser
// ABOUTME: Validates folder names and provides user feedback

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { AccentButton } from '@/components/ui/AccentButton';

interface NewFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  loading?: boolean;
  error?: string | null;
}

const INVALID_CHARS = /[/\\:*?"<>|]/;
const MAX_LENGTH = 255;

export function NewFolderDialog({
  isOpen,
  onClose,
  onConfirm,
  loading = false,
  error = null,
}: NewFolderDialogProps) {
  const [folderName, setFolderName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (!isOpen) {
      setFolderName('');
      setValidationError(null);
    }
  }, [isOpen]);

  const validateName = (name: string): string | null => {
    if (!name.trim()) {
      return 'Folder name cannot be empty';
    }
    if (name.length > MAX_LENGTH) {
      return `Folder name too long (max ${MAX_LENGTH} characters)`;
    }
    if (INVALID_CHARS.test(name)) {
      return 'Invalid characters: / \\ : * ? " < > |';
    }
    if (name.startsWith('.')) {
      return 'Folder name cannot start with "."';
    }
    return null;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setFolderName(newName);
    setValidationError(validateName(newName));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErr = validateName(folderName);
    if (validationErr) {
      setValidationError(validationErr);
      return;
    }
    onConfirm(folderName.trim());
  };

  const isValid = folderName.trim() && !validationError;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Folder" size="sm">
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          <div className="form-control">
            <input
              type="text"
              value={folderName}
              onChange={handleNameChange}
              placeholder="New folder name"
              className={`input input-bordered w-full ${validationError ? 'input-error' : ''}`}
              autoFocus
              disabled={loading}
              data-testid="folder-name-input"
            />
            {validationError && (
              <label className="label">
                <span className="label-text-alt text-error">{validationError}</span>
              </label>
            )}
            {error && (
              <label className="label">
                <span className="label-text-alt text-error">{error}</span>
              </label>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn" disabled={loading}>
              Cancel
            </button>
            <AccentButton
              type="submit"
              disabled={!isValid || loading}
              data-testid="create-folder-button"
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Creating...
                </>
              ) : (
                'Create'
              )}
            </AccentButton>
          </div>
        </div>
      </form>
    </Modal>
  );
}
