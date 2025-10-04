// ABOUTME: Dialog for creating new folders in directory browser
// ABOUTME: Validates folder names and provides user feedback

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@lace/web/components/ui/Modal';
import { AccentButton } from '@lace/web/components/ui/AccentButton';

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

  // Input ref for focusing
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state and focus input when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      // Focus input when dialog opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else {
      setFolderName('');
      setValidationError(null);
    }
  }, [isOpen]);

  const validateName = (name: string): string | null => {
    if (name.length === 0) {
      return 'Directory name cannot be empty';
    }
    if (name.length > MAX_LENGTH) {
      return 'Directory name too long';
    }
    if (INVALID_CHARS.test(name)) {
      return 'Invalid directory name characters';
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
    e.stopPropagation(); // Prevent bubbling to parent form
    const validationErr = validateName(folderName);
    if (validationErr) {
      setValidationError(validationErr);
      return;
    }
    onConfirm(folderName);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop ESC from closing parent wizard when this dialog is open
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  const isValid = folderName.length > 0 && !validationError;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Folder" size="sm">
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
        <div className="space-y-4">
          <div className="form-control">
            <input
              ref={inputRef}
              type="text"
              value={folderName}
              onChange={handleNameChange}
              placeholder="New folder name"
              className={`input input-bordered w-full ${validationError ? 'input-error' : ''}`}
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
            <button type="button" onClick={handleCancel} className="btn" disabled={loading}>
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
