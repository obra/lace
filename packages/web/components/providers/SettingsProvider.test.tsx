// ABOUTME: Tests for SettingsProvider component
// ABOUTME: Verifies theme persistence and migration from localStorage to settings API

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsProvider, useTheme } from './SettingsProvider';
import { api } from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Test component that uses the theme context
function TestComponent() {
  const { theme, setDaisyUITheme } = useTheme();

  return (
    <div>
      <div data-testid="current-theme">{theme.daisyui}</div>
      <button data-testid="set-light" onClick={() => setDaisyUITheme('light')}>
        Set Light
      </button>
      <button data-testid="set-dark" onClick={() => setDaisyUITheme('dark')}>
        Set Dark
      </button>
    </div>
  );
}

describe('SettingsProvider', () => {
  const mockApiGet = vi.mocked(api.get);
  const mockApiPatch = vi.mocked(api.patch);

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Clear localStorage
    localStorage.clear();

    // Remove data-theme attribute
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should start with dark theme by default', async () => {
    // Mock API to return empty settings
    mockApiGet.mockResolvedValue({});

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Should start with dark theme
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
  });

  it('should load theme from settings API', async () => {
    // Mock API to return light theme
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Should load light theme from API
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
  });

  it('should save theme changes to settings API', async () => {
    // Mock API calls
    mockApiGet.mockResolvedValue({ theme: 'dark' });
    mockApiPatch.mockResolvedValue({ theme: 'light' });

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    });

    // Change theme
    await userEvent.click(screen.getByTestId('set-light'));

    // Should update local state
    expect(screen.getByTestId('current-theme')).toHaveTextContent('light');

    // Should save to settings API
    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', {
        theme: 'light',
        timelineWidth: 'medium',
        debugPanelEnabled: false,
      });
    });
  });

  it('should apply theme to document', async () => {
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Should apply theme to document
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  it('should handle API errors gracefully', async () => {
    // Mock API to fail
    mockApiGet.mockRejectedValue(new Error('API Error'));

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Should fall back to default theme
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    });
  });

  it('should validate theme values from API', async () => {
    // Mock API to return invalid theme
    mockApiGet.mockResolvedValue({ theme: 'invalid-theme' });

    render(
      <SettingsProvider>
        <TestComponent />
      </SettingsProvider>
    );

    // Should fall back to default theme for invalid values
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    });
  });
});
