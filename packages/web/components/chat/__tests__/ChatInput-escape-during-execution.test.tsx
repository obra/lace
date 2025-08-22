// ABOUTME: Tests for chat input during agent execution
// ABOUTME: Verifies that input stays enabled and Escape key works when agent is busy

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ChatInput } from '@/components/chat/ChatInput';
import React from 'react';

describe('ChatInput during agent execution', () => {
  it('should allow typing when sendDisabled is true', () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
        sendDisabled={true} // Agent is busy
        isStreaming={true}
      />
    );

    const textarea = screen.getByTestId('message-input') as HTMLTextAreaElement;

    // Input should NOT be disabled (user can type)
    expect(textarea.disabled).toBe(false);
  });

  it('should disable send button when sendDisabled is true', () => {
    render(
      <ChatInput
        value="test message"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
        sendDisabled={true} // Agent is busy
        isStreaming={false} // Not streaming (so button would normally be enabled)
      />
    );

    const sendButton = screen.getByTestId('send-button') as HTMLButtonElement;

    // Send button should be disabled when sendDisabled is true
    expect(sendButton.disabled).toBe(true);
  });

  it('should call onInterrupt when Escape is pressed during streaming', () => {
    const onInterrupt = vi.fn();

    render(
      <ChatInput
        value="test message"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
        sendDisabled={true}
        isStreaming={true}
        onInterrupt={onInterrupt}
      />
    );

    const textarea = screen.getByTestId('message-input');

    // Press Escape key
    fireEvent.keyDown(textarea, { key: 'Escape' });

    // Should call onInterrupt
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('should enable send button when streaming (for stop functionality)', () => {
    render(
      <ChatInput
        value=""
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        disabled={false}
        sendDisabled={true} // Agent is busy
        isStreaming={true} // Streaming - should enable stop button
      />
    );

    const sendButton = screen.getByTestId('stop-button') as HTMLButtonElement;

    // Button should be enabled during streaming for stop functionality
    expect(sendButton.disabled).toBe(false);
  });
});
