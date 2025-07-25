// ABOUTME: User settings panel for managing display name, email, and user preferences
// ABOUTME: Supports both controlled and uncontrolled modes with localStorage persistence

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { validateUserName, validateEmail, validateBio, sanitizeUserData } from '@/lib/validation';

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
  
  // Ref for timeout cleanup
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine if we're in controlled or uncontrolled mode
  const isControlled = controlledUserName !== undefined || controlledUserEmail !== undefined || controlledUserBio !== undefined;
  const userName = isControlled ? (controlledUserName || '') : internalUserName;
  const userEmail = isControlled ? (controlledUserEmail || '') : internalUserEmail;
  const userBio = isControlled ? (controlledUserBio || '') : internalUserBio;

  // Load from localStorage on mount (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled) {
      const rawUserName = localStorage.getItem('userName') || '';
      const rawUserEmail = localStorage.getItem('userEmail') || '';
      const rawUserBio = localStorage.getItem('userBio') || '';
      
      // Sanitize data loaded from localStorage
      const sanitized = sanitizeUserData({
        userName: rawUserName,
        userEmail: rawUserEmail,
        userBio: rawUserBio,
      });
      
      setInternalUserName(sanitized.userName);
      setInternalUserEmail(sanitized.userEmail);
      setInternalUserBio(sanitized.userBio);
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

  const handleUserNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    const validated = validateUserName(newName);
    
    if (isControlled) {
      onUserNameChange?.(validated.value);
    } else {
      setInternalUserName(validated.value);
    }
  }, [isControlled, onUserNameChange]);

  const handleUserEmailChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    const validated = validateEmail(newEmail);
    
    if (isControlled) {
      onUserEmailChange?.(validated.value);
    } else {
      setInternalUserEmail(validated.value);
    }
  }, [isControlled, onUserEmailChange]);

  const handleUserBioChange = useCallback((newBio: string) => {
    const validated = validateBio(newBio);
    
    if (isControlled) {
      onUserBioChange?.(validated.value);
    } else {
      setInternalUserBio(validated.value);
    }
  }, [isControlled, onUserBioChange]);

  const handleSave = useCallback(() => {
    // Clear any existing timeout
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    
    // Validate and sanitize all data before saving
    const nameValidation = validateUserName(userName);
    const emailValidation = validateEmail(userEmail);
    const bioValidation = validateBio(userBio);
    
    // Check for validation errors
    if (!nameValidation.isValid || !emailValidation.isValid || !bioValidation.isValid) {
      // For now, we'll save what we can. In a real app, you might want to show error messages
      console.warn('Validation errors detected:', {
        name: nameValidation.error,
        email: emailValidation.error,
        bio: bioValidation.error,
      });
    }
    
    // Use validated/sanitized values
    const sanitizedData = {
      userName: nameValidation.value,
      userEmail: emailValidation.value,
      userBio: bioValidation.value,
    };
    
    // Save to localStorage (only in uncontrolled mode)
    if (!isControlled) {
      localStorage.setItem('userName', sanitizedData.userName);
      localStorage.setItem('userEmail', sanitizedData.userEmail);
      localStorage.setItem('userBio', sanitizedData.userBio);
    }

    // Call onSave callback with sanitized data
    onSave?.(sanitizedData);

    // Show success message with proper cleanup
    setShowSuccessMessage(true);
    successTimeoutRef.current = setTimeout(() => {
      setShowSuccessMessage(false);
      successTimeoutRef.current = null;
    }, 3000);
  }, [userName, userEmail, userBio, isControlled, onSave]);

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