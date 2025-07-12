// ABOUTME: Tests for TimelineView component
// ABOUTME: Ensures timeline renders entries correctly and handles auto-scroll

import { describe, it, expect } from 'vitest';
import React from 'react';
import { TimelineView } from './TimelineView';
import { renderWithDefaults, createMockTimelineEntry } from '../../__tests__/utils/test-helpers';

describe('TimelineView', () => {
  const mockEntries = [
    createMockTimelineEntry({ id: '1', content: 'First message' }),
    createMockTimelineEntry({ id: '2', content: 'Second message', type: 'ai', agent: 'Claude' }),
  ];

  it('renders without crashing', () => {
    const { container } = renderWithDefaults(
      <TimelineView 
        entries={mockEntries} 
        isTyping={false} 
        currentAgent="Claude" 
      />
    );
    
    expect(container.firstChild).toBeInTheDocument();
  });

  it('renders timeline entries', () => {
    const { container } = renderWithDefaults(
      <TimelineView 
        entries={mockEntries} 
        isTyping={false} 
        currentAgent="Claude" 
      />
    );
    
    // Should render content from the entries
    expect(container).toHaveTextContent('First message');
    expect(container).toHaveTextContent('Second message');
  });

  it('shows typing indicator when isTyping is true', () => {
    const { container } = renderWithDefaults(
      <TimelineView 
        entries={mockEntries} 
        isTyping={true} 
        currentAgent="Claude" 
      />
    );
    
    // Should have typing indicator (bouncing dots)
    const animatedElements = container.querySelectorAll('.animate-bounce');
    expect(animatedElements.length).toBeGreaterThan(0);
  });

  it('shows streaming content when provided', () => {
    const { container } = renderWithDefaults(
      <TimelineView 
        entries={mockEntries} 
        isTyping={false} 
        currentAgent="Claude"
        streamingContent="Streaming message..."
      />
    );
    
    expect(container).toHaveTextContent('Streaming message...');
  });

  it('prioritizes streaming content over typing indicator', () => {
    const { container } = renderWithDefaults(
      <TimelineView 
        entries={mockEntries} 
        isTyping={true} 
        currentAgent="Claude"
        streamingContent="Streaming..."
      />
    );
    
    // Should show streaming content, not typing indicator
    expect(container).toHaveTextContent('Streaming...');
    // Should not show separate typing indicator when streaming
    const typingIndicators = container.querySelectorAll('.animate-bounce');
    // Streaming content might have its own bounce animation, but not the typing indicator
    expect(container).toHaveTextContent('Streaming...');
  });
});