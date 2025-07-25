// ABOUTME: Tests for SettingsContainer integration covering complete settings workflow
// ABOUTME: Tests modal state management, theme persistence, and integration with all components

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SettingsContainer } from './SettingsContainer';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('SettingsContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('dark'); // Default theme
    
    // Mock document.documentElement.setAttribute
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children with onOpenSettings callback', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    expect(screen.getByTestId('settings-trigger')).toBeInTheDocument();
  });

  it('opens settings modal when triggered', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    fireEvent.click(screen.getByTestId('settings-trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('closes settings modal when close button clicked', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    // Open modal
    fireEvent.click(screen.getByTestId('settings-trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close modal
    const closeButton = screen.getByRole('button', { name: /✕/ });
    fireEvent.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads initial theme from localStorage', () => {
    localStorageMock.getItem.mockReturnValue('light');
    
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    expect(localStorageMock.getItem).toHaveBeenCalledWith('theme');
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('defaults to dark theme when no theme in localStorage', () => {
    localStorageMock.getItem.mockReturnValue(null);
    
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });

  it('changes theme when selected in settings', async () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    // Open settings modal
    fireEvent.click(screen.getByTestId('settings-trigger'));
    
    // Find and click light theme button
    const lightButton = screen.getByRole('button', { name: /light/i });
    fireEvent.click(lightButton);

    // Verify theme was applied to document
    await waitFor(() => {
      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    // Verify theme was saved to localStorage
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('displays UI settings panel in modal', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    fireEvent.click(screen.getByTestId('settings-trigger'));
    
    // Should show UI Settings panel
    expect(screen.getByText('UI Settings')).toBeInTheDocument();
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('handles keyboard navigation (Escape key)', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    // Open modal
    fireEvent.click(screen.getByTestId('settings-trigger'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape to close
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves theme selection across modal open/close cycles', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    // Open modal and change theme
    fireEvent.click(screen.getByTestId('settings-trigger'));
    const lightButton = screen.getByRole('button', { name: /light/i });
    fireEvent.click(lightButton);

    // Close modal
    const closeButton = screen.getByRole('button', { name: /✕/ });
    fireEvent.click(closeButton);

    // Reopen modal
    fireEvent.click(screen.getByTestId('settings-trigger'));

    // Verify light theme is still selected
    const lightButtonAgain = screen.getByRole('button', { name: /light/i });
    expect(lightButtonAgain).toHaveClass('border-primary');
  });

  it('integrates with tabbed interface', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Open Settings
          </button>
        )}
      </SettingsContainer>
    );

    fireEvent.click(screen.getByTestId('settings-trigger'));
    
    // Should show tabs (even if just one for now)
    expect(screen.getByText('Ui')).toBeInTheDocument(); // Tab name gets capitalized
  });

  it('provides render prop pattern for flexible integration', () => {
    const TestComponent = () => (
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <div>
            <span>Test Content</span>
            <button onClick={onOpenSettings}>Settings</button>
          </div>
        )}
      </SettingsContainer>
    );

    render(<TestComponent />);
    
    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('displays User settings tab with UserSettingsPanel', () => {
    render(
      <SettingsContainer>
        {({ onOpenSettings }) => (
          <button onClick={onOpenSettings} data-testid="settings-trigger">
            Settings
          </button>
        )}
      </SettingsContainer>
    );

    fireEvent.click(screen.getByTestId('settings-trigger'));
    
    // Check that User tab is available
    const userTab = screen.getByRole('tab', { name: /user/i });
    expect(userTab).toBeInTheDocument();
    
    // Click on User tab
    fireEvent.click(userTab);
    
    // Verify UserSettingsPanel content is displayed
    expect(screen.getByText('User Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toBeInTheDocument();
  });
});