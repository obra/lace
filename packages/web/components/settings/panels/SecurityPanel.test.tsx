// ABOUTME: Tests for security settings panel component
// ABOUTME: Verifies password change functionality, session management, and security features

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SecurityPanel } from '@/components/settings/panels/SecurityPanel';

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SecurityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render security settings panel', () => {
      render(<SecurityPanel />);
      
      expect(screen.getByText('Security Settings')).toBeInTheDocument();
      expect(screen.getByText('Manage your authentication and security preferences')).toBeInTheDocument();
    });

    it('should render password change section', () => {
      render(<SecurityPanel />);
      
      expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
      expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument();
    });

    it('should render session management section', () => {
      render(<SecurityPanel />);
      
      expect(screen.getByText('Session Management')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /logout from all devices/i })).toBeInTheDocument();
    });

    it('should render security info section', () => {
      render(<SecurityPanel />);
      
      expect(screen.getByText('Security Information')).toBeInTheDocument();
      expect(screen.getByText(/password-based authentication/i)).toBeInTheDocument();
      expect(screen.getByText(/reset it via the command line/i)).toBeInTheDocument();
    });

    it('should have change password button initially disabled', () => {
      render(<SecurityPanel />);
      
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      expect(changePasswordButton).toBeDisabled();
    });
  });

  describe('password change functionality', () => {
    it('should enable change password button when all fields are filled', () => {
      render(<SecurityPanel />);
      
      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      
      fireEvent.change(currentPasswordInput, { target: { value: 'current123' } });
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      
      expect(changePasswordButton).toBeEnabled();
    });

    it('should show password mismatch error when passwords do not match', () => {
      render(<SecurityPanel />);
      
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');
      
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'different123' } });
      fireEvent.blur(confirmPasswordInput);
      
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    });

    it('should show minimum length error for short password', () => {
      render(<SecurityPanel />);
      
      const newPasswordInput = screen.getByLabelText('New Password');
      
      fireEvent.change(newPasswordInput, { target: { value: 'short' } });
      fireEvent.blur(newPasswordInput);
      
      expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    });

    it('should handle successful password change', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<SecurityPanel />);
      
      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      
      fireEvent.change(currentPasswordInput, { target: { value: 'current123' } });
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.click(changePasswordButton);
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: 'current123',
            newPassword: 'newpass123',
          }),
        });
      });
      
      await waitFor(() => {
        expect(screen.getByText('Password changed successfully!')).toBeInTheDocument();
      });
    });

    it('should handle password change error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Current password is incorrect' }),
      });

      render(<SecurityPanel />);
      
      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      
      fireEvent.change(currentPasswordInput, { target: { value: 'wrong123' } });
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.click(changePasswordButton);
      
      await waitFor(() => {
        expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
      });
    });

    it('should clear form after successful password change', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<SecurityPanel />);
      
      const currentPasswordInput = screen.getByLabelText('Current Password') as HTMLInputElement;
      const newPasswordInput = screen.getByLabelText('New Password') as HTMLInputElement;
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password') as HTMLInputElement;
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      
      fireEvent.change(currentPasswordInput, { target: { value: 'current123' } });
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.click(changePasswordButton);
      
      await waitFor(() => {
        expect(screen.getByText('Password changed successfully!')).toBeInTheDocument();
      });
      
      expect(currentPasswordInput.value).toBe('');
      expect(newPasswordInput.value).toBe('');
      expect(confirmPasswordInput.value).toBe('');
    });
  });

  describe('session management', () => {
    it('should handle logout from all devices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<SecurityPanel />);
      
      const logoutButton = screen.getByRole('button', { name: /logout from all devices/i });
      fireEvent.click(logoutButton);
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/logout-all', {
          method: 'POST',
        });
      });
      
      await waitFor(() => {
        expect(screen.getByText('All sessions terminated successfully')).toBeInTheDocument();
      });
    });

    it('should handle logout error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Logout failed' }),
      });

      render(<SecurityPanel />);
      
      const logoutButton = screen.getByRole('button', { name: /logout from all devices/i });
      fireEvent.click(logoutButton);
      
      await waitFor(() => {
        expect(screen.getByText('Logout failed')).toBeInTheDocument();
      });
    });
  });

  describe('loading states', () => {
    it('should show loading state during password change', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockFetch.mockReturnValueOnce(promise);

      render(<SecurityPanel />);
      
      const currentPasswordInput = screen.getByLabelText('Current Password');
      const newPasswordInput = screen.getByLabelText('New Password');
      const confirmPasswordInput = screen.getByLabelText('Confirm New Password');
      const changePasswordButton = screen.getByRole('button', { name: /change password/i });
      
      fireEvent.change(currentPasswordInput, { target: { value: 'current123' } });
      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.click(changePasswordButton);
      
      await waitFor(() => {
        expect(changePasswordButton).toBeDisabled();
        expect(screen.getByText('Changing...')).toBeInTheDocument();
      });
      
      // Resolve the promise
      resolvePromise!({
        ok: true,
        json: async () => ({ success: true }),
      });
    });
  });
});