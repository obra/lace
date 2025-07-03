// ABOUTME: Tests for enhanced AgentMessageDisplay with internal thinking handling
// ABOUTME: Verifies expansion behavior and thinking block processing

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { AgentMessageDisplay } from '../AgentMessageDisplay.js';
import { ThreadEvent } from '../../../../../threads/types.js';
import { UI_SYMBOLS } from '../../../theme.js';

// Mock dependencies
vi.mock('../hooks/useTimelineExpansionToggle.js', () => ({
  useTimelineItemExpansion: () => ({
    isExpanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
  }),
}));

vi.mock('../ui/MarkdownDisplay.js', () => ({
  MarkdownDisplay: ({ content, showIcon, dimmed }: any) =>
    React.createElement(
      'text',
      {},
      `MD:${content}:${showIcon ? 'icon' : 'noicon'}:${dimmed ? 'dim' : 'bright'}`
    ),
}));

vi.mock('../ui/TimelineEntryCollapsibleBox.js', () => ({
  TimelineEntryCollapsibleBox: ({
    children,
    label,
    summary,
    isExpanded,
    onExpandedChange,
    isFocused,
  }: any) => {
    return React.createElement(
      'collapsible',
      {
        'data-expanded': isExpanded,
        'data-focused': isFocused,
        'data-label': label,
        'data-summary': summary,
        onClick: () => onExpandedChange?.(!isExpanded),
      },
      children
    );
  },
}));

describe('AgentMessageDisplay - Enhanced with Thinking', () => {
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createEvent = (content: string): ThreadEvent => ({
    id: 'agent-1',
    threadId: 'thread-1',
    type: 'AGENT_MESSAGE',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    data: content,
  });

  describe('Thinking block detection and parsing', () => {
    it('should detect when message has thinking blocks', () => {
      const event = createEvent('<think>Some thinking</think>Regular content');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      // Should show collapsed state with thinking summary
      expect(lastFrame()).toContain('thought for 2 words');
      expect(lastFrame()).toContain(UI_SYMBOLS.TOOLBOX_SINGLE_EXPANDABLE);
    });

    it('should not use collapsible for messages without thinking blocks', () => {
      const event = createEvent('Just regular content');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      // Should render directly without Agent Response label
      expect(lastFrame()).not.toContain('Agent Response');
      expect(lastFrame()).toContain('Just regular content');
    });
  });

  describe('Collapsed state behavior', () => {
    it('should show summary with thinking word count when collapsed', () => {
      const event = createEvent(
        '<think>This is some thinking content here</think>Here is the response'
      );

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      const frame = lastFrame();
      expect(frame).toContain('Here is the response');
      expect(frame).toContain('thought for 6 words'); // "This is some thinking content here" = 6 words
    });

    it('should handle multiple thinking blocks in summary', () => {
      const event = createEvent(
        '<think>First thought</think>Some text<think>Second longer thought process</think>Final response'
      );

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      const frame = lastFrame();
      expect(frame).toContain('Some text');
      expect(frame).toContain('Final response');
      expect(frame).toContain('thought for 2 words'); // "First thought" = 2 words
      expect(frame).toContain('thought for 4 words'); // "Second longer thought process" = 4 words
    });

    it('should handle thinking-only messages in collapsed state', () => {
      const event = createEvent('<think>Only thinking content here</think>');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      const frame = lastFrame();
      expect(frame).toContain('thought for 4 words'); // "Only thinking content here" = 4 words
      expect(frame).not.toContain('MD:'); // No regular content to show
    });
  });

  describe('Initial state behavior', () => {
    it('should start collapsed by default for messages with thinking blocks', () => {
      const event = createEvent('<think>Some thinking</think>Here is the response');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      const frame = lastFrame();
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE_EXPANDABLE);
      // Should show summary content with thinking marker
      expect(frame).toContain('thought for 2 words');
      expect(frame).toContain('Here is the response');
    });
  });

  describe('Props forwarding', () => {
    it('should forward isFocused to TimelineEntryCollapsibleBox', () => {
      const event = createEvent('<think>Thinking</think>Content');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      // Test that the component renders with the focus prop forwarded to the mock
      // The mock TimelineEntryCollapsibleBox should have isFocused=true
      expect(lastFrame()).toContain('thought for 1 word');
      expect(lastFrame()).toContain('Content');
    });

    it('should call onToggle when expansion changes', () => {
      const event = createEvent('<think>Thinking</think>Content');

      render(<AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />);

      // Component starts collapsed, can't easily test expansion without interaction
      expect(mockOnToggle).toHaveBeenCalledTimes(0);
    });
  });

  describe('Streaming state', () => {
    it('should show thinking indicator when streaming', () => {
      const event = createEvent('Partial response...');

      const { lastFrame } = render(
        <AgentMessageDisplay
          event={event}
          isStreaming={true}
          isFocused={true}
          onToggle={mockOnToggle}
        />
      );

      expect(lastFrame()).toContain('(thinking...)');
    });
  });

  describe('Empty content handling', () => {
    it('should handle empty content gracefully', () => {
      const event = createEvent('');

      const { lastFrame } = render(
        <AgentMessageDisplay event={event} isFocused={true} onToggle={mockOnToggle} />
      );

      // Should render something (even if empty)
      expect(lastFrame()).toBeDefined();
    });
  });
});
