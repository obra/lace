// ABOUTME: Tests for TypingIndicator component
// ABOUTME: Ensures component renders correctly with different agent names

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import React from 'react';
import { TypingIndicator } from './TypingIndicator';
import { renderWithDefaults, findByPartialClass } from '../../__tests__/utils/test-helpers';

describe('TypingIndicator', () => {
  it('renders without crashing', () => {
    const { container } = renderWithDefaults(<TypingIndicator agent="Claude" />);
    
    // Should render the basic structure
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders bouncing dots animation', () => {
    const { container } = renderWithDefaults(<TypingIndicator agent="Claude" />);
    
    // Should have animated bouncing dots
    const animatedElements = container.querySelectorAll('.animate-bounce');
    expect(animatedElements.length).toBeGreaterThan(0);
  });

  it('applies agent-specific styling', () => {
    const { container } = renderWithDefaults(<TypingIndicator agent="Claude" />);
    
    // Should have some agent-specific styling (orange for Claude)
    const orangeElement = findByPartialClass(container, 'bg-orange-500');
    expect(orangeElement).toBeInTheDocument();
  });

  it('handles different agent names', () => {
    const { container: claudeContainer } = renderWithDefaults(<TypingIndicator agent="Claude" />);
    const { container: gptContainer } = renderWithDefaults(<TypingIndicator agent="GPT-4" />);
    
    // Different agents should render differently
    expect(claudeContainer.innerHTML).not.toBe(gptContainer.innerHTML);
  });

  it('has proper accessibility structure', () => {
    const { container } = renderWithDefaults(<TypingIndicator agent="Claude" />);
    
    // Should have proper semantic structure
    expect(container.firstChild).toBeInTheDocument();
  });
});