// ABOUTME: Unit tests for timeline item focus detection utilities
// ABOUTME: Tests focus capability detection, focus ID generation, and delegate result validation

import { describe, it, expect } from 'vitest';
import {
  canTimelineItemAcceptFocus,
  getTimelineItemFocusId,
  isDelegateToolCallResult,
  extractDelegateThreadId,
  isDelegateToolExecution,
} from './timeline-item-focus.js';
import { TimelineItem } from '../../timeline-types.js';
import { FocusRegions } from '../focus/index.js';

describe('timeline-item-focus', () => {
  // Helper to create mock timeline items
  function createMockUserMessage(): TimelineItem {
    return {
      type: 'user_message',
      content: 'test message',
      timestamp: new Date(),
      id: 'user-1',
    };
  }

  function createMockAgentMessage(): TimelineItem {
    return {
      type: 'agent_message',
      content: 'test response',
      timestamp: new Date(),
      id: 'agent-1',
    };
  }

  function createMockBashToolCall(): TimelineItem {
    return {
      type: 'tool_execution',
      call: {
        name: 'bash',
        id: 'call-1',
        arguments: { command: 'ls -la' },
      },
      result: {
        content: [{ type: 'text' as const, text: 'file1.txt\nfile2.txt' }],
        isError: false,
      },
      timestamp: new Date(),
      callId: 'call-1',
    };
  }

  function createMockDelegateToolCall(
    threadId: string = 'delegate-123',
    isError: boolean = false
  ): TimelineItem {
    const result = isError
      ? {
          content: [{ type: 'text' as const, text: 'Error: Could not create delegate' }],
          isError: true,
        }
      : {
          content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
          isError: false,
          metadata: { threadId },
        };

    return {
      type: 'tool_execution',
      call: {
        name: 'delegate',
        id: 'call-delegate-1',
        arguments: { task: 'test task' },
      },
      result,
      timestamp: new Date(),
      callId: 'call-delegate-1',
    };
  }

  function createMockDelegateToolCallWithoutResult(): TimelineItem {
    return {
      type: 'tool_execution',
      call: {
        name: 'delegate',
        id: 'call-delegate-2',
        arguments: { task: 'pending task' },
      },
      timestamp: new Date(),
      callId: 'call-delegate-2',
    };
  }

  describe('canTimelineItemAcceptFocus', () => {
    it('returns false for user messages', () => {
      const item = createMockUserMessage();
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns false for agent messages', () => {
      const item = createMockAgentMessage();
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns false for non-delegate tool calls', () => {
      const item = createMockBashToolCall();
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns true for successful delegate tool calls', () => {
      const item = createMockDelegateToolCall();
      expect(canTimelineItemAcceptFocus(item)).toBe(true);
    });

    it('returns false for failed delegate tool calls', () => {
      const item = createMockDelegateToolCall('delegate-123', true);
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns false for delegate tool calls without results', () => {
      const item = createMockDelegateToolCallWithoutResult();
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns false for delegate tool calls with invalid result format', () => {
      const item = createMockDelegateToolCall();
      // Corrupt the result
      if (item.type === 'tool_execution' && item.result) {
        item.result.content = [{ type: 'text' as const, text: 'invalid json' }];
        item.result.metadata = {}; // Remove threadId from metadata
      }
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });

    it('returns false for delegate tool calls with missing threadId', () => {
      const item = createMockDelegateToolCall();
      // Result without threadId
      if (item.type === 'tool_execution' && item.result) {
        item.result.content = [{ type: 'text' as const, text: 'Delegation created successfully' }];
        item.result.metadata = {}; // No threadId in metadata
      }
      expect(canTimelineItemAcceptFocus(item)).toBe(false);
    });
  });

  describe('getTimelineItemFocusId', () => {
    it('returns null for non-focusable items', () => {
      const item = createMockUserMessage();
      expect(getTimelineItemFocusId(item)).toBeNull();
    });

    it('returns delegate focus ID for focusable delegate tool calls', () => {
      const item = createMockDelegateToolCall('test-thread-456');
      const focusId = getTimelineItemFocusId(item);
      expect(focusId).toBe(FocusRegions.delegate('test-thread-456'));
    });

    it('returns null for failed delegate tool calls', () => {
      const item = createMockDelegateToolCall('test-thread', true);
      expect(getTimelineItemFocusId(item)).toBeNull();
    });

    it('returns null for delegate tool calls without results', () => {
      const item = createMockDelegateToolCallWithoutResult();
      expect(getTimelineItemFocusId(item)).toBeNull();
    });

    it('returns null for delegate tool calls with corrupted results', () => {
      const item = createMockDelegateToolCall();
      if (item.type === 'tool_execution' && item.result) {
        item.result.content = [{ type: 'text' as const, text: 'not json' }];
        item.result.metadata = {}; // Remove threadId from metadata
      }
      expect(getTimelineItemFocusId(item)).toBeNull();
    });
  });

  describe('isDelegateToolCallResult', () => {
    it('returns true for valid delegate results', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { threadId: 'test-123' },
      };
      expect(isDelegateToolCallResult(result)).toBe(true);
    });

    it('returns false for error results', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Error occurred' }],
        isError: true,
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for null result', () => {
      expect(isDelegateToolCallResult(null)).toBe(false);
    });

    it('returns false for undefined result', () => {
      expect(isDelegateToolCallResult(undefined)).toBe(false);
    });

    it('returns false for result without content', () => {
      const result = { isError: false };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for result with empty content', () => {
      const result = {
        content: [],
        isError: false,
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for result with invalid JSON', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'not valid json {' }],
        isError: false,
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for result without threadId', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { status: 'created' }, // No threadId in metadata
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for result with empty threadId', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { threadId: '' },
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });

    it('returns false for result with non-string threadId', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { threadId: 123 },
      };
      expect(isDelegateToolCallResult(result)).toBe(false);
    });
  });

  describe('extractDelegateThreadId', () => {
    it('extracts threadId from valid delegate results', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { threadId: 'extracted-thread-789' },
      };
      expect(extractDelegateThreadId(result)).toBe('extracted-thread-789');
    });

    it('returns null for invalid results', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'invalid json' }],
        isError: false,
      };
      expect(extractDelegateThreadId(result)).toBeNull();
    });

    it('returns null for null result', () => {
      expect(extractDelegateThreadId(null)).toBeNull();
    });

    it('returns null for result without threadId', () => {
      const result = {
        content: [{ type: 'text' as const, text: 'Delegation created successfully' }],
        isError: false,
        metadata: { status: 'created' }, // No threadId in metadata
      };
      expect(extractDelegateThreadId(result)).toBeNull();
    });
  });

  describe('isDelegateToolExecution', () => {
    it('returns true for delegate tool execution items', () => {
      const item = createMockDelegateToolCall();
      expect(isDelegateToolExecution(item)).toBe(true);
    });

    it('returns false for non-delegate tool execution items', () => {
      const item = createMockBashToolCall();
      expect(isDelegateToolExecution(item)).toBe(false);
    });

    it('returns false for non-tool execution items', () => {
      const item = createMockUserMessage();
      expect(isDelegateToolExecution(item)).toBe(false);
    });

    it('returns true regardless of result status', () => {
      const failedItem = createMockDelegateToolCall('thread', true);
      expect(isDelegateToolExecution(failedItem)).toBe(true);

      const pendingItem = createMockDelegateToolCallWithoutResult();
      expect(isDelegateToolExecution(pendingItem)).toBe(true);
    });
  });
});
