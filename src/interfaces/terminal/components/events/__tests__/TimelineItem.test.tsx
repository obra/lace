// ABOUTME: Tests for extracted TimelineItem component
// ABOUTME: Verifies all timeline item types render correctly and delegate logic works properly

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Timeline, TimelineItem as TimelineItemType } from '../../../../thread-processor.js';
import { TimelineItem } from '../TimelineItem.js';

// Mock all the display components
vi.mock('../EventDisplay.js', () => ({
  EventDisplay: ({ event, isFocused }: any) => 
    React.createElement(Text, {}, `EventDisplay:${event.type}:${isFocused ? 'focused' : 'unfocused'}`)
}));

vi.mock('../ToolExecutionDisplay.js', () => ({
  ToolExecutionDisplay: ({ callEvent, isExpanded, isFocused }: any) => 
    React.createElement(Text, {}, `ToolExecutionDisplay:${callEvent.data.toolName}:${isExpanded ? 'expanded' : 'collapsed'}:${isFocused ? 'focused' : 'unfocused'}`)
}));

vi.mock('../DelegationBox.js', () => ({
  DelegationBox: ({ threadId }: any) => 
    React.createElement(Text, {}, `DelegationBox:${threadId}:expanded`)
}));

vi.mock('../../message-display.js', () => ({
  default: ({ message, isFocused }: any) => 
    React.createElement(Text, {}, `MessageDisplay:${message.type}:${isFocused ? 'focused' : 'unfocused'}`)
}));

vi.mock('../../../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

const mockExtractDelegateThreadId = vi.fn();

vi.mock('../hooks/useDelegateThreadExtraction.js', () => ({
  useDelegateThreadExtraction: () => ({
    extractDelegateThreadId: mockExtractDelegateThreadId
  })
}));

describe('TimelineItem Component', () => {
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractDelegateThreadId.mockReturnValue(null);
  });

  const defaultProps = {
    delegateTimelines: undefined,
    isFocused: false,
    focusedLine: 0,
    itemStartLine: 0,
    onToggle: mockOnToggle,
    currentFocusId: 'timeline'
  };

  describe('user_message items', () => {
    it('should render user message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE:unfocused');
    });

    it('should pass focus state to EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} isFocused={true} />
      );

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE:focused');
    });
  });

  describe('agent_message items', () => {
    it('should render agent message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'msg-2',
        type: 'agent_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello back'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('EventDisplay:AGENT_MESSAGE:unfocused');
    });
  });

  describe('thinking items', () => {
    it('should render thinking with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'thinking-1',
        type: 'thinking',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Let me think...'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('EventDisplay:THINKING:unfocused');
    });
  });

  describe('system_message items', () => {
    it('should render system message with EventDisplay', () => {
      const item: TimelineItemType = {
        id: 'sys-1',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification',
        originalEventType: 'SYSTEM_PROMPT'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('EventDisplay:SYSTEM_PROMPT:unfocused');
    });

    it('should use default event type when originalEventType missing', () => {
      const item: TimelineItemType = {
        id: 'sys-2',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('EventDisplay:LOCAL_SYSTEM_MESSAGE:unfocused');
    });
  });

  describe('tool_execution items', () => {
    it('should render regular tool execution with ToolExecutionDisplay', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          toolName: 'bash',
          input: { command: 'ls' },
          callId: 'call-123'
        },
        result: {
          callId: 'call-123',
          output: 'file1.txt\nfile2.txt',
          success: true
        }
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('ToolExecutionDisplay:bash:collapsed:unfocused');
    });

    it('should start collapsed by default with self-managed state', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          toolName: 'bash',
          input: { command: 'ls' },
          callId: 'call-123'
        },
        result: {
          callId: 'call-123',
          output: 'file1.txt\nfile2.txt',
          success: true
        }
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('ToolExecutionDisplay:bash:collapsed:unfocused');
    });
  });

  describe('delegate tool execution items', () => {
    const createDelegateTimeline = (): Timeline => ({
      items: [{
        id: 'delegate-msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:01Z'),
        content: 'Delegate task'
      }],
      metadata: {
        eventCount: 1,
        messageCount: 1,
        lastActivity: new Date('2024-01-01T10:00:01Z')
      }
    });

    it('should render delegate tool with DelegationBox when thread found', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          toolName: 'delegate',
          input: { prompt: 'Help me with this' },
          callId: 'delegate-call-123'
        },
        result: {
          callId: 'delegate-call-123',
          output: 'Thread: delegate-thread-456',
          success: true
        }
      };

      const delegateTimelines = new Map([
        ['delegate-thread-456', createDelegateTimeline()]
      ]);

      mockExtractDelegateThreadId.mockReturnValue('delegate-thread-456');

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} delegateTimelines={delegateTimelines} />
      );

      const frame = lastFrame();
      expect(frame).toContain('ToolExecutionDisplay:delegate:collapsed:unfocused');
      expect(frame).toContain('DelegationBox:delegate-thread-456:expanded');
    });

    it('should start expanded by default with self-managed state', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          toolName: 'delegate',
          input: { prompt: 'Help me with this' },
          callId: 'delegate-call-123'
        },
        result: {
          callId: 'delegate-call-123',
          output: 'Thread: delegate-thread-456',
          success: true
        }
      };

      const delegateTimelines = new Map([
        ['delegate-thread-456', createDelegateTimeline()]
      ]);

      mockExtractDelegateThreadId.mockReturnValue('delegate-thread-456');

      const { lastFrame } = render(
        <TimelineItem 
          item={item} 
          {...defaultProps} 
          delegateTimelines={delegateTimelines}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('DelegationBox:delegate-thread-456:expanded');
    });

    it('should fall back to regular tool display when no delegate thread found', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          toolName: 'delegate',
          input: { prompt: 'Help me with this' },
          callId: 'delegate-call-123'
        },
        result: {
          callId: 'delegate-call-123',
          output: 'No thread found',
          success: true
        }
      };

      const delegateTimelines = new Map([
        ['other-thread', createDelegateTimeline()]
      ]);

      mockExtractDelegateThreadId.mockReturnValue(null); // No thread found

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} delegateTimelines={delegateTimelines} />
      );

      const frame = lastFrame();
      expect(frame).toContain('ToolExecutionDisplay:delegate:collapsed:unfocused');
      expect(frame).not.toContain('DelegationBox');
    });

    it('should call extractDelegateThreadId for delegate tools', () => {
      const item: TimelineItemType = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          toolName: 'delegate',
          input: { prompt: 'Help me' },
          callId: 'delegate-call-123'
        }
      };

      const delegateTimelines = new Map();
      mockExtractDelegateThreadId.mockReturnValue(null);

      render(
        <TimelineItem item={item} {...defaultProps} delegateTimelines={delegateTimelines} />
      );

      expect(mockExtractDelegateThreadId).toHaveBeenCalledWith(item);
    });
  });

  describe('ephemeral_message items', () => {
    it('should render ephemeral message with MessageDisplay', () => {
      const item: TimelineItemType = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'info'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(lastFrame()).toContain('MessageDisplay:info:unfocused');
    });

    it('should pass focus state to MessageDisplay', () => {
      const item: TimelineItemType = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'warning'
      };

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} isFocused={true} />
      );

      expect(lastFrame()).toContain('MessageDisplay:warning:focused');
    });
  });

  describe('unknown item types', () => {
    it('should render unknown type fallback', () => {
      const item = {
        id: 'unknown-1',
        type: 'unknown_type',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Unknown content'
      } as any;

      const { lastFrame } = render(
        <TimelineItem item={item} {...defaultProps} />
      );

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
          toolName: 'bash',
          input: { command: 'ls' },
          callId: 'bash-call-123'
        }
      };

      render(
        <TimelineItem item={item} {...defaultProps} />
      );

      expect(mockExtractDelegateThreadId).not.toHaveBeenCalled();
    });
  });
});