// ABOUTME: Tests for UserSettingsPanel component
// ABOUTME: Verifies name and email persistence to settings API

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserSettingsPanel } from './UserSettingsPanel';
import { api } from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Mock validation functions
vi.mock('@/lib/validation', () => ({
  validateUserName: vi.fn((name: string) => ({ isValid: true, value: name })),
  validateEmail: vi.fn((email: string) => ({ isValid: true, value: email })),
}));

describe('UserSettingsPanel', () => {
  const mockApiGet = vi.mocked(api.get);
  const mockApiPatch = vi.mocked(api.patch);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load name and email from settings API on mount', async () => {
    // Mock API to return user settings
    mockApiGet.mockResolvedValue({
      name: 'John Doe',
      email: 'john@example.com',
    });

    render(<UserSettingsPanel />);

    // Should load settings from API
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    // Should populate form fields
    await waitFor(() => {
      expect(screen.getByDisplayValue('John Doe')).toBeInTheDocument();
      expect(screen.getByDisplayValue('john@example.com')).toBeInTheDocument();
    });
  });

  it('should save name and email to settings API', async () => {
    // Mock initial load
    mockApiGet.mockResolvedValue({});
    mockApiPatch.mockResolvedValue({
      name: 'Jane Smith',
      email: 'jane@example.com',
    });

    render(<UserSettingsPanel />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    // Fill in the form
    const nameInput = screen.getByLabelText('Display Name');
    const emailInput = screen.getByLabelText('Email');

    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Jane Smith');

    await userEvent.clear(emailInput);
    await userEvent.type(emailInput, 'jane@example.com');

    // Click save
    const saveButton = screen.getByText('Save');
    await userEvent.click(saveButton);

    // Should save to API
    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', {
        name: 'Jane Smith',
        email: 'jane@example.com',
      });
    });

    // Should show success message
    await waitFor(() => {
      expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
    });
  });

  it('should handle API errors gracefully', async () => {
    // Mock API to fail
    mockApiGet.mockRejectedValue(new Error('API Error'));

    render(<UserSettingsPanel />);

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText('Settings error')).toBeInTheDocument();
      expect(screen.getByText('Failed to load settings')).toBeInTheDocument();
    });
  });

  it('should work in controlled mode', async () => {
    const onUserNameChange = vi.fn();
    const onUserEmailChange = vi.fn();

    render(
      <UserSettingsPanel
        userName="Controlled Name"
        userEmail="controlled@example.com"
        onUserNameChange={onUserNameChange}
        onUserEmailChange={onUserEmailChange}
      />
    );

    // Should not call API in controlled mode
    expect(mockApiGet).not.toHaveBeenCalled();

    // Should display controlled values
    expect(screen.getByDisplayValue('Controlled Name')).toBeInTheDocument();
    expect(screen.getByDisplayValue('controlled@example.com')).toBeInTheDocument();

    // Should call change handlers when typing (simulate a simple character addition)
    const nameInput = screen.getByLabelText('Display Name');

    // Focus the input and fire a change event directly to avoid complex DOM manipulation
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: 'Controlled Name Updated' } });

    // Check that name change handler was called
    expect(onUserNameChange).toHaveBeenCalledWith('Controlled Name Updated');
    expect(onUserEmailChange).not.toHaveBeenCalled();

    // Test email field as well
    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'updated@example.com' } });

    expect(onUserEmailChange).toHaveBeenCalledWith('updated@example.com');
  });

  it('should save when Enter key is pressed', async () => {
    // Mock initial load
    mockApiGet.mockResolvedValue({});
    mockApiPatch.mockResolvedValue({});

    render(<UserSettingsPanel />);

    // Wait for initial load
    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    // Fill in the name field
    const nameInput = screen.getByLabelText('Display Name');
    await userEvent.type(nameInput, 'Test User');

    // Press Enter
    await userEvent.keyboard('{Enter}');

    // Should save to API
    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', {
        name: 'Test User',
        email: '',
      });
    });
  });
});
