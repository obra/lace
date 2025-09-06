// ABOUTME: User settings panel for managing display name and email preferences
// ABOUTME: Persists settings to API and loads on component mount

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';
import { Alert } from '@/components/ui/Alert';
import { validateUserName, validateEmail } from '@/lib/validation';
import { api } from '@/lib/api-client';

interface UserSettingsPanelProps {
  // Props for controlled mode (optional)
  userName?: string;
  userEmail?: string;
  onUserNameChange?: (name: string) => void;
  onUserEmailChange?: (email: string) => void;
}

export function UserSettingsPanel({
  userName: controlledUserName,
  userEmail: controlledUserEmail,
  onUserNameChange,
  onUserEmailChange,
}: UserSettingsPanelProps) {
  const [internalUserName, setInternalUserName] = useState('');
  const [internalUserEmail, setInternalUserEmail] = useState('');
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ref for timeout cleanup
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledUserName !== undefined || controlledUserEmail !== undefined;
  const userName = isControlled ? controlledUserName || '' : internalUserName;
  const userEmail = isControlled ? controlledUserEmail || '' : internalUserEmail;

  // Load settings from API on mount (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled) {
      let cancelled = false;

      const loadSettings = async () => {
        try {
          setIsFetching(true);
          setErrorMessage(null);
          const settings = await api.get<Record<string, unknown>>('/api/settings');

          if (cancelled) return;

          const name = settings.name;
          const email = settings.email;
          if (typeof name === 'string') setInternalUserName(name);
          if (typeof email === 'string') setInternalUserEmail(email);
        } catch (error) {
          console.warn('Failed to load user settings:', error);
          if (!cancelled) setErrorMessage('Failed to load settings');
        } finally {
          if (!cancelled) setIsFetching(false);
        }
      };

      void loadSettings();

      return () => {
        cancelled = true;
      };
    }
  }, [isControlled]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const handleUserNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      const validated = validateUserName(newName);

      if (isControlled) {
        onUserNameChange?.(validated.value);
      } else {
        setInternalUserName(validated.value);
      }
    },
    [isControlled, onUserNameChange]
  );

  const handleUserEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newEmail = e.target.value;
      const validated = validateEmail(newEmail);

      if (isControlled) {
        onUserEmailChange?.(validated.value);
      } else {
        setInternalUserEmail(validated.value);
      }
    },
    [isControlled, onUserEmailChange]
  );

  const handleSave = useCallback(async () => {
    // Clear any existing timeout
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }

    // Validate and sanitize data before saving
    const nameValidation = validateUserName(userName);
    const emailValidation = validateEmail(userEmail);

    // Check for validation errors
    if (!nameValidation.isValid || !emailValidation.isValid) {
      console.warn('Validation errors detected:', {
        name: nameValidation.error,
        email: emailValidation.error,
      });
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);

      // Save to settings API
      await api.patch('/api/settings', {
        name: nameValidation.value,
        email: emailValidation.value,
      });

      // Show success message with proper cleanup
      setShowSuccessMessage(true);
      successTimeoutRef.current = setTimeout(() => {
        setShowSuccessMessage(false);
        successTimeoutRef.current = null;
      }, 3000);
    } catch (error) {
      console.error('Failed to save user settings:', error);
      setErrorMessage('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  }, [userName, userEmail]);

  return (
    <SettingsPanel
      title="User Settings"
      description="Manage your personal information and preferences"
    >
      {errorMessage && (
        <Alert variant="error" title="Settings error" description={errorMessage} className="mb-6" />
      )}

      <div className="space-y-6">
        <SettingField label="Display Name" description="Your name as it appears in the application">
          <input
            type="text"
            value={userName}
            onChange={handleUserNameChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isFetching && !isSaving) {
                void handleSave();
              }
            }}
            className="input input-bordered w-full"
            placeholder="Enter your display name"
            aria-label="Display Name"
            disabled={isFetching || isSaving}
          />
        </SettingField>

        <SettingField
          label="Email"
          description="Your email address for notifications and account management"
        >
          <input
            type="email"
            value={userEmail}
            onChange={handleUserEmailChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isFetching && !isSaving) {
                void handleSave();
              }
            }}
            className="input input-bordered w-full"
            placeholder="Enter your email address"
            aria-label="Email"
            disabled={isFetching || isSaving}
          />
        </SettingField>

        <div className="flex items-center justify-between pt-4 border-t border-base-300">
          <div className="flex-1">
            {showSuccessMessage && (
              <div className="text-success text-sm font-medium">Settings saved successfully!</div>
            )}
          </div>
          <button
            onClick={handleSave}
            className="btn btn-primary vapor-button ring-hover"
            disabled={isFetching || isSaving}
          >
            {isFetching ? 'Loading...' : isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </SettingsPanel>
  );
}
