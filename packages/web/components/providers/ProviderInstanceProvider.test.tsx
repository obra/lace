// ABOUTME: Tests for ProviderInstanceProvider data loading and context provision
// ABOUTME: Ensures provider instances and catalog are loaded correctly and accessible to child components

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProviderInstanceProvider, useProviderInstances } from './ProviderInstanceProvider';

// Mock the API client
vi.mock('@/lib/api-client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApi = vi.mocked((await import('@/lib/api-client')).api);

// Test component that uses the provider context
function TestConsumer() {
  const { instances, instancesLoading, catalogProviders, catalogLoading } = useProviderInstances();

  if (instancesLoading || catalogLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <div data-testid="instance-count">{instances.length}</div>
      <div data-testid="catalog-count">{catalogProviders.length}</div>
      <div data-testid="instances-loaded">Instances Loaded</div>
      <div data-testid="catalog-loaded">Catalog Loaded</div>
    </div>
  );
}

describe('ProviderInstanceProvider', () => {
  const mockInstances = [
    {
      id: 'test-instance-1',
      displayName: 'Test Instance 1',
      catalogProviderId: 'openai',
      endpoint: null,
      timeout: 30000,
      retryPolicy: null,
      hasCredentials: true,
    },
    {
      id: 'test-instance-2',
      displayName: 'Test Instance 2',
      catalogProviderId: 'anthropic',
      endpoint: null,
      timeout: 30000,
      retryPolicy: null,
      hasCredentials: false,
    },
  ];

  const mockCatalogProviders = [
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'OpenAI API',
      logoUrl: 'https://example.com/openai-logo.png',
      website: 'https://openai.com',
      models: [],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Anthropic Claude API',
      logoUrl: 'https://example.com/anthropic-logo.png',
      website: 'https://anthropic.com',
      models: [],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful API responses
    mockApi.get.mockImplementation(async (url: string) => {
      if (url === '/api/provider/instances') {
        return { instances: mockInstances };
      }
      if (url === '/api/provider/catalog') {
        return { providers: mockCatalogProviders };
      }
      throw new Error(`Unexpected API call: ${url}`);
    });
  });

  it('should load and provide instances and catalog data', async () => {
    render(
      <ProviderInstanceProvider>
        <TestConsumer />
      </ProviderInstanceProvider>
    );

    // Should start with loading state
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByTestId('instances-loaded')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('catalog-loaded')).toBeInTheDocument();
    });

    // Verify correct data is provided
    expect(screen.getByTestId('instance-count')).toHaveTextContent('2');
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('2');

    // Verify API calls were made
    expect(mockApi.get).toHaveBeenCalledWith('/api/provider/instances');
    expect(mockApi.get).toHaveBeenCalledWith('/api/provider/catalog');
  });

  it('should handle API failures gracefully', async () => {
    // Mock API failure
    mockApi.get.mockRejectedValue(new Error('Network error'));

    render(
      <ProviderInstanceProvider>
        <TestConsumer />
      </ProviderInstanceProvider>
    );

    // Should eventually stop loading even on error
    await waitFor(
      () => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
      },
      { timeout: 1000 }
    );

    // Should provide empty arrays on error
    expect(screen.getByTestId('instance-count')).toHaveTextContent('0');
    expect(screen.getByTestId('catalog-count')).toHaveTextContent('0');
  });

  it('should make provider instances available through context', async () => {
    function InstanceChecker() {
      const { instances, getInstanceById } = useProviderInstances();

      const instance = getInstanceById('test-instance-1');

      return (
        <div>
          <div data-testid="total-instances">{instances.length}</div>
          <div data-testid="found-instance">{instance ? 'Found' : 'Not Found'}</div>
          <div data-testid="instance-display-name">{instance?.displayName || 'None'}</div>
        </div>
      );
    }

    render(
      <ProviderInstanceProvider>
        <InstanceChecker />
      </ProviderInstanceProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('total-instances')).toHaveTextContent('2');
    });

    expect(screen.getByTestId('found-instance')).toHaveTextContent('Found');
    expect(screen.getByTestId('instance-display-name')).toHaveTextContent('Test Instance 1');
  });
});
