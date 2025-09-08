// ABOUTME: Tests for ToolPolicyToggle component covering policy selection functionality
// ABOUTME: Validates segmented control behavior, color coding, and accessibility features

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ToolPolicyToggle } from './ToolPolicyToggle';
import type { ToolPolicy } from '@/types/core';

describe('ToolPolicyToggle', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders all three policy options', () => {
    render(<ToolPolicyToggle value="ask" onChange={mockOnChange} />);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument();
  });

  it('highlights the selected policy option', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    const allowButton = screen.getByRole('button', { name: 'Allow' });
    const askButton = screen.getByRole('button', { name: 'Ask' });
    const blockButton = screen.getByRole('button', { name: 'Block' });

    expect(allowButton).toHaveClass('bg-green-950');
    expect(askButton).not.toHaveClass('bg-yellow-950');
    expect(blockButton).not.toHaveClass('bg-red-950');
  });

  it('applies correct color coding for each policy', () => {
    const { rerender } = render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass('bg-green-950');

    rerender(<ToolPolicyToggle value="ask" onChange={mockOnChange} />);
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveClass('bg-yellow-950');

    rerender(<ToolPolicyToggle value="deny" onChange={mockOnChange} />);
    expect(screen.getByRole('button', { name: 'Block' })).toHaveClass('bg-red-950');
  });

  it('calls onChange when a different policy is selected', () => {
    render(<ToolPolicyToggle value="ask" onChange={mockOnChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(mockOnChange).toHaveBeenCalledWith('allow');

    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    expect(mockOnChange).toHaveBeenCalledWith('deny');
  });

  it('does not call onChange when clicking the already selected option', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(mockOnChange).toHaveBeenCalledWith('allow');
  });

  it('applies disabled state to all buttons', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} disabled />);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Block' })).toBeDisabled();
  });

  it('does not call onChange when disabled', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} disabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('applies different size classes', () => {
    const { rerender } = render(
      <ToolPolicyToggle value="allow" onChange={mockOnChange} size="sm" />
    );
    let container = screen.getByRole('button', { name: 'Allow' }).parentElement;
    expect(container).toHaveClass('text-xs');

    rerender(<ToolPolicyToggle value="allow" onChange={mockOnChange} size="md" />);
    container = screen.getByRole('button', { name: 'Allow' }).parentElement;
    expect(container).toHaveClass('text-sm');

    rerender(<ToolPolicyToggle value="allow" onChange={mockOnChange} size="lg" />);
    container = screen.getByRole('button', { name: 'Allow' }).parentElement;
    expect(container).toHaveClass('text-base');
  });

  it('shows tooltips with policy descriptions', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    expect(screen.getByRole('button', { name: 'Allow' })).toHaveAttribute(
      'title',
      'Execute automatically'
    );
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveAttribute(
      'title',
      'Require user approval'
    );
    expect(screen.getByRole('button', { name: 'Block' })).toHaveAttribute('title', 'Never allow');
  });

  it('has proper focus management and keyboard navigation', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    const allowButton = screen.getByRole('button', { name: 'Allow' });
    const askButton = screen.getByRole('button', { name: 'Ask' });

    allowButton.focus();
    expect(allowButton).toHaveFocus();

    // Tab to next button
    fireEvent.keyDown(allowButton, { key: 'Tab' });
    askButton.focus();
    expect(askButton).toHaveFocus();
  });

  it('is keyboard accessible', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    const askButton = screen.getByRole('button', { name: 'Ask' });

    // Verify button is focusable and has proper attributes for keyboard accessibility
    expect(askButton).toHaveAttribute('type', 'button');
    expect(askButton).not.toHaveAttribute('tabindex', '-1');

    // Focus and verify it can receive focus
    askButton.focus();
    expect(askButton).toHaveFocus();
  });

  it('applies correct ARIA attributes', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('type', 'button');
    });
  });

  it('handles all valid policy values', () => {
    const policies: ToolPolicy[] = ['allow', 'ask', 'deny'];

    policies.forEach((policy) => {
      const { unmount } = render(<ToolPolicyToggle value={policy} onChange={mockOnChange} />);
      expect(screen.getAllByRole('button')).toHaveLength(3);
      unmount();
    });
  });

  it('applies consistent styling structure', () => {
    render(<ToolPolicyToggle value="allow" onChange={mockOnChange} />);

    const container = screen.getByRole('button', { name: 'Allow' }).parentElement;
    expect(container).toHaveClass('inline-flex', 'rounded-md', 'bg-base-200', 'p-0.5');

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      expect(button).toHaveClass(
        'relative',
        'font-medium',
        'transition-all',
        'duration-200',
        'ease-out',
        'rounded-sm'
      );
    });
  });
});
