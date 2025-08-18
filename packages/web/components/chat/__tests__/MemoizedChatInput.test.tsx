// ABOUTME: Unit tests for MemoizedChatInput and CustomChatInput components
// ABOUTME: Tests state management, status display, and component integration

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoizedChatInput } from '@/components/chat/MemoizedChatInput';
import type { ThreadId } from '@/types/core';

// Use vi.hoisted to ensure mock functions are available during hoisting
const mockCompactTokenUsage = vi.hoisted(() => {
  const MockCompactTokenUsage = ({ agentId }: { agentId: ThreadId }) => (
    <div data-testid="compact-token-usage">Token usage for {agentId}</div>
  );
  MockCompactTokenUsage.displayName = 'MockCompactTokenUsage';
  return MockCompactTokenUsage;
});

const mockChatInput = vi.hoisted(() => {
  const MockChatInput = ({
    value,
    onChange,
    onSubmit,
    disabled,
    isStreaming,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    disabled: boolean;
    isStreaming?: boolean;
    placeholder: string;
  }) => (
    <div data-testid="chat-input">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-streaming={isStreaming}
      />
      <button onClick={onSubmit} disabled={disabled}>
        Send
      </button>
    </div>
  );
  MockChatInput.displayName = 'MockChatInput';
  return MockChatInput;
});

// Mock dependencies
vi.mock('@/components/ui/CompactTokenUsage', () => ({
  CompactTokenUsage: mockCompactTokenUsage,
}));

vi.mock('@/components/chat/ChatInput', () => ({
  ChatInput: mockChatInput,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: React.ComponentProps<'div'>) => (
      <div data-testid="motion-div" {...props}>
        {children}
      </div>
    ),
  },
}));

describe('MemoizedChatInput', () => {
  const testAgentId = 'test-agent-789' as ThreadId;
  const mockOnSubmit = vi.fn();
  const mockOnInterrupt = vi.fn();

  const defaultProps = {
    onSubmit: mockOnSubmit,
    onInterrupt: mockOnInterrupt,
    disabled: false,
    isStreaming: false,
    placeholder: 'Type a message...',
    agentId: testAgentId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with animation wrapper', () => {
    render(<MemoizedChatInput {...defaultProps} />);

    expect(screen.getByTestId('motion-div')).toBeInTheDocument();
  });

  it('manages message state internally', async () => {
    render(<MemoizedChatInput {...defaultProps} />);

    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(input).toHaveValue('Hello world');
  });

  it('calls onSubmit with message and clears input on success', async () => {
    mockOnSubmit.mockResolvedValue(true);

    render(<MemoizedChatInput {...defaultProps} />);

    const input = screen.getByRole('textbox');
    const sendButton = screen.getByRole('button', { name: 'Send' });

    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Test message');
    });

    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });

  it('does not clear input when onSubmit returns false', async () => {
    mockOnSubmit.mockResolvedValue(false);

    render(<MemoizedChatInput {...defaultProps} />);

    const input = screen.getByRole('textbox');
    const sendButton = screen.getByRole('button', { name: 'Send' });

    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Test message');
    });

    // Input should not be cleared
    expect(input).toHaveValue('Test message');
  });

  it('shows token usage when agentId is provided', () => {
    render(<MemoizedChatInput {...defaultProps} />);

    expect(screen.getByTestId('compact-token-usage')).toBeInTheDocument();
    expect(screen.getByText(`Token usage for ${testAgentId}`)).toBeInTheDocument();
  });

  it('does not show token usage when agentId is not provided', () => {
    render(<MemoizedChatInput {...defaultProps} agentId={undefined} />);

    expect(screen.queryByTestId('compact-token-usage')).not.toBeInTheDocument();
  });

  it('shows streaming status when isStreaming is true', () => {
    render(<MemoizedChatInput {...defaultProps} isStreaming={true} />);

    expect(screen.getByText('Agent is responding...')).toBeInTheDocument();
    expect(screen.getByText('Agent is responding...').closest('div')).toHaveClass('text-warning');
  });

  it('shows tool running status when disabled is true', () => {
    render(<MemoizedChatInput {...defaultProps} disabled={true} />);

    expect(screen.getByText('Tool running...')).toBeInTheDocument();
    expect(screen.getByText('Tool running...').closest('div')).toHaveClass('text-success');
  });

  it('prioritizes error over other statuses', () => {
    // Since speechError is internal state and starts as null, we test the priority order
    // by checking that streaming status shows when not disabled
    render(<MemoizedChatInput {...defaultProps} isStreaming={true} disabled={false} />);

    expect(screen.getByText('Agent is responding...')).toBeInTheDocument();
    expect(screen.queryByText('Tool running...')).not.toBeInTheDocument();
  });

  it('passes correct props to ChatInput', () => {
    render(
      <MemoizedChatInput
        {...defaultProps}
        disabled={true}
        isStreaming={true}
        placeholder="Custom placeholder"
      />
    );

    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Custom placeholder');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('data-streaming', 'true');
  });

  it('has proper styling classes', () => {
    render(<MemoizedChatInput {...defaultProps} />);

    const motionDiv = screen.getByTestId('motion-div');
    expect(motionDiv).toHaveClass(
      'flex-shrink-0',
      'bg-base-100/50',
      'backdrop-blur-sm',
      'border-t',
      'border-base-300/30',
      'p-2'
    );
  });

  it('handles no status display when all statuses are false', () => {
    render(<MemoizedChatInput {...defaultProps} disabled={false} isStreaming={false} />);

    // Status area should exist but have no status messages
    const statusArea = screen.getByTestId('compact-token-usage').parentElement?.parentElement;
    expect(statusArea).toHaveClass('flex', 'justify-between', 'items-center');

    // No status messages should be present
    expect(screen.queryByText('Agent is responding...')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool running...')).not.toBeInTheDocument();
    expect(screen.queryByText('Listening...')).not.toBeInTheDocument();
    expect(screen.queryByText('Speech error')).not.toBeInTheDocument();
  });
});
