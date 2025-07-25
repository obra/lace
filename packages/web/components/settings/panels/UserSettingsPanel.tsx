// ABOUTME: User settings panel for managing display name, email, and user preferences
// ABOUTME: Supports both controlled and uncontrolled modes with localStorage persistence

'use client';

import React, { useState, useEffect } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';
import { TextAreaField } from '@/components/ui/TextAreaField';

interface UserSettingsPanelProps {
  userName?: string;
  userEmail?: string;
  userBio?: string;
  onUserNameChange?: (name: string) => void;
  onUserEmailChange?: (email: string) => void;
  onUserBioChange?: (bio: string) => void;
  onSave?: (data: { userName: string; userEmail: string; userBio: string }) => void;
}

export function UserSettingsPanel({
  userName: controlledUserName,
  userEmail: controlledUserEmail,
  userBio: controlledUserBio,
  onUserNameChange,
  onUserEmailChange,
  onUserBioChange,
  onSave
}: UserSettingsPanelProps) {
  const [internalUserName, setInternalUserName] = useState('');
  const [internalUserEmail, setInternalUserEmail] = useState('');
  const [internalUserBio, setInternalUserBio] = useState('');
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledUserName !== undefined || controlledUserEmail !== undefined || controlledUserBio !== undefined;
  const userName = isControlled ? (controlledUserName || '') : internalUserName;
  const userEmail = isControlled ? (controlledUserEmail || '') : internalUserEmail;
  const userBio = isControlled ? (controlledUserBio || '') : internalUserBio;

  // Load from localStorage on mount (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled) {
      const savedUserName = localStorage.getItem('userName') || '';
      const savedUserEmail = localStorage.getItem('userEmail') || '';
      const savedUserBio = localStorage.getItem('userBio') || '';
      setInternalUserName(savedUserName);
      setInternalUserEmail(savedUserEmail);
      setInternalUserBio(savedUserBio);
    }
  }, [isControlled]);

  const handleUserNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    
    if (isControlled) {
      onUserNameChange?.(newName);
    } else {
      setInternalUserName(newName);
    }
  };

  const handleUserEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    
    if (isControlled) {
      onUserEmailChange?.(newEmail);
    } else {
      setInternalUserEmail(newEmail);
    }
  };

  const handleUserBioChange = (newBio: string) => {
    if (isControlled) {
      onUserBioChange?.(newBio);
    } else {
      setInternalUserBio(newBio);
    }
  };

  const handleSave = () => {
    // Save to localStorage (only in uncontrolled mode)
    if (!isControlled) {
      localStorage.setItem('userName', userName);
      localStorage.setItem('userEmail', userEmail);
      localStorage.setItem('userBio', userBio);
    }

    // Call onSave callback
    onSave?.({ userName, userEmail, userBio });

    // Show success message
    setShowSuccessMessage(true);
    setTimeout(() => {
      setShowSuccessMessage(false);
    }, 3000);
  };

  return (
    <SettingsPanel 
      title="User Settings"
      description="Manage your personal information and preferences"
    >
      <div className="space-y-6">
        <SettingField
          label="Display Name"
          description="Your name as it appears in the application"
        >
          <input
            type="text"
            value={userName}
            onChange={handleUserNameChange}
            className="input input-bordered w-full"
            placeholder="Enter your display name"
            aria-label="Display Name"
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
            className="input input-bordered w-full"
            placeholder="Enter your email address"
            aria-label="Email"
          />
        </SettingField>

        <SettingField
          label="Bio"
          description="Tell us a bit about yourself (optional)"
        >
          <TextAreaField
            label="Bio"
            value={userBio}
            onChange={handleUserBioChange}
            placeholder="Enter your bio..."
            rows={3}
            helpText="Max 500 characters"
          />
        </SettingField>

        <div className="flex items-center justify-between pt-4 border-t border-base-300">
          <div className="flex-1">
            {showSuccessMessage && (
              <div className="text-success text-sm font-medium">
                Settings saved successfully!
              </div>
            )}
          </div>
          <button
            onClick={handleSave}
            className="btn btn-primary"
          >
            Save
          </button>
        </div>
      </div>
    </SettingsPanel>
  );
}