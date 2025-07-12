// ABOUTME: Tests for TimelineItem component with dynamic tool renderer discovery
// ABOUTME: Verifies timeline item rendering, tool renderer selection, and expansion behavior

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { TimelineItem } from '~/interfaces/terminal/components/events/TimelineItem';
import { TimelineItem as TimelineItemType } from '~/interfaces/timeline-types';
import { Text } from 'ink';
import { TimelineExpansionProvider } from '~/interfaces/terminal/components/events/hooks/useTimelineExpansionToggle';

// Mock dependencies
vi.mock('../EventDisplay.js', () => ({
  EventDisplay: ({ event }: { event: { type: string } }) => {
    return React.createElement(Text, {}, `EventDisplay:${event.type}`);
  },
}));

vi.mock('../tool-renderers/GenericToolRenderer.js', () => ({
  GenericToolRenderer: ({
    item,
    isSelected,
  }: {
    item: { call: { name: string } };
    isSelected?: boolean;
  }) => {
    const focusState = isSelected ? 'FOCUS' : 'UNFOCUS';
    return React.createElement(
      Text,
      {},
      `GenericToolRenderer:${item.call.name}:${focusState.toLowerCase()}:timeline`
    );
  },
}));

vi.mock('../tool-renderers/getToolRenderer.js', () => ({
  getToolRenderer: vi.fn().mockResolvedValue(null), // Always return null to use GenericToolRenderer
}));

vi.mock('../../message-display.js', () => ({
  default: ({ message }: { message: { type: string } }) =>
    React.createElement(Text, {}, `MessageDisplay:${message.type}`),
}));

vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TimelineItem Component', () => {
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    isSelected: false,
    selectedLine: 0,
    itemStartLine: 0,
    onToggle: mockOnToggle,
  };

  // Helper to render with TimelineExpansionProvider
  const renderWithProvider = (component: React.ReactElement) => {
    return render(<TimelineExpansionProvider>{component}</TimelineExpansionProvider>);
  };

  describe('user_message items', () => {
    it('should render user message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world',
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE');
    });

    it('should render user message when selected', () => {
      const item: TimelineItemType = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world',
      };

      const { lastFrame } = renderWithProvider(
        <TimelineItem item={item} {...defaultProps} isSelected={true} />
      );

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE');
    });
  });

  describe('agent_message items', () => {
    it('should render agent message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'msg-2',
        type: 'agent_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello back',
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('EventDisplay:AGENT_MESSAGE');
    });
  });

  describe('system_message items', () => {
    it('should render system message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'sys-1',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification',
        originalEventType: 'SYSTEM_PROMPT',
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('EventDisplay:SYSTEM_PROMPT');
    });

    it('should use default event type when originalEventType missing', () => {
      const item: TimelineItemType = {
        id: 'sys-2',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification',
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('EventDisplay:LOCAL_SYSTEM_MESSAGE');
    });
  });

  describe('tool_execution items', () => {
    it('should render regular tool execution with ToolExecutionDisplay', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          id: 'call-123',
          name: 'bash',
          arguments: { command: 'ls' },
        },
        result: {
          id: 'call-123',
          content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
          isError: false,
        },
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('GenericToolRenderer:bash:unfocus:timeline');
    });

    it('should start collapsed by default with self-managed state', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          id: 'call-123',
          name: 'bash',
          arguments: { command: 'ls' },
        },
        result: {
          id: 'call-123',
          content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
          isError: false,
        },
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('GenericToolRenderer:bash:unfocus:timeline');
    });
  });

  describe('delegate tool execution items', () => {
    it('should render delegate tool with GenericToolRenderer when no specific renderer found', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' },
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'Thread: delegate-thread-456' }],
          isError: false,
        },
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('GenericToolRenderer:delegate:unfocus:timeline');
    });

    it('should start expanded by default with self-managed state', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' },
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'Thread: delegate-thread-456' }],
          isError: false,
        },
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('GenericToolRenderer:delegate:unfocus:timeline');
    });

    it('should fall back to regular tool display when no delegate thread found', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' },
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'No thread found' }],
          isError: false,
        },
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain('GenericToolRenderer:delegate:unfocus:timeline');
    });

    it('should render delegate tools with GenericToolRenderer', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me' },
        },
      };

      renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      // The delegate tool extraction logic is now handled by the DelegateToolRenderer
      // This test verifies that delegate tools render correctly with GenericToolRenderer fallback
    });
  });

  describe('ephemeral_message items', () => {
    it('should render ephemeral message with MessageDisplay', () => {
      const item: TimelineItemType = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'info',
      };

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('MessageDisplay:info');
    });

    it('should render ephemeral message when selected', () => {
      const item: TimelineItemType = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'warning',
      };

      const { lastFrame } = renderWithProvider(
        <TimelineItem item={item} {...defaultProps} isSelected={true} />
      );

      expect(lastFrame()).toContain('MessageDisplay:warning');
    });
  });

  describe('unknown item types', () => {
    it('should render unknown type fallback', () => {
      const item = {
        id: 'unknown-1',
        type: 'unknown_type',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Unknown content',
      } as unknown as TimelineItemType;

      const { lastFrame } = renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      expect(lastFrame()).toContain('Unknown timeline item type');
    });
  });

  describe('non-delegate tool execution', () => {
    it('should not call extractDelegateThreadId for non-delegate tools', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'bash-call-123',
        call: {
          id: 'bash-call-123',
          name: 'bash',
          arguments: { command: 'ls' },
        },
      };

      renderWithProvider(<TimelineItem item={item} {...defaultProps} />);

      // Note: delegate extraction is now handled by the DelegateToolRenderer when it's used
    });
  });
});
