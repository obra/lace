// ABOUTME: Tests for chat input refocus functionality
// ABOUTME: Verifies that chat input refocuses after successful message send

import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { ChatInput } from '@/components/chat/ChatInput';
import { ScrollProvider } from '@/components/providers/ScrollProvider';
import React from 'react';

describe('ChatInput Refocus', () => {
  it('should expose focus method via ref', () => {
    const ref = React.createRef<{ focus: () => void }>();

    render(
      <ChatInput
        ref={ref}
        value="test message"
        onChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => Promise<boolean | void>>()}
      />,
      { wrapper: ({ children }) => <ScrollProvider>{children}</ScrollProvider> }
    );

    // Should have focus method available
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current?.focus).toBe('function');
  });

  it('should focus textarea when focus method is called', async () => {
    const ref = React.createRef<{ focus: () => void }>();

    render(
      <ChatInput
        ref={ref}
        value="test message"
        onChange={vi.fn<(value: string) => void>()}
        onSubmit={vi.fn<() => Promise<boolean | void>>()}
        disabled={false} // Allow focus for testing
      />,
      { wrapper: ({ children }) => <ScrollProvider>{children}</ScrollProvider> }
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Initially not focused
    expect(document.activeElement).not.toBe(textarea);

    // Ensure element is in DOM tree before focusing
    expect(textarea.isConnected).toBe(true);

    // Call focus method
    ref.current?.focus();

    // Small delay to allow focus to take effect in JSDOM
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should now be focused
    expect(document.activeElement).toBe(textarea);
  });
});
