// ABOUTME: Unit tests for CondensedChatInput component
// ABOUTME: Tests compact chat input suitable for modal usage

/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CondensedChatInput } from '../CondensedChatInput';

describe('CondensedChatInput', () => {
  it('should render with placeholder text', () => {
    render(
      <CondensedChatInput
        value=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        placeholder="Type something..."
      />
    );

    const input = screen.getByPlaceholderText('Type something...');
    expect(input).toBeInTheDocument();
  });

  it('should display the current value', () => {
    render(<CondensedChatInput value="Hello world" onChange={vi.fn()} onSend={vi.fn()} />);

    const input = screen.getByDisplayValue('Hello world');
    expect(input).toBeInTheDocument();
  });

  it('should call onChange when user types', () => {
    const mockOnChange = vi.fn();
    render(<CondensedChatInput value="" onChange={mockOnChange} onSend={vi.fn()} />);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'New message' } });

    expect(mockOnChange).toHaveBeenCalledWith('New message');
  });

  it('should call onSend when Enter key pressed', () => {
    const mockOnSend = vi.fn();
    render(<CondensedChatInput value="Test message" onChange={vi.fn()} onSend={mockOnSend} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockOnSend).toHaveBeenCalledOnce();
  });

  it('should not call onSend when Shift+Enter pressed (new line)', () => {
    const mockOnSend = vi.fn();
    render(<CondensedChatInput value="Test message" onChange={vi.fn()} onSend={mockOnSend} />);

    const input = screen.getByRole('textbox');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(mockOnSend).not.toHaveBeenCalled();
  });

  it('should show send button', () => {
    render(<CondensedChatInput value="Test" onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByTestId('condensed-send-button');
    expect(sendButton).toBeInTheDocument();
  });

  it('should call onSend when send button clicked', () => {
    const mockOnSend = vi.fn();
    render(<CondensedChatInput value="Test message" onChange={vi.fn()} onSend={mockOnSend} />);

    const sendButton = screen.getByTestId('condensed-send-button');
    fireEvent.click(sendButton);

    expect(mockOnSend).toHaveBeenCalledOnce();
  });

  it('should disable input and button when disabled prop is true', () => {
    render(<CondensedChatInput value="Test" onChange={vi.fn()} onSend={vi.fn()} disabled={true} />);

    const input = screen.getByRole('textbox');
    const button = screen.getByTestId('condensed-send-button');

    expect(input).toBeDisabled();
    expect(button).toBeDisabled();
  });

  it('should disable send button when value is empty', () => {
    render(<CondensedChatInput value="" onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByTestId('condensed-send-button');
    expect(sendButton).toBeDisabled();
  });

  it('should enable send button when value is not empty', () => {
    render(<CondensedChatInput value="Hello" onChange={vi.fn()} onSend={vi.fn()} />);

    const sendButton = screen.getByTestId('condensed-send-button');
    expect(sendButton).not.toBeDisabled();
  });

  it('should accept custom className', () => {
    const { container } = render(
      <CondensedChatInput value="" onChange={vi.fn()} onSend={vi.fn()} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('should auto-resize textarea based on content', () => {
    render(
      <CondensedChatInput value="Line 1\nLine 2\nLine 3" onChange={vi.fn()} onSend={vi.fn()} />
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Should be a textarea element for multi-line support
    expect(textarea.tagName).toBe('TEXTAREA');
  });
});
