// ABOUTME: Tests for login page component
// ABOUTME: Verifies password input, form submission, error handling, and redirect functionality

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRouter, useSearchParams } from 'next/navigation';
import LoginPage from '@/app/login/page';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

// Mock fetch for API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Login Page', () => {
  const mockPush = vi.fn();
  const mockSearchParams = {
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      refresh: vi.fn(),
    } as never);
    vi.mocked(useSearchParams).mockReturnValue(mockSearchParams as never);
    mockSearchParams.get.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render password input field', () => {
      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('should render submit button', () => {
      render(<LoginPage />);
      
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      expect(submitButton).toBeInTheDocument();
    });

    it('should render remember me checkbox', () => {
      render(<LoginPage />);
      
      const rememberCheckbox = screen.getByLabelText(/remember me/i);
      expect(rememberCheckbox).toBeInTheDocument();
      expect(rememberCheckbox).toHaveAttribute('type', 'checkbox');
    });

    it('should have clean, minimal design', () => {
      render(<LoginPage />);
      
      // Should have a title or heading
      expect(screen.getByRole('heading')).toBeInTheDocument();
      
      // Should have a form
      expect(screen.getByRole('form')).toBeInTheDocument();
    });
  });

  describe('form interaction', () => {
    it('should update password field when typing', () => {
      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      
      expect(passwordInput.value).toBe('test-password');
    });

    it('should toggle remember me checkbox', () => {
      render(<LoginPage />);
      
      const checkbox = screen.getByLabelText(/remember me/i) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      
      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
    });

    it('should disable submit button when password is empty', () => {
      render(<LoginPage />);
      
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      expect(submitButton).toBeDisabled();
    });

    it('should enable submit button when password is provided', () => {
      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      expect(submitButton).toBeEnabled();
    });
  });

  describe('form submission', () => {
    it('should call login API with correct password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: 'test-password',
            rememberMe: false,
          }),
        });
      });
    });

    it('should include rememberMe when checkbox is checked', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const rememberCheckbox = screen.getByLabelText(/remember me/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      fireEvent.click(rememberCheckbox);
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: 'test-password',
            rememberMe: true,
          }),
        });
      });
    });

    it('should redirect to home page on successful login', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/');
      });
    });

    it('should show loading state during submission', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockFetch.mockReturnValueOnce(promise);

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      fireEvent.click(submitButton);
      
      // Should show loading state
      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
      
      // Resolve the promise
      resolvePromise!({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });
    });
  });

  describe('error handling', () => {
    it('should display error message on login failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid password' }),
      });

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/invalid password|login failed/i)).toBeInTheDocument();
      });
    });

    it('should display error message on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      fireEvent.change(passwordInput, { target: { value: 'test-password' } });
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/network error|connection failed/i)).toBeInTheDocument();
      });
    });

    it('should clear error message when typing new password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid password' }),
      });

      render(<LoginPage />);
      
      const passwordInput = screen.getByLabelText(/password/i);
      const submitButton = screen.getByRole('button', { name: /sign in|login/i });
      
      // Submit wrong password
      fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
      fireEvent.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/invalid password|login failed/i)).toBeInTheDocument();
      });
      
      // Type new password
      fireEvent.change(passwordInput, { target: { value: 'new-password' } });
      
      // Error should be cleared
      expect(screen.queryByText(/invalid password|login failed/i)).not.toBeInTheDocument();
    });
  });

  describe('one-time token handling', () => {
    it('should handle one-time token from URL params', async () => {
      mockSearchParams.get.mockReturnValue('test-token-123');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });

      render(<LoginPage />);
      
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'test-token-123' }),
        });
      });
    });

    it('should redirect after successful token exchange', async () => {
      mockSearchParams.get.mockReturnValue('test-token-123');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, jwt: 'mock-jwt-token' }),
      });

      render(<LoginPage />);
      
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/');
      });
    });

    it('should show error for invalid one-time token', async () => {
      mockSearchParams.get.mockReturnValue('invalid-token');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid or expired token' }),
      });

      render(<LoginPage />);
      
      await waitFor(() => {
        expect(screen.getByText(/invalid.*token|token.*expired/i)).toBeInTheDocument();
      });
    });
  });
});