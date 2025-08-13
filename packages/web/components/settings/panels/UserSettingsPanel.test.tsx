// ABOUTME: Tests for UserSettingsPanel component covering user preferences and form validation
// ABOUTME: Validates user input handling, form interactions, and callback integration

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { UserSettingsPanel } from './UserSettingsPanel';

describe('UserSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user settings form', () => {
    render(<UserSettingsPanel />);

    expect(screen.getByText('User Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('calls onSave callback when save button clicked', () => {
    const mockOnSave = vi.fn();
    render(<UserSettingsPanel onSave={mockOnSave} />);

    const nameInput = screen.getByLabelText('Display Name');
    fireEvent.change(nameInput, { target: { value: 'Test User' } });
    fireEvent.click(screen.getByText('Save'));

    expect(mockOnSave).toHaveBeenCalledWith({
      userName: 'Test User',
      userEmail: '',
      userBio: '',
    });
  });

  it('shows success message after saving', () => {
    render(<UserSettingsPanel />);

    const nameInput = screen.getByLabelText('Display Name');
    fireEvent.change(nameInput, { target: { value: 'Test User' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
  });

  it.skip('clears success message after timeout', async () => {
    vi.useFakeTimers();

    try {
      render(<UserSettingsPanel />);

      const nameInput = screen.getByLabelText('Display Name');
      fireEvent.change(nameInput, { target: { value: 'Test User' } });
      fireEvent.click(screen.getByText('Save'));

      expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();

      // Advance time by 3000ms to trigger the timeout
      vi.advanceTimersByTime(3000);

      // Wait for React to update
      await vi.waitFor(
        () => {
          expect(screen.queryByText('Settings saved successfully!')).not.toBeInTheDocument();
        },
        { timeout: 100 }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles controlled mode with external state', () => {
    const mockOnChange = vi.fn();
    render(
      <UserSettingsPanel
        userName="External User"
        userEmail="external@example.com"
        onUserNameChange={mockOnChange}
      />
    );

    expect(screen.getByDisplayValue('External User')).toBeInTheDocument();
    expect(screen.getByDisplayValue('external@example.com')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Display Name');
    fireEvent.change(nameInput, { target: { value: 'Updated User' } });

    expect(mockOnChange).toHaveBeenCalledWith('Updated User');
  });
});
