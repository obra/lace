// ABOUTME: Integration tests for AgentCreateChatModal message flow
// ABOUTME: Tests initial message handling and agent creation coordination

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

describe('AgentCreateChatModal - Message Flow', () => {
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

  it('should create agent without message when form submitted empty', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: undefined, // No message
      });
    });
  });

  it('should create agent with message when text entered', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter a message
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Help me debug this code!' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Help me debug this code!',
      });
    });
  });

  it('should handle message sending via CondensedChatInput send button', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter a message
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Quick message' } });

    // Use the CondensedChatInput's send button (different from modal's button)
    const condensedSendButton = screen.getByTestId('condensed-send-button');
    fireEvent.click(condensedSendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Quick message',
      });
    });
  });

  it('should handle message sending via Enter key in CondensedChatInput', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter a message and press Enter
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Enter key message' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Enter key message',
      });
    });
  });

  it('should trim whitespace from initial message', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter message with leading/trailing whitespace
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: '  Hello world!  ' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: 'Hello world!', // Trimmed
      });
    });
  });

  it('should not send message when only whitespace entered', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter only whitespace
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: '   \n  \t  ' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: undefined, // No message sent when only whitespace
      });
    });
  });

  it('should handle multi-line initial messages', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatModal {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    // Enter multi-line message
    const multiLineMessage = 'Line 1\nLine 2\nLine 3';
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: multiLineMessage } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'default',
        providerInstanceId: 'anthropic-1',
        modelId: 'claude-3',
        initialMessage: multiLineMessage,
      });
    });
  });

  it('should show different button text based on message content', () => {
    render(<AgentCreateChatModal {...defaultProps} />);

    // Initially should show "Create Agent"
    expect(screen.getByText('Create Agent')).toBeInTheDocument();

    // Enter a message
    const input = screen.getByPlaceholderText('Type a message (optional)...');
    fireEvent.change(input, { target: { value: 'Hello!' } });

    // Should now show "Send"
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.queryByText('Create Agent')).not.toBeInTheDocument();
  });
});
