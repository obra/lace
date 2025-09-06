// ABOUTME: Tests for ThemeProvider component
// ABOUTME: Verifies theme persistence and migration from localStorage to settings API

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './ThemeProvider';
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
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <div data-testid="current-theme">{theme}</div>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Set Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Set Dark
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
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
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Should start with dark theme
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
  });

  it('should load theme from settings API', async () => {
    // Mock API to return light theme
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Should load light theme from API
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });

    expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
  });

  it('should migrate from localStorage to settings API', async () => {
    // Set theme in localStorage
    localStorage.setItem('lace-theme', 'light');

    // Mock API to return empty settings (no theme stored yet)
    mockApiGet.mockResolvedValue({});
    mockApiPatch.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Should migrate theme from localStorage to settings API
    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', { theme: 'light' });
    });

    // Should remove from localStorage after migration
    expect(localStorage.getItem('lace-theme')).toBeNull();
  });

  it('should save theme changes to settings API', async () => {
    // Mock API calls
    mockApiGet.mockResolvedValue({ theme: 'dark' });
    mockApiPatch.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
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
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', { theme: 'light' });
    });
  });

  it('should apply theme to document', async () => {
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
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
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
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
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Should fall back to default theme for invalid values
    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    });
  });
});
