// ABOUTME: Unit tests for ChatInput window focus behavior
// ABOUTME: Tests that textarea refocuses when browser window regains focus

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatInput } from '@/components/chat/ChatInput';

// Mock FontAwesome components
vi.mock('@/lib/fontawesome', () => ({
  faPaperPlane: 'faPaperPlane',
  faStop: 'faStop',
  faPlus: 'faPlus',
}));

vi.mock('@fortawesome/react-fontawesome', () => ({
  FontAwesomeIcon: ({ icon }: { icon: string }) => <span data-testid={`icon-${icon}`} />,
}));

// Mock speech recognition components
vi.mock('@/components/ui/NativeSpeechInput', () => ({
  NativeSpeechInput: () => <div data-testid="speech-input" />,
  useSpeechRecognition: () => ({
    transcript: '',
    isListening: false,
    error: null,
    status: 'idle',
    handleTranscript: vi.fn(),
    handleError: vi.fn(),
    handleStatusChange: vi.fn(),
    handleAudioLevel: vi.fn(),
    clearTranscript: vi.fn(),
    clearError: vi.fn(),
  }),
}));

// Mock file attachment components
vi.mock('@/components/ui/FileAttachment', () => ({
  FileAttachment: () => <div data-testid="file-attachment" />,
}));

vi.mock('@/components/ui/Alert', () => ({
  Alert: () => <div data-testid="alert" />,
}));

describe('ChatInput Window Focus Behavior', () => {
  const mockOnChange = vi.fn();
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    value: '',
    onChange: mockOnChange,
    onSubmit: mockOnSubmit,
    disabled: false,
    placeholder: 'Type a message...',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any event listeners
    vi.clearAllTimers();
  });

  it('focuses textarea when window regains focus', () => {
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByTestId('message-input');

    // Blur the textarea to simulate it losing focus
    textarea.blur();
    expect(textarea).not.toHaveFocus();

    // Simulate window regaining focus
    fireEvent(window, new Event('focus'));

    // Textarea should be focused again
    expect(textarea).toHaveFocus();
  });

  it('does not focus textarea when disabled', () => {
    render(<ChatInput {...defaultProps} disabled={true} />);

    const textarea = screen.getByTestId('message-input');

    // Blur the textarea
    textarea.blur();
    expect(textarea).not.toHaveFocus();

    // Simulate window regaining focus
    fireEvent(window, new Event('focus'));

    // Textarea should remain unfocused because component is disabled
    expect(textarea).not.toHaveFocus();
  });

  it('cleans up window focus event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<ChatInput {...defaultProps} />);

    // Unmount the component
    unmount();

    // Verify that the focus event listener was removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('focus', expect.any(Function));

    removeEventListenerSpy.mockRestore();
  });

  it('does not focus textarea when modal is open', () => {
    render(<ChatInput {...defaultProps} />);

    const textarea = screen.getByTestId('message-input');

    // Simulate modal being open by setting body overflow to hidden
    document.body.style.overflow = 'hidden';

    // Blur the textarea
    textarea.blur();
    expect(textarea).not.toHaveFocus();

    // Simulate window regaining focus
    fireEvent(window, new Event('focus'));

    // Textarea should remain unfocused because modal is open
    expect(textarea).not.toHaveFocus();

    // Clean up
    document.body.style.overflow = 'unset';
  });

  it('updates focus behavior when disabled state changes', () => {
    const { rerender } = render(<ChatInput {...defaultProps} disabled={false} />);

    const textarea = screen.getByTestId('message-input');

    // Initially should focus on window focus
    textarea.blur();
    fireEvent(window, new Event('focus'));
    expect(textarea).toHaveFocus();

    // Change to disabled
    textarea.blur();
    rerender(<ChatInput {...defaultProps} disabled={true} />);

    // Now should not focus on window focus
    fireEvent(window, new Event('focus'));
    expect(textarea).not.toHaveFocus();
  });
});
