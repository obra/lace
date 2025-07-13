// ABOUTME: Tests for TimelineView component
// ABOUTME: Ensures timeline rendering, scrolling, and typing indicators work correctly

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineView } from './TimelineView';
import { createMockTimelineEntry } from '../../__tests__/utils/test-helpers';

// Mock Framer Motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useInView: () => true,
}));

describe('TimelineView', () => {
  const defaultProps = {
    entries: [],
    isTyping: false,
    currentAgent: 'Claude',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<TimelineView {...defaultProps} />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it('displays timeline entries', () => {
    const entries = [
      createMockTimelineEntry({ id: '1', content: 'First message', type: 'human' }),
      createMockTimelineEntry({ id: '2', content: 'Second message', type: 'ai' }),
    ];

    render(<TimelineView {...defaultProps} entries={entries} />);
    
    expect(screen.getByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
  });

  it('shows typing indicator when isTyping is true', () => {
    render(<TimelineView {...defaultProps} isTyping={true} />);
    
    // TypingIndicator should be rendered but we'll check for agent name
    expect(screen.getByText('Claude is thinking...')).toBeInTheDocument();
  });

  it('does not show typing indicator when isTyping is false', () => {
    render(<TimelineView {...defaultProps} isTyping={false} />);
    
    expect(screen.queryByText('Claude is thinking...')).not.toBeInTheDocument();
  });

  it('handles empty entries array', () => {
    render(<TimelineView {...defaultProps} entries={[]} />);
    
    // Should render container without errors
    expect(document.querySelector('.space-y-4')).toBeInTheDocument();
  });

  it('displays different agent names in typing indicator', () => {
    render(<TimelineView {...defaultProps} isTyping={true} currentAgent="GPT-4" />);
    
    expect(screen.getByText('GPT-4 is thinking...')).toBeInTheDocument();
  });
});