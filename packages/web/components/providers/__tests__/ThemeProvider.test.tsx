// ABOUTME: Unit tests for ThemeProvider component
// ABOUTME: Tests theme initialization, localStorage persistence, and context access

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider, useTheme } from '@/components/providers/ThemeProvider';

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
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Mock console.log to avoid noise in tests
const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

describe('ThemeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue('dark');
    // Mock document.documentElement.setAttribute
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    consoleSpy.mockClear();
  });

  it('should render children and provide theme context', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('set-light')).toBeInTheDocument();
    expect(screen.getByTestId('set-dark')).toBeInTheDocument();
  });

  it('should initialize theme from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue('light');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('lace-theme');
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
  });

  it('should default to dark theme when no localStorage value', () => {
    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(screen.getByTestId('current-theme')).toHaveTextContent('dark');
  });

  it('should update theme when setTheme is called', async () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const setLightButton = screen.getByTestId('set-light');

    await act(async () => {
      setLightButton.click();
    });

    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('lace-theme', 'light');
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(screen.getByTestId('current-theme')).toHaveTextContent('light');
  });

  it('should throw error when useTheme is called outside provider', () => {
    // Mock console.error to avoid noise in tests
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTheme must be used within ThemeProvider');

    consoleErrorSpy.mockRestore();
  });

  it('should initialize with theme from localStorage', () => {
    mockLocalStorage.getItem.mockReturnValue('cupcake');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('lace-theme');
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'cupcake');
    expect(screen.getByTestId('current-theme')).toHaveTextContent('cupcake');
  });
});
