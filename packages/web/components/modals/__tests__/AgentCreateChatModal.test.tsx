// ABOUTME: Unit tests for AgentCreateChatModal component
// ABOUTME: Tests chat-widget style modal for creating new agents

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentCreateChatModal } from '../AgentCreateChatModal';

const mockPersonas = [
  { name: 'default', isUserDefined: false, path: 'default.md' },
  { name: 'code-reviewer', isUserDefined: false, path: 'code-reviewer.md' },
];

const mockProviders = [
  {
    instanceId: 'anthropic-1',
    displayName: 'Anthropic',
    configured: true,
    models: [{ id: 'claude-3', displayName: 'Claude 3' }],
  },
];

describe('AgentCreateChatModal', () => {
  const defaultProps = {
    isOpen: false,
    onClose: vi.fn(),
    onCreateAgent: vi.fn(),
    personas: mockPersonas,
    providers: mockProviders,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render when isOpen is false', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('New Agent')).not.toBeInTheDocument();
  });

  it('should render when isOpen is true', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText('New Agent')).toBeInTheDocument();
    expect(screen.getByText('Who are you messaging?')).toBeInTheDocument();
  });

  it('should render with smart defaults', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    // Should show defaults selected
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('should show persona selector', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    expect(screen.getByTestId('persona-selector-trigger')).toBeInTheDocument();
  });

  it('should show message input', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    expect(screen.getByPlaceholderText('Type a message (optional)...')).toBeInTheDocument();
  });

  it('should show model selector', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  it('should show create agent button', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    expect(screen.getByTestId('create-agent-send-button')).toBeInTheDocument();
  });

  it('should disable send button when required fields missing', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).toBeDisabled();
  });

  it('should enable send button when all required fields filled', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).not.toBeDisabled();
  });

  it('should show "Create Agent" text when no message', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    expect(screen.getByText('Create Agent')).toBeInTheDocument();
  });

  it('should show "Send" text when message entered', () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Hello!' } });

    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  it('should call onCreateAgent with correct data when form submitted', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        onCreateAgent={mockOnCreateAgent}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: undefined,
      });
    });
  });

  it('should include initial message when provided', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        onCreateAgent={mockOnCreateAgent}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Hello there!' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Hello there!',
      });
    });
  });

  it('should close modal after successful creation', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);
    const mockOnClose = vi.fn();

    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        onCreateAgent={mockOnCreateAgent}
        onClose={mockOnClose}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  it('should show loading state during creation', async () => {
    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        creating={true}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    expect(screen.getByText('Creating...')).toBeInTheDocument();
    expect(screen.getByTestId('create-agent-send-button')).toBeDisabled();
  });

  it('should reset form when modal opens', () => {
    const { rerender } = render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={false}
        defaultPersonaName="code-reviewer"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    // Open modal
    rerender(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        defaultPersonaName="code-reviewer"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    // Should show defaults
    expect(screen.getByText('code-reviewer')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message (optional)...')).toHaveValue('');
  });

  it('should handle creation error gracefully', async () => {
    const mockOnCreateAgent = vi.fn().mockRejectedValue(new Error('Creation failed'));
    const mockOnClose = vi.fn();

    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        onCreateAgent={mockOnCreateAgent}
        onClose={mockOnClose}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalled();
    });

    // Modal should NOT close on error
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should allow persona selection change', () => {
    render(<AgentCreateChatModal {...defaultProps} isOpen={true} defaultPersonaName="default" />);

    // Click persona selector
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));

    // Select different persona
    fireEvent.click(screen.getByTestId('persona-option-code-reviewer'));

    // Should show new selection
    expect(screen.getByText('code-reviewer')).toBeInTheDocument();
  });

  it('should handle send button click from CondensedChatInput', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentCreateChatModal
        {...defaultProps}
        isOpen={true}
        onCreateAgent={mockOnCreateAgent}
        defaultPersonaName="default"
        defaultProviderInstanceId="anthropic-1"
        defaultModelId="claude-3"
      />
    );

    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Test message' } });

    // Use CondensedChatInput's send button
    const condensedSendButton = screen.getByTestId('condensed-send-button');
    fireEvent.click(condensedSendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Test message',
      });
    });
  });
});
