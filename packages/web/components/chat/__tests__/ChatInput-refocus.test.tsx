// ABOUTME: Tests for chat input refocus functionality
// ABOUTME: Verifies that chat input refocuses after successful message send

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ChatInput } from '@/components/chat/ChatInput';
import { ScrollProvider } from '@/components/providers/ScrollProvider';
import React from 'react';

describe('ChatInput Refocus', () => {
  it('should expose focus method via ref', () => {
    const ref = React.createRef<{ focus: () => void }>();

    render(
      <ScrollProvider>
        <ChatInput ref={ref} value="test message" onChange={vi.fn()} onSubmit={vi.fn()} />
      </ScrollProvider>
    );

    // Should have focus method available
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.focus).toBe('function');
  });

  it('should focus textarea when focus method is called', () => {
    const ref = React.createRef<{ focus: () => void }>();

    render(
      <ScrollProvider>
        <ChatInput
          ref={ref}
          value="test message"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          disabled={true} // Disable autofocus
        />
      </ScrollProvider>
    );

    const textarea = screen.getByTestId('message-input') as HTMLTextAreaElement;

    // Initially not focused due to disabled
    expect(document.activeElement).not.toBe(textarea);

    // Call focus method
    ref.current?.focus();

    // Should now be focused
    expect(document.activeElement).toBe(textarea);
  });
});
