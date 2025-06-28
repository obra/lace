// ABOUTME: Baseline tests for TimelineItemDisplay function before component extraction
// ABOUTME: Tests all timeline item types and delegate rendering behavior

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Box, Text } from 'ink';
import { Timeline, TimelineItem } from '../../../../thread-processor.js';

// Mock all the display components
vi.mock('../EventDisplay.js', () => ({
  EventDisplay: ({ event, isFocused }: any) => 
    React.createElement(Text, {}, `EventDisplay:${event.type}:${isFocused ? 'focused' : 'unfocused'}`)
}));

vi.mock('../ToolExecutionDisplay.js', () => ({
  ToolExecutionDisplay: ({ callEvent, isFocused }: any) => 
    React.createElement(Text, {}, `ToolExecutionDisplay:${callEvent.data.name}:collapsed:${isFocused ? 'focused' : 'unfocused'}`)
}));

vi.mock('../DelegationBox.js', () => ({
  DelegationBox: ({ toolCall }: any) => {
    const extractDelegateThreadId = (item: any) => {
      if (!item.result?.content?.[0]?.text) return null;
      const match = item.result.content[0].text.match(/Thread:\s*([^\s]+)/);
      return match ? match[1] : null;
    };
    const threadId = extractDelegateThreadId(toolCall);
    return threadId ? React.createElement(Text, {}, `DelegationBox:${threadId}:expanded`) : null;
  }
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

// Import the components after mocking
import { EventDisplay } from '../EventDisplay.js';
import { ToolExecutionDisplay } from '../ToolExecutionDisplay.js';
import { DelegationBox } from '../DelegationBox.js';
import MessageDisplay from '../../message-display.js';
import { logger } from '../../../../../utils/logger.js';

// Copy of the current TimelineItemDisplay function for baseline testing
function TimelineItemDisplay({ 
  item,
  delegateTimelines,
  isSelected,
  selectedLine,
  itemStartLine,
  onToggle,
  delegationExpandState,
  currentFocusId,
  extractDelegateThreadId 
}: {
  item: TimelineItem; 
  delegateTimelines?: Map<string, Timeline>;
  isSelected: boolean;
  selectedLine: number;
  itemStartLine: number;
  onToggle?: () => void;
  delegationExpandState: Map<string, boolean>;
  currentFocusId?: string;
  extractDelegateThreadId: (item: Extract<TimelineItem, { type: 'tool_execution' }>) => string | null;
}) {
  switch (item.type) {
    case 'user_message':
      return React.createElement(EventDisplay, {
        event: {
          id: item.id,
          threadId: '',
          type: 'USER_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        },
        isFocused: isSelected,
        focusedLine: selectedLine,
        itemStartLine,
        onToggle
      });
      
    case 'agent_message':
      return React.createElement(EventDisplay, {
        event: {
          id: item.id,
          threadId: '',
          type: 'AGENT_MESSAGE',
          timestamp: item.timestamp,
          data: item.content
        },
        isFocused: isSelected,
        focusedLine: selectedLine,
        itemStartLine,
        onToggle
      });
      
    case 'system_message':
      return React.createElement(EventDisplay, {
        event: {
          id: item.id,
          threadId: '',
          type: (item.originalEventType || 'LOCAL_SYSTEM_MESSAGE') as any,
          timestamp: item.timestamp,
          data: item.content
        },
        isFocused: isSelected,
        focusedLine: selectedLine,
        itemStartLine,
        onToggle
      });
      
    case 'tool_execution':
      const callEvent = {
        id: `${item.callId}-call`,
        threadId: '',
        type: 'TOOL_CALL' as const,
        timestamp: item.timestamp,
        data: item.call
      };
      
      const resultEvent = item.result ? {
        id: `${item.callId}-result`,
        threadId: '',
        type: 'TOOL_RESULT' as const,
        timestamp: item.timestamp,
        data: item.result
      } : undefined;
      
      // Check if this is a delegate tool call
      if (item.call.name === 'delegate') {
        logger.debug('TimelineDisplay: Processing delegate tool call', { 
          id: item.callId,
          name: item.call.name,
          arguments: {},
          hasDelegateTimelines: !!delegateTimelines,
          delegateTimelineCount: delegateTimelines?.size || 0
        });
        
        if (delegateTimelines) {
          const delegateThreadId = extractDelegateThreadId(item);
          logger.debug('TimelineDisplay: Delegate thread ID extraction result', {
            callId: item.callId,
            extractedThreadId: delegateThreadId,
            availableThreads: Array.from(delegateTimelines.keys()),
            toolResult: item.result?.content?.[0]?.text ? item.result?.content?.[0]?.text.substring(0, 100) + '...' : 'no result'
          });
          
          const delegateTimeline = delegateThreadId ? delegateTimelines.get(delegateThreadId) : null;
          
          if (delegateTimeline && delegateThreadId) {
            const isExpanded = delegationExpandState.get(item.callId) ?? true;
            logger.debug('TimelineDisplay: RENDERING delegation box', { 
              threadId: delegateThreadId,
              callId: item.callId,
              isExpanded,
              timelineItemCount: delegateTimeline.items.length
            });
            return React.createElement(Box, { flexDirection: "column" }, [
              React.createElement(ToolExecutionDisplay, {
                key: 'tool',
                callEvent: callEvent, 
                resultEvent: resultEvent,
                isFocused: isSelected,
              }),
              React.createElement(DelegationBox, {
                key: 'delegation',
                toolCall: item,
                parentFocusId: currentFocusId || 'timeline'
              })
            ]);
          } else {
            logger.debug('TimelineDisplay: NOT rendering delegation box', {
              reason: 'missing timeline or threadId',
              callId: item.callId,
              delegateThreadId,
              hasTimeline: !!delegateTimeline,
              hasDelegateTimelines: !!delegateTimelines,
              delegateTimelineKeys: delegateTimelines ? Array.from(delegateTimelines.keys()) : []
            });
          }
        } else {
          logger.debug('TimelineDisplay: No delegate timelines provided', {
            id: item.callId,
            name: item.call.name,
            arguments: {}
          });
        }
      }
      
      return React.createElement(ToolExecutionDisplay, {
        callEvent: callEvent, 
        resultEvent: resultEvent,
        isFocused: isSelected
      });
      
    case 'ephemeral_message':
      return React.createElement(MessageDisplay, {
        message: {
          type: item.messageType as any,
          content: item.content,
          timestamp: item.timestamp
        },
        isFocused: isSelected
      });
      
    default:
      return React.createElement(Box, {}, React.createElement(Text, {}, 'Unknown timeline item type'));
  }
}

describe('TimelineItemDisplay (Baseline)', () => {
  const mockExtractDelegateThreadId = vi.fn();
  const mockOnToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractDelegateThreadId.mockReturnValue(null);
  });

  const defaultProps = {
    delegateTimelines: undefined,
    isSelected: false,
    selectedLine: 0,
    itemStartLine: 0,
    onToggle: mockOnToggle,
    delegationExpandState: new Map<string, boolean>(),
    currentFocusId: 'timeline',
    extractDelegateThreadId: mockExtractDelegateThreadId
  };

  describe('user_message items', () => {
    it('should render user message with EventDisplay', () => {
      const item: TimelineItem = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE:unfocused');
    });

    it('should pass focus state to EventDisplay', () => {
      const item: TimelineItem = {
        id: 'msg-1',
        type: 'user_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello world'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps, isSelected: true })
      );

      expect(lastFrame()).toContain('EventDisplay:USER_MESSAGE:focused');
    });
  });

  describe('agent_message items', () => {
    it('should render agent message with EventDisplay', () => {
      const item: TimelineItem = {
        id: 'msg-2',
        type: 'agent_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Hello back'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('EventDisplay:AGENT_MESSAGE:unfocused');
    });
  });

  describe('system_message items', () => {
    it('should render system message with EventDisplay', () => {
      const item: TimelineItem = {
        id: 'sys-1',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification',
        originalEventType: 'SYSTEM_PROMPT'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('EventDisplay:SYSTEM_PROMPT:unfocused');
    });

    it('should use default event type when originalEventType missing', () => {
      const item: TimelineItem = {
        id: 'sys-2',
        type: 'system_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'System notification'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('EventDisplay:LOCAL_SYSTEM_MESSAGE:unfocused');
    });
  });

  describe('tool_execution items', () => {
    it('should render regular tool execution with ToolExecutionDisplay', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          id: 'call-123',
          name: 'bash',
          arguments: { command: 'ls' }
        },
        result: {
          id: 'call-123',
          content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
          isError: false
        }
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('ToolExecutionDisplay:bash:collapsed:unfocused');
    });

    it('should start collapsed by default with self-managed state', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
        call: {
          id: 'call-123',
          name: 'bash',
          arguments: { command: 'ls' }
        },
        result: {
          id: 'call-123',
          content: [{ type: 'text', text: 'file1.txt\nfile2.txt' }],
          isError: false
        }
      };


      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
        })
      );

      expect(lastFrame()).toContain('ToolExecutionDisplay:bash:collapsed:unfocused');
    });

    it('should handle tool execution without result', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-124',
        call: {
          id: 'call-124',
          name: 'file-read',
          arguments: { path: '/test.txt' }
        }
        // No result
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('ToolExecutionDisplay:file-read:collapsed:unfocused');
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
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' }
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'Thread: delegate-thread-456' }],
          isError: false
        }
      };

      const delegateTimelines = new Map([
        ['delegate-thread-456', createDelegateTimeline()]
      ]);

      mockExtractDelegateThreadId.mockReturnValue('delegate-thread-456');

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
          delegateTimelines 
        })
      );

      const frame = lastFrame();
      expect(frame).toContain('ToolExecutionDisplay:delegate:collapsed:unfocused');
      expect(frame).toContain('DelegationBox:delegate-thread-456:expanded');
    });

    it('should start expanded by default with self-managed state', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' }
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'Thread: delegate-thread-456' }],
          isError: false
        }
      };

      const delegateTimelines = new Map([
        ['delegate-thread-456', createDelegateTimeline()]
      ]);

      const delegationExpandState = new Map([['delegate-call-123', false]]);

      mockExtractDelegateThreadId.mockReturnValue('delegate-thread-456');

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
          delegateTimelines,
          delegationExpandState
        })
      );

      const frame = lastFrame();
      expect(frame).toContain('DelegationBox:delegate-thread-456:expanded');
    });

    it('should fall back to regular tool display when no delegate thread found', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' }
        },
        result: {
          id: 'delegate-call-123',
          content: [{ type: 'text', text: 'No thread found' }],
          isError: false
        }
      };

      const delegateTimelines = new Map([
        ['other-thread', createDelegateTimeline()]
      ]);

      mockExtractDelegateThreadId.mockReturnValue(null); // No thread found

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
          delegateTimelines 
        })
      );

      const frame = lastFrame();
      expect(frame).toContain('ToolExecutionDisplay:delegate:collapsed:unfocused');
      expect(frame).not.toContain('DelegationBox');
    });

    it('should handle delegate tool without delegateTimelines prop', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me with this' }
        }
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps
          // No delegateTimelines
        })
      );

      const frame = lastFrame();
      expect(frame).toContain('ToolExecutionDisplay:delegate:collapsed:unfocused');
      expect(frame).not.toContain('DelegationBox');
    });
  });

  describe('ephemeral_message items', () => {
    it('should render ephemeral message with MessageDisplay', () => {
      const item: TimelineItem = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'info'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('MessageDisplay:info:unfocused');
    });

    it('should pass focus state to MessageDisplay', () => {
      const item: TimelineItem = {
        type: 'ephemeral_message',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        content: 'Temporary message',
        messageType: 'warning'
      };

      const { lastFrame } = render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
          isSelected: true 
        })
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
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(lastFrame()).toContain('Unknown timeline item type');
    });
  });

  describe('extractDelegateThreadId integration', () => {
    it('should call extractDelegateThreadId for delegate tools', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'delegate-call-123',
        call: {
          id: 'delegate-call-123',
          name: 'delegate',
          arguments: { prompt: 'Help me' }
        }
      };

      const delegateTimelines = new Map();
      mockExtractDelegateThreadId.mockReturnValue(null);

      render(
        React.createElement(TimelineItemDisplay, { 
          item, 
          ...defaultProps, 
          delegateTimelines 
        })
      );

      expect(mockExtractDelegateThreadId).toHaveBeenCalledWith(item);
    });

    it('should not call extractDelegateThreadId for non-delegate tools', () => {
      const item: TimelineItem = {
        type: 'tool_execution',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'bash-call-123',
        call: {
          id: 'bash-call-123',
          name: 'bash',
          arguments: { command: 'ls' }
        }
      };

      render(
        React.createElement(TimelineItemDisplay, { item, ...defaultProps })
      );

      expect(mockExtractDelegateThreadId).not.toHaveBeenCalled();
    });
  });
});