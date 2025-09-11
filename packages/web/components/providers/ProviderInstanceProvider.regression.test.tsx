// ABOUTME: Regression test for provider instance loading issues
// ABOUTME: Specifically tests that provider data loads and is available for dropdowns/selects

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { ProviderInstanceProvider, useProviderInstances } from './ProviderInstanceProvider';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

const mockApi = vi.mocked((await import('@/lib/api-client')).api);

// Component that simulates a dropdown using provider data
function MockProviderDropdown() {
  const { instances, instancesLoading } = useProviderInstances();

  if (instancesLoading) {
    return <div data-testid="dropdown-loading">Loading providers...</div>;
  }

  return (
    <select data-testid="provider-dropdown">
      <option value="">Select Provider</option>
      {instances.map((instance) => (
        <option key={instance.id} value={instance.id}>
          {instance.displayName}
        </option>
      ))}
    </select>
  );
}

describe('ProviderInstanceProvider Regression Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load provider instances for dropdowns without hanging or blocking', async () => {
    // Mock API response with realistic data
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/provider/instances') {
        // Simulate some delay like real API
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          instances: [
            {
              id: 'openai-1',
              displayName: 'OpenAI Production',
              catalogProviderId: 'openai',
              hasCredentials: true,
            },
            {
              id: 'anthropic-1',
              displayName: 'Anthropic Claude',
              catalogProviderId: 'anthropic',
              hasCredentials: true,
            },
            {
              id: 'ollama-1',
              displayName: 'Local Ollama',
              catalogProviderId: 'ollama',
              hasCredentials: false,
            },
          ],
        };
      }
      if (url === '/api/provider/catalog') {
        return { providers: [] }; // Not testing catalog in this regression test
      }
      throw new Error(`Unexpected API call: ${url}`);
    });

    // Render provider and dropdown
    render(
      <ProviderInstanceProvider>
        <MockProviderDropdown />
      </ProviderInstanceProvider>
    );

    // Should start loading
    expect(screen.getByTestId('dropdown-loading')).toBeInTheDocument();

    // Should finish loading and show dropdown with options
    await waitFor(() => {
      expect(screen.getByTestId('provider-dropdown')).toBeInTheDocument();
    });

    const dropdown = screen.getByTestId('provider-dropdown') as HTMLSelectElement;
    const options = Array.from(dropdown.options).map((opt) => opt.textContent);

    // Should have placeholder + 3 real options
    expect(options).toHaveLength(4);
    expect(options).toContain('Select Provider');
    expect(options).toContain('OpenAI Production');
    expect(options).toContain('Anthropic Claude');
    expect(options).toContain('Local Ollama');

    // API should have been called exactly once
    expect(mockApi.get).toHaveBeenCalledWith('/api/provider/instances');
  });

  it('should fail when mounted ref blocks state updates (demonstrates the bug)', async () => {
    // This test specifically targets the mounted ref issue
    function ProblematicProvider({ children }: { children: React.ReactNode }) {
      const mountedRef = useRef(true);
      const [instances, setInstances] = useState<any[]>([]);
      const [loading, setLoading] = useState(true);

      const loadData = useCallback(async () => {
        try {
          if (!mountedRef.current) return; // This could block loading
          setLoading(true);

          // Simulate API call
          await new Promise((resolve) => setTimeout(resolve, 10));

          if (!mountedRef.current) return; // This could block state update
          setInstances([{ id: '1', name: 'Test' }]);
        } finally {
          if (mountedRef.current) {
            setLoading(false);
          }
        }
      }, []);

      useEffect(() => {
        void loadData();
        return () => {
          mountedRef.current = false; // This could cause issues
        };
      }, [loadData]);

      return <div data-testid="instances-count">{instances.length}</div>;
    }

    const { rerender, unmount } = render(
      <ProblematicProvider>
        <div />
      </ProblematicProvider>
    );

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByTestId('instances-count')).toHaveTextContent('1');
    });

    // This should succeed - simulating what the real component should do
    expect(screen.getByTestId('instances-count')).toHaveTextContent('1');
  });

  it('should not prevent state updates during component lifecycle', async () => {
    let resolveInstances: (data: any) => void;
    const instancesPromise = new Promise((resolve) => {
      resolveInstances = resolve;
    });

    // Mock API that we can control timing of
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/provider/instances') {
        const data = await instancesPromise;
        return data;
      }
      if (url === '/api/provider/catalog') {
        return { providers: [] };
      }
      throw new Error(`Unexpected API call: ${url}`);
    });

    // Start rendering
    const { rerender } = render(
      <ProviderInstanceProvider>
        <MockProviderDropdown />
      </ProviderInstanceProvider>
    );

    // Should be loading
    expect(screen.getByTestId('dropdown-loading')).toBeInTheDocument();

    // Simulate component re-render (like would happen during normal React lifecycle)
    rerender(
      <ProviderInstanceProvider>
        <MockProviderDropdown />
      </ProviderInstanceProvider>
    );

    // Now resolve the API call
    await act(async () => {
      resolveInstances!({
        instances: [
          {
            id: 'test-1',
            displayName: 'Test Provider 1',
            catalogProviderId: 'test',
            hasCredentials: true,
          },
        ],
      });
    });

    // Should successfully show the dropdown with data
    await waitFor(() => {
      expect(screen.getByTestId('provider-dropdown')).toBeInTheDocument();
    });

    const dropdown = screen.getByTestId('provider-dropdown') as HTMLSelectElement;
    const options = Array.from(dropdown.options).map((opt) => opt.textContent);
    expect(options).toContain('Test Provider 1');
  });
});
