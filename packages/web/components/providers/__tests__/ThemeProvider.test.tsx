// ABOUTME: Unit tests for ThemeProvider component
// ABOUTME: Tests theme initialization, API persistence, and context access

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider, useTheme } from '@/components/providers/ThemeProvider';
import { api } from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Test component that uses the theme hook
function TestComponent() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        Set Light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        Set Dark
      </button>
    </div>
  );
}

// Mock localStorage
const mockLocalStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

describe('ThemeProvider', () => {
  const mockApiGet = vi.mocked(api.get);
  const mockApiPatch = vi.mocked(api.patch);

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    // Mock document.documentElement.setAttribute
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it('should render children and provide theme context', () => {
    mockApiGet.mockResolvedValue({});

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('set-light')).toBeInTheDocument();
    expect(screen.getByTestId('set-dark')).toBeInTheDocument();
  });

  it('should load theme from settings API', async () => {
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });

    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('should migrate from localStorage to settings API', async () => {
    mockApiGet.mockResolvedValue({}); // No theme in settings yet
    mockLocalStorage.getItem.mockReturnValue('light');
    mockApiPatch.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(mockApiPatch).toHaveBeenCalledWith('/api/settings', { theme: 'light' });
    });

    await waitFor(() => {
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('lace-theme');
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    });
  });

  it('should save theme changes to settings API', async () => {
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

    const setLightButton = screen.getByTestId('set-light');

    await act(async () => {
      setLightButton.click();
    });

    expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
  });

  it('should throw error when useTheme is called outside provider', () => {
    // Mock console.error to avoid noise in tests
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTheme must be used within ThemeProvider');

    consoleErrorSpy.mockRestore();
  });

  it('should default to dark theme when API fails', async () => {
    mockApiGet.mockRejectedValue(new Error('API Error'));

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    });

    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
  });
});
