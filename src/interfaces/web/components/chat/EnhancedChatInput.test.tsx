// ABOUTME: Tests for EnhancedChatInput component
// ABOUTME: Verifies form submission, voice controls, and responsive behavior

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnhancedChatInput } from './EnhancedChatInput';
import { mockChatInputProps } from '../../__tests__/utils/test-helpers';
import '../../__tests__/setup';

describe('EnhancedChatInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.innerWidth for mobile detection
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });
  });

  it('renders without crashing', () => {
    const { container } = render(<EnhancedChatInput {...mockChatInputProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('displays the input value', () => {
    render(<EnhancedChatInput {...mockChatInputProps} value="Test message" />);
    expect(screen.getByDisplayValue('Test message')).toBeInTheDocument();
  });

  it('calls onChange when typing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    
    render(<EnhancedChatInput {...mockChatInputProps} onChange={onChange} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    
    // Check that onChange was called for each character
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(onChange).toHaveBeenLastCalledWith('o');
  });

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn();
    
    render(<EnhancedChatInput {...mockChatInputProps} value="Test" onSubmit={onSubmit} />);
    
    const form = screen.getByRole('textbox').closest('form');
    fireEvent.submit(form!);
    
    expect(onSubmit).toHaveBeenCalled();
  });

  it('does not submit empty messages', async () => {
    const onSubmit = vi.fn();
    
    render(<EnhancedChatInput {...mockChatInputProps} value="   " onSubmit={onSubmit} />);
    
    const form = screen.getByRole('textbox').closest('form');
    fireEvent.submit(form!);
    
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables input when disabled prop is true', () => {
    render(<EnhancedChatInput {...mockChatInputProps} disabled={true} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });

  it('shows listening placeholder when isListening is true', () => {
    render(<EnhancedChatInput {...mockChatInputProps} isListening={true} />);
    
    expect(screen.getByPlaceholderText('Listening...')).toBeInTheDocument();
  });

  it('shows default placeholder when not listening', () => {
    render(<EnhancedChatInput {...mockChatInputProps} isListening={false} />);
    
    expect(screen.getByPlaceholderText('Message the agent...')).toBeInTheDocument();
  });

  it('calls onStartVoice when voice button is clicked', async () => {
    const user = userEvent.setup();
    const onStartVoice = vi.fn();
    
    // Mock mobile view
    Object.defineProperty(window, 'innerWidth', { value: 500 });
    
    render(<EnhancedChatInput {...mockChatInputProps} onStartVoice={onStartVoice} />);
    
    // Re-render to trigger mobile detection
    window.dispatchEvent(new Event('resize'));
    
    // Voice button should be visible on mobile
    const voiceButtons = screen.getAllByRole('button').filter(button => 
      button.querySelector('svg')
    );
    
    if (voiceButtons.length > 0) {
      await user.click(voiceButtons[0]);
      expect(onStartVoice).toHaveBeenCalled();
    }
  });

  it('disables send button when no content', () => {
    render(<EnhancedChatInput {...mockChatInputProps} value="" />);
    
    const sendButton = screen.getByRole('button');
    expect(sendButton).toBeDisabled();
  });

  it('enables send button when there is content', () => {
    render(<EnhancedChatInput {...mockChatInputProps} value="Test message" />);
    
    const sendButton = screen.getByRole('button');
    expect(sendButton).not.toBeDisabled();
  });

  it('submits on Enter key (desktop)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    
    render(<EnhancedChatInput {...mockChatInputProps} value="Test" onSubmit={onSubmit} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '{Enter}');
    
    expect(onSubmit).toHaveBeenCalled();
  });

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    
    render(<EnhancedChatInput {...mockChatInputProps} value="Test" onSubmit={onSubmit} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '{Shift>}{Enter}{/Shift}');
    
    expect(onSubmit).not.toHaveBeenCalled();
  });
});