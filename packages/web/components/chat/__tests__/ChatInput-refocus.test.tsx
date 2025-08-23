// ABOUTME: Tests for chat input focus handle functionality
// ABOUTME: Validates that focus handle exists and calling it focuses the textarea

import { render, screen, waitFor } from '@testing-library/react';
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
        onSubmit={vi.fn<() => void | Promise<void>>()}
      />,
      { wrapper: ScrollProvider }
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
        onSubmit={vi.fn<() => void | Promise<void>>()}
        disabled={false} // Allow focus for testing
      />,
      { wrapper: ScrollProvider }
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Ensure textarea is not focused initially by blurring it
    textarea.blur();
    await waitFor(() => expect(document.activeElement).not.toBe(textarea));

    // Test the core behavior: focus method should focus the textarea
    ref.current?.focus();

    // The textarea should be focused after calling focus method
    await waitFor(() => expect(document.activeElement).toBe(textarea));
  });
});
