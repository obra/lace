// ABOUTME: Tests for TypingIndicator component
// ABOUTME: Verifies agent-specific styling and animation behavior

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TypingIndicator } from './TypingIndicator';

// Mock Framer Motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe('TypingIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<TypingIndicator agent="Claude" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('displays the correct agent name', () => {
    render(<TypingIndicator agent="Claude" />);
    expect(screen.getByText('Claude is thinking...')).toBeInTheDocument();
  });

  it('works with different agents', () => {
    render(<TypingIndicator agent="GPT-4" />);
    expect(screen.getByText('GPT-4 is thinking...')).toBeInTheDocument();
  });

  it('displays robot icon', () => {
    render(<TypingIndicator agent="Claude" />);
    // FontAwesome icon should be present
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('has agent-specific styling for Claude', () => {
    const { container } = render(<TypingIndicator agent="Claude" />);
    // Should contain orange color class for Claude
    expect(container.innerHTML).toContain('bg-orange-500');
  });

  it('has agent-specific styling for GPT-4', () => {
    const { container } = render(<TypingIndicator agent="GPT-4" />);
    // Should contain green color class for GPT-4
    expect(container.innerHTML).toContain('bg-green-600');
  });

  it('has agent-specific styling for Gemini', () => {
    const { container } = render(<TypingIndicator agent="Gemini" />);
    // Should contain blue color class for Gemini
    expect(container.innerHTML).toContain('bg-blue-600');
  });

  it('falls back to default styling for unknown agent', () => {
    const { container } = render(<TypingIndicator agent="UnknownAgent" />);
    // Should contain gray fallback
    expect(container.innerHTML).toContain('bg-gray-600');
  });

  it('contains animated dots for loading effect', () => {
    const { container } = render(<TypingIndicator agent="Claude" />);
    // Should have multiple animated dots
    const dots = container.querySelectorAll('[class*="rounded-full"]');
    expect(dots.length).toBeGreaterThan(1);
  });
});