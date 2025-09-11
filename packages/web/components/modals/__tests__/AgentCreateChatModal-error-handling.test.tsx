// ABOUTME: Error handling and loading state tests for AgentCreateChatModal
// ABOUTME: Tests failure scenarios, loading states, and graceful degradation

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentCreateChatModal } from '../AgentCreateChatModal';

const mockPersonas = [{ name: 'default', isUserDefined: false, path: 'default.md' }];

const mockProviders = [
  {
    instanceId: 'anthropic-1',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-3', displayName: 'Claude 3' }],
  },
];

describe('AgentCreateChatModal - Error Handling and Loading States', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreateAgent: vi.fn(),
    personas: mockPersonas,
    providers: mockProviders,
    defaultPersonaName: 'default',
    defaultProviderInstanceId: 'anthropic-1',
    defaultModelId: 'claude-3',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state when creating is true', () => {
    render(<AgentCreateChatModal {...defaultProps} creating={true} />);

    expect(screen.getByText('Creating...')).toBeInTheDocument();
    expect(screen.getByTestId('create-agent-send-button')).toBeDisabled();

    // Should show loading spinner
    const loadingSpinner = screen
      .getByTestId('create-agent-send-button')
      .querySelector('.loading-spinner');
    expect(loadingSpinner).toBeInTheDocument();
  });

  it('should disable input when creating is true', () => {
    render(<AgentCreateChatModal {...defaultProps} creating={true} />);

    const input = screen.getByPlaceholderText('Type a message (optional)...');
    expect(input).toBeDisabled();
  });

  it('should not close modal when agent creation fails', async () => {
    const mockOnCreateAgent = vi.fn().mockRejectedValue(new Error('Network error'));
    const mockOnClose = vi.fn();

    render(
      <AgentCreateChatModal
        {...defaultProps}
        onCreateAgent={mockOnCreateAgent}
        onClose={mockOnClose}
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalled();
    });

    // Wait a bit more to ensure onClose isn't called
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Modal should NOT close on error
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should handle API timeout errors gracefully', async () => {
    const mockOnCreateAgent = vi.fn().mockRejectedValue(new Error('Request timeout'));

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalled();
    });

    // Modal should remain open for user to retry
    expect(screen.getByTestId('create-agent-send-button')).toBeInTheDocument();
  });

  it('should handle validation errors gracefully', async () => {
    const mockOnCreateAgent = vi.fn().mockRejectedValue(new Error('Validation failed'));

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalled();
    });

    // Should keep form intact for user to fix and retry
    expect(screen.getByTestId('persona-selector-trigger')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message (optional)...')).toBeInTheDocument();
  });

  it('should handle empty providers list gracefully', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        providers={[]} // No providers available
        defaultProviderInstanceId={undefined}
        defaultModelId={undefined}
      />
    );

    // Should still render but disable creation
    expect(screen.getByText('Who are you messaging?')).toBeInTheDocument();
    expect(screen.getByTestId('create-agent-send-button')).toBeDisabled();
  });

  it('should handle empty personas list gracefully', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        personas={[]} // No personas available
      />
    );

    // Should still render modal
    expect(screen.getByText('Who are you messaging?')).toBeInTheDocument();

    // Persona selector should handle empty list
    expect(screen.getByTestId('persona-selector-trigger')).toBeInTheDocument();
  });

  it('should handle providers without models gracefully', () => {
    const providersWithoutModels = [
      {
        instanceId: 'broken-provider',
        displayName: 'Broken Provider',
        configured: true,
        models: [], // No models available
      },
    ];

    render(
      <AgentCreateChatModal
        {...defaultProps}
        providers={providersWithoutModels}
        defaultProviderInstanceId={undefined}
        defaultModelId={undefined}
      />
    );

    // Should disable creation when no models available
    expect(screen.getByTestId('create-agent-send-button')).toBeDisabled();
  });

  it('should show loading spinner in button during creation', () => {
    render(<AgentCreateChatModal {...defaultProps} creating={true} />);

    const button = screen.getByTestId('create-agent-send-button');
    const spinner = button.querySelector('.loading-spinner');

    expect(spinner).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it('should prevent double submission during creation', async () => {
    const mockOnCreateAgent = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');

    // Click multiple times rapidly
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledTimes(1);
    });
  });

  it('should maintain form state after creation error', async () => {
    const mockOnCreateAgent = vi.fn().mockRejectedValue(new Error('Server error'));

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Fill form
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Test message' } });

    // Submit and fail
    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalled();
    });

    // Form state should be preserved for retry
    expect(screen.getByDisplayValue('Test message')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('should allow retry after creation failure', async () => {
    const mockOnCreateAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error('First attempt failed'))
      .mockResolvedValueOnce(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');

    // First attempt - should fail
    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledTimes(1);
    });

    // Second attempt - should succeed
    fireEvent.click(sendButton);
    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledTimes(2);
    });
  });
});
