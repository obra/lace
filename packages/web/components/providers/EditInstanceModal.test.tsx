// ABOUTME: Tests for EditInstanceModal component
// ABOUTME: Verifies form behavior, validation, and API integration

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInstanceModal } from './EditInstanceModal';
import { ProviderInstanceProvider } from './ProviderInstanceProvider';
import { stringify } from '@/lib/serialization';

// Mock the serialization utility
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn(),
  stringify: vi.fn((data) => JSON.stringify(data)),
}));

// Mock UI components to focus on logic
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));

vi.mock('@/components/ui/Badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const mockParseResponse = vi.mocked((await import('@/lib/serialization')).parseResponse);

interface MockInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  endpoint?: string;
  hasCredentials: boolean;
}

describe('EditInstanceModal', () => {
  const mockInstance: MockInstance = {
    id: 'test-instance',
    displayName: 'Test Instance',
    catalogProviderId: 'openai',
    endpoint: 'https://api.openai.com/v1',
    hasCredentials: true,
  };

  const defaultProps = {
    isOpen: true,
    instance: mockInstance,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  // Helper to render with provider
  const renderWithProvider = async (props = defaultProps) => {
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(
        <ProviderInstanceProvider>
          <EditInstanceModal {...props} />
        </ProviderInstanceProvider>
      );
    });
    return result!;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock parseResponse to return proper data structures
    mockParseResponse.mockImplementation(async (response: Response) => {
      const url = response.url || '';
      if (url.includes('/api/provider/instances')) {
        return { instances: [] };
      }
      if (url.includes('/api/provider/catalog')) {
        return { providers: [] };
      }
      return {};
    });

    // Setup default fetch mock for provider initialization
    global.fetch = vi.fn().mockImplementation((url) => {
      return Promise.resolve({
        ok: true,
        status: 200,
        url: url,
        text: () => Promise.resolve(''),
        json: () => Promise.resolve({}),
        clone: function () {
          return this;
        },
      } as Response);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render edit form with current instance values', async () => {
    await renderWithProvider();

    expect(screen.getByDisplayValue('Test Instance')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByText('openai')).toBeInTheDocument(); // read-only provider badge
  });

  it('should update instance configuration without credential', async () => {
    const user = userEvent.setup();

    // Mock successful API response
    const mockUpdatedInstance = {
      ...mockInstance,
      displayName: 'Updated Instance Name',
    };

    mockParseResponse.mockResolvedValue({
      instance: mockUpdatedInstance,
    });

    const mockFetch = vi.fn().mockImplementation((url) => {
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
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(stringify({})),
        clone: function () {
          return this;
        },
      } as Response);
    }) as unknown as typeof fetch;
    global.fetch = mockFetch;

    await renderWithProvider();

    // Update display name
    const nameInput = screen.getByDisplayValue('Test Instance');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Instance Name');

    // Update endpoint
    const endpointInput = screen.getByDisplayValue('https://api.openai.com/v1');
    fireEvent.change(endpointInput, { target: { value: 'https://custom.api.com' } });

    // Submit form
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/provider/instances/test-instance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Updated Instance Name',
          endpoint: 'https://custom.api.com',
          timeout: 30,
        }),
      });
    });

    expect(defaultProps.onSuccess).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should update instance with new credential', async () => {
    const user = userEvent.setup();

    mockParseResponse.mockResolvedValue({
      instance: mockInstance,
    });

    global.fetch = vi.fn().mockImplementation((url) => {
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
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(stringify({})),
        clone: function () {
          return this;
        },
      } as Response);
    }) as unknown as typeof fetch;

    await renderWithProvider();

    // Update API key
    const apiKeyInput = screen.getByPlaceholderText(/leave empty to keep current/i);
    await user.type(apiKeyInput, 'new-api-key');

    // Submit form
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/provider/instances/test-instance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Test Instance',
          endpoint: 'https://api.openai.com/v1',
          timeout: 30,
          credential: { apiKey: 'new-api-key' },
        }),
      });
    });
  });

  it('should validate required fields', async () => {
    const user = userEvent.setup();

    await renderWithProvider();

    // Clear required display name
    const nameInput = screen.getByDisplayValue('Test Instance');
    await user.clear(nameInput);

    // Submit form
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    // Should not make API call to update instance (only the initial loads for instances and catalog)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith('/api/provider/instances', { method: 'GET' });
    expect(global.fetch).toHaveBeenCalledWith('/api/provider/catalog', { method: 'GET' });

    // Form should show validation state (HTML5 validation)
    expect(nameInput).toBeInvalid();
  });

  it('should handle API errors gracefully', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockParseResponse
      .mockRejectedValueOnce(new Error('Instance validation failed')) // For the initial instances loading error
      .mockRejectedValueOnce(new Error('Invalid JSON')); // For the update error response parsing attempt

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url === '/api/provider/instances') {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Instance validation failed',
          text: () => Promise.resolve('Instance validation failed'),
          clone: function () {
            return this;
          },
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Instance validation failed',
        text: () => Promise.resolve('Instance validation failed'),
        clone: function () {
          return this;
        },
      } as Response);
    }) as unknown as typeof fetch;

    await renderWithProvider();

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/HTTP 400: Instance validation failed/i)).toBeInTheDocument();
    });

    // Verify that error logging occurred for both instance loading and updating
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error loading instances:',
      'HTTP 400: Instance validation failed'
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error updating instance:',
      'HTTP 400: Instance validation failed'
    );

    // Should not close modal on error
    expect(defaultProps.onClose).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should not render when closed', async () => {
    await renderWithProvider({ ...defaultProps, isOpen: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should close modal on cancel', async () => {
    const user = userEvent.setup();

    await renderWithProvider();

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should show loading state during submission', async () => {
    const user = userEvent.setup();

    // Mock delayed response
    global.fetch = vi.fn().mockImplementation((url) => {
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
      return new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              text: () => Promise.resolve(stringify({})),
              clone: function () {
                return this;
              },
            } as Response),
          100
        )
      );
    }) as unknown as typeof fetch;

    mockParseResponse.mockResolvedValue({ instance: mockInstance });

    await renderWithProvider();

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    // Should show loading state
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });
});
