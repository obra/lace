// ABOUTME: Tests for UserSettingsPanel component covering user preferences and localStorage persistence
// ABOUTME: Validates user name saving, form interactions, and integration with settings system

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { UserSettingsPanel } from './UserSettingsPanel';

describe('UserSettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
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

  it('saves user name to localStorage', () => {
    render(<UserSettingsPanel />);
    
    const nameInput = screen.getByLabelText('Display Name');
    const saveButton = screen.getByText('Save');
    
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.click(saveButton);
    
    expect(localStorage.getItem('userName')).toBe('John Doe');
  });

  it('saves email to localStorage', () => {
    render(<UserSettingsPanel />);
    
    const emailInput = screen.getByLabelText('Email');
    const saveButton = screen.getByText('Save');
    
    fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
    fireEvent.click(saveButton);
    
    expect(localStorage.getItem('userEmail')).toBe('john@example.com');
  });

  it('loads saved values from localStorage on mount', () => {
    localStorage.setItem('userName', 'Jane Smith');
    localStorage.setItem('userEmail', 'jane@example.com');
    
    render(<UserSettingsPanel />);
    
    expect(screen.getByDisplayValue('Jane Smith')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
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
      userBio: ''
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
      await vi.waitFor(() => {
        expect(screen.queryByText('Settings saved successfully!')).not.toBeInTheDocument();
      }, { timeout: 100 });
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