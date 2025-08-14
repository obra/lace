import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AgentBadge from '../AgentBadge';

describe('AgentBadge', () => {
  it('renders agent name', () => {
    render(<AgentBadge agent="Claude" />);
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('applies correct size classes', () => {
    const { rerender } = render(<AgentBadge agent="Claude" size="xs" />);
    let badge = screen.getByText('Claude');
    expect(badge).toHaveClass('text-xs', 'px-1.5', 'py-0.5');

    rerender(<AgentBadge agent="Claude" size="sm" />);
    badge = screen.getByText('Claude');
    expect(badge).toHaveClass('text-sm', 'px-2', 'py-1');

    rerender(<AgentBadge agent="Claude" size="md" />);
    badge = screen.getByText('Claude');
    expect(badge).toHaveClass('text-base', 'px-3', 'py-1.5');
  });

  it('applies correct agent colors', () => {
    const { rerender } = render(<AgentBadge agent="Claude" />);
    let badge = screen.getByText('Claude');
    expect(badge).toHaveClass('bg-orange-900/20', 'text-orange-600');

    rerender(<AgentBadge agent="GPT-4" />);
    badge = screen.getByText('GPT-4');
    expect(badge).toHaveClass('bg-green-900/20', 'text-green-600');

    rerender(<AgentBadge agent="Gemini" />);
    badge = screen.getByText('Gemini');
    expect(badge).toHaveClass('bg-blue-900/20', 'text-blue-600');
  });

  it('applies custom className', () => {
    render(<AgentBadge agent="Claude" className="custom-class" />);
    const badge = screen.getByText('Claude');
    expect(badge).toHaveClass('custom-class');
  });

  it('handles unknown agent with fallback colors', () => {
    render(<AgentBadge agent="UnknownAgent" />);
    const badge = screen.getByText('UnknownAgent');
    expect(badge).toHaveClass('bg-base-content/10', 'text-base-content/60');
  });
});
