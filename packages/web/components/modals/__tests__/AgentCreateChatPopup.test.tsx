// ABOUTME: Tests for AgentCreateChatPopup component (new UX design)
// ABOUTME: Tests popup positioning, simplified form, and navigation behavior

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AgentCreateChatPopup } from '@/components/modals/AgentCreateChatPopup';

const mockPersonas = [
  { name: 'lace', isUserDefined: false, path: 'lace.md' },
  { name: 'session-summary', isUserDefined: false, path: 'session-summary.md' },
];

describe('AgentCreateChatPopup', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCreateAgent: vi.fn(),
    personas: mockPersonas,
    defaultPersonaName: 'lace',
    anchorRef: { current: document.createElement('button') },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render as popup without modal overlay', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    // Should not have modal backdrop
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('should not render "Who are you messaging" label', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    expect(screen.queryByText('Who are you messaging?')).not.toBeInTheDocument();
  });

  it('should not include model selector', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    expect(screen.queryByText('Model')).not.toBeInTheDocument();
    expect(screen.queryByText('Select model')).not.toBeInTheDocument();
  });

  it('should show persona selector without label', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    expect(screen.getByTestId('persona-selector-trigger')).toBeInTheDocument();
    expect(screen.getByText('lace')).toBeInTheDocument();
  });

  it('should have taller message input by default', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    const messageInput = screen.getByRole('textbox');
    const styles = window.getComputedStyle(messageInput);

    // Should have larger initial height
    expect(parseInt(styles.minHeight)).toBeGreaterThan(36); // Larger than CondensedChatInput
  });

  it('should call onCreateAgent without model parameters', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatPopup {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'lace',
        initialMessage: undefined,
        // No provider/model parameters
      });
    });
  });

  it('should include initial message when provided', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);

    render(<AgentCreateChatPopup {...defaultProps} onCreateAgent={mockOnCreateAgent} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello there!' } });

    const sendButton = screen.getByTestId('create-agent-send-button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnCreateAgent).toHaveBeenCalledWith({
        personaName: 'lace',
        initialMessage: 'Hello there!',
      });
    });
  });

  it('should be positioned relative to anchor element', () => {
    const anchorElement = document.createElement('button');
    document.body.appendChild(anchorElement);

    render(<AgentCreateChatPopup {...defaultProps} anchorRef={{ current: anchorElement }} />);

    const popup = screen.getByTestId('agent-create-popup');
    expect(popup).toHaveClass('absolute'); // Should be absolutely positioned
    expect(popup).not.toHaveClass('fixed'); // Not fixed like modals

    document.body.removeChild(anchorElement);
  });

  it('should enable send button when persona selected', () => {
    render(<AgentCreateChatPopup {...defaultProps} defaultPersonaName="lace" />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).not.toBeDisabled();
  });

  it('should always enable send button since lace is always default', () => {
    render(<AgentCreateChatPopup {...defaultProps} defaultPersonaName={undefined} />);

    const sendButton = screen.getByTestId('create-agent-send-button');
    expect(sendButton).not.toBeDisabled(); // Always enabled since lace is default
    expect(screen.getByText('lace')).toBeInTheDocument(); // Should show lace
  });

  it('should show "Send" when message entered, "Create Agent" when empty', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    // Initially should show "Create Agent"
    expect(screen.getByText('Create Agent')).toBeInTheDocument();

    // Enter a message
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hello!' } });

    // Should now show "Send"
    expect(screen.getByText('Send')).toBeInTheDocument();
    expect(screen.queryByText('Create Agent')).not.toBeInTheDocument();
  });

  it('should close popup and call onCreateAgent when send clicked', async () => {
    const mockOnCreateAgent = vi.fn().mockResolvedValue(undefined);
    const mockOnClose = vi.fn();

    render(
      <AgentCreateChatPopup
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

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should handle persona selection', () => {
    render(<AgentCreateChatPopup {...defaultProps} />);

    // Click persona selector
    fireEvent.click(screen.getByTestId('persona-selector-trigger'));

    // Select different persona
    fireEvent.click(screen.getByTestId('persona-option-session-summary'));

    // Should show new selection
    expect(screen.getByText('session-summary')).toBeInTheDocument();
  });
});
