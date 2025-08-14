// ABOUTME: Security settings panel for password management and authentication controls
// ABOUTME: Handles password changes, session management, and displays security information

'use client';

import React, { useState, useCallback } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';

interface SecurityPanelProps {
  onPasswordChanged?: () => void;
  onSessionsCleared?: () => void;
}

export function SecurityPanel({ onPasswordChanged, onSessionsCleared }: SecurityPanelProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<{
    newPassword?: string;
    confirmPassword?: string;
  }>({});

  // Password validation
  const validatePassword = (password: string): string | undefined => {
    if (password.length > 0 && password.length < 8) {
      return 'Password must be at least 8 characters';
    }
    return undefined;
  };

  const validatePasswordMatch = (password: string, confirm: string): string | undefined => {
    if (confirm.length > 0 && password !== confirm) {
      return 'Passwords do not match';
    }
    return undefined;
  };

  // Form validation
  const isFormValid = 
    currentPassword.trim().length > 0 &&
    newPassword.trim().length >= 8 &&
    confirmPassword.length > 0 &&
    newPassword === confirmPassword &&
    !passwordErrors.newPassword &&
    !passwordErrors.confirmPassword;

  // Clear messages after timeout
  const clearMessages = useCallback(() => {
    setTimeout(() => {
      setSuccessMessage('');
      setErrorMessage('');
    }, 5000);
  }, []);

  // Handle password field changes with validation
  const handleNewPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewPassword(value);
    
    const error = validatePassword(value);
    setPasswordErrors(prev => ({ ...prev, newPassword: error }));
    
    // Also revalidate confirm password if it has a value
    if (confirmPassword) {
      const matchError = validatePasswordMatch(value, confirmPassword);
      setPasswordErrors(prev => ({ ...prev, confirmPassword: matchError }));
    }
  };

  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setConfirmPassword(value);
    
    const error = validatePasswordMatch(newPassword, value);
    setPasswordErrors(prev => ({ ...prev, confirmPassword: error }));
  };

  // Handle password change submission
  const handleChangePassword = async () => {
    if (!isFormValid) return;

    setIsChangingPassword(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (response.ok) {
        setSuccessMessage('Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordErrors({});
        onPasswordChanged?.();
        clearMessages();
      } else {
        const data = await response.json() as { error?: string };
        setErrorMessage(data.error || 'Password change failed');
        clearMessages();
      }
    } catch (_error) {
      setErrorMessage('Network error occurred');
      clearMessages();
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Handle logout from all devices
  const handleLogoutAll = async () => {
    setIsLoggingOut(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/auth/logout-all', {
        method: 'POST',
      });

      if (response.ok) {
        setSuccessMessage('All sessions terminated successfully');
        onSessionsCleared?.();
        clearMessages();
      } else {
        const data = await response.json() as { error?: string };
        setErrorMessage(data.error || 'Logout failed');
        clearMessages();
      }
    } catch (_error) {
      setErrorMessage('Network error occurred');
      clearMessages();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SettingsPanel
      title="Security Settings"
      description="Manage your authentication and security preferences"
    >
      <div className="space-y-8">
        {/* Success/Error Messages */}
        {(successMessage || errorMessage) && (
          <div className={`rounded-lg p-4 ${successMessage ? 'bg-success/10 border border-success/20' : 'bg-error/10 border border-error/20'}`}>
            <div className={`text-sm font-medium ${successMessage ? 'text-success' : 'text-error'}`}>
              {successMessage || errorMessage}
            </div>
          </div>
        )}

        {/* Password Change Section */}
        <div className="space-y-6">
          <div className="border-b border-base-300 pb-4">
            <h3 className="text-lg font-medium text-base-content">Change Password</h3>
            <p className="text-sm text-base-content/70 mt-1">
              Update your authentication password
            </p>
          </div>

          <SettingField 
            label="Current Password" 
            description="Enter your current password to verify your identity"
          >
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter current password"
              aria-label="Current Password"
              disabled={isChangingPassword}
            />
          </SettingField>

          <SettingField 
            label="New Password" 
            description="Choose a strong password with at least 8 characters"
          >
            <input
              type="password"
              value={newPassword}
              onChange={handleNewPasswordChange}
              onBlur={() => {
                const error = validatePassword(newPassword);
                setPasswordErrors(prev => ({ ...prev, newPassword: error }));
              }}
              className={`input input-bordered w-full ${passwordErrors.newPassword ? 'input-error' : ''}`}
              placeholder="Enter new password"
              aria-label="New Password"
              disabled={isChangingPassword}
            />
            {passwordErrors.newPassword && (
              <p className="text-error text-sm mt-1">{passwordErrors.newPassword}</p>
            )}
          </SettingField>

          <SettingField 
            label="Confirm New Password" 
            description="Re-enter your new password to confirm"
          >
            <input
              type="password"
              value={confirmPassword}
              onChange={handleConfirmPasswordChange}
              onBlur={() => {
                const error = validatePasswordMatch(newPassword, confirmPassword);
                setPasswordErrors(prev => ({ ...prev, confirmPassword: error }));
              }}
              className={`input input-bordered w-full ${passwordErrors.confirmPassword ? 'input-error' : ''}`}
              placeholder="Confirm new password"
              aria-label="Confirm New Password"
              disabled={isChangingPassword}
            />
            {passwordErrors.confirmPassword && (
              <p className="text-error text-sm mt-1">{passwordErrors.confirmPassword}</p>
            )}
          </SettingField>

          <div className="pt-4">
            <button
              onClick={handleChangePassword}
              disabled={!isFormValid || isChangingPassword}
              className="btn btn-primary vapor-button ring-hover"
            >
              {isChangingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>

        {/* Session Management Section */}
        <div className="space-y-6">
          <div className="border-b border-base-300 pb-4">
            <h3 className="text-lg font-medium text-base-content">Session Management</h3>
            <p className="text-sm text-base-content/70 mt-1">
              Manage your active sessions and security
            </p>
          </div>

          <SettingField 
            label="Active Sessions" 
            description="Terminate all active sessions on all devices. You will need to log in again."
          >
            <button
              onClick={handleLogoutAll}
              disabled={isLoggingOut}
              className="btn btn-outline btn-warning vapor-button ring-hover"
            >
              {isLoggingOut ? 'Logging out...' : 'Logout from All Devices'}
            </button>
          </SettingField>
        </div>

        {/* Security Information Section */}
        <div className="space-y-6">
          <div className="border-b border-base-300 pb-4">
            <h3 className="text-lg font-medium text-base-content">Security Information</h3>
            <p className="text-sm text-base-content/70 mt-1">
              Important security details and options
            </p>
          </div>

          <div className="bg-info/10 border border-info/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-info mt-0.5 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="text-sm">
                <div className="font-medium text-info mb-2">Authentication Method</div>
                <ul className="space-y-1 text-base-content/70">
                  <li>• Password-based authentication with secure hashing</li>
                  <li>• JWT tokens for session management</li>
                  <li>• One-time tokens for auto-login from CLI</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-warning mt-0.5 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 3.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 3.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="text-sm">
                <div className="font-medium text-warning mb-2">Password Recovery</div>
                <div className="text-base-content/70">
                  If you forget your password, you can reset it via the command line:
                  <code className="block bg-base-200 rounded px-2 py-1 mt-2 text-xs font-mono">
                    npm start -- --reset-password
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}