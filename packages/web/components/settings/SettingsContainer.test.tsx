// ABOUTME: Tests for SettingsContainer integration covering complete settings workflow
// ABOUTME: Tests modal state management, theme persistence, and integration with all components

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, beforeEach, afterEach, expect, describe, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { SettingsContainer } from './SettingsContainer';
import { ProviderInstanceProvider } from '@/components/providers/ProviderInstanceProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { stringify } from '@/lib/serialization';
import { api } from '@/lib/api-client';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

// Mock localStorage
const localStorageMock: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch API to prevent actual network calls
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('SettingsContainer', () => {
  // Helper function to render with proper async handling
  const renderSettingsContainer = async (
    children: (props: { onOpenSettings: () => void }) => React.ReactNode
  ) => {
    let component: ReturnType<typeof render>;

    await act(async () => {
      component = render(
        <ThemeProvider>
          <ProviderInstanceProvider>
            <SettingsContainer>{children}</SettingsContainer>
          </ProviderInstanceProvider>
        </ThemeProvider>
      );
    });

    // Wait for async effects to complete outside of act
    await waitFor(() => {
      // Component should be rendered
      expect(component.container.firstChild).not.toBeNull();
    });

    return component!;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('dark'); // Default theme

    // Mock document.documentElement.setAttribute
    vi.spyOn(document.documentElement, 'setAttribute').mockImplementation(vi.fn());

    // Mock API client
    const mockApiGet = vi.mocked(api.get);
    const mockApiPatch = vi.mocked(api.patch);
    mockApiGet.mockResolvedValue({}); // Default empty settings
    mockApiPatch.mockResolvedValue({});

    // Mock fetch API responses with proper superjson serialized content
    mockFetch.mockImplementation((url: string) => {
      // Handle provider instances endpoint
      if (url === '/api/provider/instances') {
        const response = stringify({ instances: [] });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(response),
          json: () => Promise.resolve({ instances: [] }),
          clone: function () {
            return this;
          },
        } as Response);
      }

      // Handle provider catalog endpoint
      if (url === '/api/provider/catalog') {
        const response = stringify({ providers: [] });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(response),
          json: () => Promise.resolve({ providers: [] }),
          clone: function () {
            return this;
          },
        } as Response);
      }

      // Default fallback for other URLs
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(stringify({})),
        json: () => Promise.resolve({}),
        clone: function () {
          return this;
        },
      } as Response);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children with onOpenSettings callback', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    expect(screen.getByTestId('settings-trigger')).toBeInTheDocument();
  });

  it('opens settings modal when triggered', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('closes settings modal when close button clicked', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close modal
    await act(async () => {
      const closeButton = screen.getByRole('button', { name: /close modal/i });
      fireEvent.click(closeButton);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads initial theme from settings API', async () => {
    const mockApiGet = vi.mocked(api.get);
    mockApiGet.mockResolvedValue({ theme: 'light' });

    render(
      <ThemeProvider>
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <button onClick={onOpenSettings} data-testid="settings-trigger">
              Open Settings
            </button>
          )}
        </SettingsContainer>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    await waitFor(() => {
      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });
  });

  it('defaults to dark theme when no theme in settings API', async () => {
    const mockApiGet = vi.mocked(api.get);
    mockApiGet.mockResolvedValue({}); // No theme in settings

    render(
      <ThemeProvider>
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <button onClick={onOpenSettings} data-testid="settings-trigger">
              Open Settings
            </button>
          )}
        </SettingsContainer>
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/settings');
    });

    await waitFor(() => {
      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });
  });

  it('changes theme when selected in settings', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    // Open settings modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Switch to UI tab to access theme controls
    await act(async () => {
      const uiTab = screen.getByRole('tab', { name: /ui/i });
      fireEvent.click(uiTab);
    });

    // Find and click light theme button
    await act(async () => {
      const lightButton = screen.getByRole('button', { name: /light/i });
      fireEvent.click(lightButton);
    });

    // Verify theme was applied to document
    await waitFor(() => {
      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    });

    // Verify theme was saved to settings API
    await waitFor(() => {
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/api/settings', { theme: 'light' });
    });
  });

  it('displays UI settings panel in modal', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Should show Providers panel by default
    expect(screen.getByText('AI Provider Configuration')).toBeInTheDocument();
  });

  it('handles keyboard navigation (Escape key)', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    // Open modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Press Escape to close
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves theme selection across modal open/close cycles', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    // Open modal and change theme
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Switch to UI tab to access theme controls
    await act(async () => {
      const uiTab = screen.getByRole('tab', { name: /ui/i });
      fireEvent.click(uiTab);
    });

    await act(async () => {
      const lightButton = screen.getByRole('button', { name: /light/i });
      fireEvent.click(lightButton);
    });

    // Close modal
    await act(async () => {
      const closeButton = screen.getByRole('button', { name: /close modal/i });
      fireEvent.click(closeButton);
    });

    // Reopen modal
    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Switch to UI tab to access theme controls
    await act(async () => {
      const uiTab = screen.getByRole('tab', { name: /ui/i });
      fireEvent.click(uiTab);
    });

    // Verify light theme is still selected
    const lightButtonAgain = screen.getByRole('button', { name: /light/i });
    expect(lightButtonAgain).toHaveClass('border-primary');
  });

  it('integrates with tabbed interface', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Open Settings
      </button>
    ));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Should show tabs
    expect(screen.getByText('Providers')).toBeInTheDocument();
    expect(screen.getByText('UI')).toBeInTheDocument();
    expect(screen.getByText('User')).toBeInTheDocument();
  });

  it('provides render prop pattern for flexible integration', () => {
    const TestComponent = () => (
      <ThemeProvider>
        <SettingsContainer>
          {({ onOpenSettings }) => (
            <div>
              <span>Test Content</span>
              <button onClick={onOpenSettings}>Settings</button>
            </div>
          )}
        </SettingsContainer>
      </ThemeProvider>
    );

    render(<TestComponent />);

    expect(screen.getByText('Test Content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('displays User settings tab with UserSettingsPanel', async () => {
    await renderSettingsContainer(({ onOpenSettings }) => (
      <button onClick={onOpenSettings} data-testid="settings-trigger">
        Settings
      </button>
    ));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-trigger'));
    });

    // Check that User tab is available
    const userTab = screen.getByRole('tab', { name: /user/i });
    expect(userTab).toBeInTheDocument();

    // Click on User tab
    await act(async () => {
      fireEvent.click(userTab);
    });

    // Verify UserSettingsPanel content is displayed
    expect(screen.getByText('User Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});
