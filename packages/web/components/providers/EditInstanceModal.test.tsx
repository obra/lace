// ABOUTME: Tests for EditInstanceModal component
// ABOUTME: Verifies form behavior, validation, and API integration

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditInstanceModal } from './EditInstanceModal';

// Mock the serialization utility
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn()
}));

// Mock UI components to focus on logic
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) => 
    isOpen ? <div role="dialog">{children}</div> : null
}));

vi.mock('@/components/ui/Badge', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}));

const mockParseResponse = vi.mocked((await import('@/lib/serialization')).parseResponse);

interface MockInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  endpoint?: string;
  timeout?: number;
  hasCredentials: boolean;
}

describe('EditInstanceModal', () => {
  const mockInstance: MockInstance = {
    id: 'test-instance',
    displayName: 'Test Instance',
    catalogProviderId: 'openai',
    endpoint: 'https://api.openai.com/v1',
    timeout: 30000,
    hasCredentials: true
  };

  const defaultProps = {
    isOpen: true,
    instance: mockInstance,
    onClose: vi.fn(),
    onSuccess: vi.fn()
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render edit form with current instance values', async () => {
    render(<EditInstanceModal {...defaultProps} />);

    expect(screen.getByDisplayValue('Test Instance')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('30')).toBeInTheDocument(); // timeout in seconds
    expect(screen.getByText('openai')).toBeInTheDocument(); // read-only provider badge
  });

  it('should update instance configuration without credential', async () => {
    const user = userEvent.setup();
    
    // Mock successful API response
    const mockUpdatedInstance = {
      ...mockInstance,
      displayName: 'Updated Instance Name',
      timeout: 60000
    };
    
    mockParseResponse.mockResolvedValue({
      instance: mockUpdatedInstance
    });
    
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });
    global.fetch = mockFetch;

    render(<EditInstanceModal {...defaultProps} />);

    // Update display name
    const nameInput = screen.getByDisplayValue('Test Instance');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Instance Name');

    // Update timeout - use fireEvent for more reliable input
    const timeoutInput = screen.getByDisplayValue('30');
    fireEvent.change(timeoutInput, { target: { value: '60' } });

    // Submit form
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/provider/instances/test-instance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Updated Instance Name',
          endpoint: 'https://api.openai.com/v1',
          timeout: 60000
        })
      });
    });

    expect(defaultProps.onSuccess).toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should update instance with new credential', async () => {
    const user = userEvent.setup();
    
    mockParseResponse.mockResolvedValue({
      instance: mockInstance
    });
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });

    render(<EditInstanceModal {...defaultProps} />);

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
          timeout: 30000,
          credential: { apiKey: 'new-api-key' }
        })
      });
    });
  });

  it('should validate required fields', async () => {
    const user = userEvent.setup();
    
    render(<EditInstanceModal {...defaultProps} />);

    // Clear required display name
    const nameInput = screen.getByDisplayValue('Test Instance');
    await user.clear(nameInput);

    // Submit form
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    // Should not make API call
    expect(global.fetch).not.toHaveBeenCalled();
    
    // Form should show validation state (HTML5 validation)
    expect(nameInput).toBeInvalid();
  });

  it('should handle API errors gracefully', async () => {
    const user = userEvent.setup();
    
    mockParseResponse.mockResolvedValue({
      error: 'Instance validation failed'
    });
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400
    });

    render(<EditInstanceModal {...defaultProps} />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/instance validation failed/i)).toBeInTheDocument();
    });

    // Should not close modal on error
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });

  it('should not render when closed', () => {
    render(<EditInstanceModal {...defaultProps} isOpen={false} />);
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should close modal on cancel', async () => {
    const user = userEvent.setup();
    
    render(<EditInstanceModal {...defaultProps} />);

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    await user.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should show loading state during submission', async () => {
    const user = userEvent.setup();
    
    // Mock delayed response
    global.fetch = vi.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        status: 200
      }), 100))
    );
    
    mockParseResponse.mockResolvedValue({ instance: mockInstance });

    render(<EditInstanceModal {...defaultProps} />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);

    // Should show loading state
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    expect(saveButton).toBeDisabled();
  });
});