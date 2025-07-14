// ABOUTME: Tests for timeline utility functions extracted from DelegationBox
// ABOUTME: Verifies timeline analysis functions for delegation and thread processing

import { describe, it, expect } from 'vitest';
import { Timeline } from '../../../../timeline-types.js';
import {
  isThreadComplete,
  extractTaskFromTimeline,
  calculateDuration,
  extractDelegateThreadId,
} from '../utils/timeline-utils.js';

// Create test data
function createTestTimeline(items: any[] = []): Timeline {
  return {
    items,
    metadata: {
      eventCount: items.length,
      messageCount: items.filter(
        (item) => item.type === 'user_message' || item.type === 'agent_message'
      ).length,
      lastActivity: new Date(),
    },
  };
}

function createTestToolExecutionItem(metadata?: { threadId?: string }) {
  return {
    result: {
      metadata,
    },
  };
}

describe('Timeline Utility Functions', () => {
  describe('isThreadComplete', () => {
    it('should return false for empty timeline', () => {
      const timeline = createTestTimeline();
      expect(isThreadComplete(timeline)).toBe(false);
    });

    it('should return true when last item is agent message with no pending tool calls', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          id: 'msg-2',
        },
      ]);

      expect(isThreadComplete(timeline)).toBe(true);
    });

    it('should return false when last item is not agent message', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'tool_execution',
          call: { id: 'call-1', name: 'bash', arguments: {} },
          timestamp: new Date('2024-01-01T10:00:01Z'),
          callId: 'call-1',
        },
      ]);

      expect(isThreadComplete(timeline)).toBe(false);
    });

    it('should return false when there are pending tool calls', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'tool_execution',
          call: { id: 'call-1', name: 'bash', arguments: {} },
          timestamp: new Date('2024-01-01T10:00:01Z'),
          callId: 'call-1',
          // No result = pending
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          id: 'msg-2',
        },
      ]);

      expect(isThreadComplete(timeline)).toBe(false);
    });

    it('should return true when all tool calls have results', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'tool_execution',
          call: { id: 'call-1', name: 'bash', arguments: {} },
          result: { id: 'call-1', content: [{ type: 'text', text: 'success' }], isError: false },
          timestamp: new Date('2024-01-01T10:00:01Z'),
          callId: 'call-1',
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          id: 'msg-2',
        },
      ]);

      expect(isThreadComplete(timeline)).toBe(true);
    });
  });

  describe('extractTaskFromTimeline', () => {
    it('should extract task from first agent message', () => {
      const timeline = createTestTimeline([
        {
          type: 'agent_message',
          content: 'I will help you calculate the sum of 3+6. Let me work on that for you.',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
      ]);

      expect(extractTaskFromTimeline(timeline)).toBe('I will help you calculate the sum of 3+6');
    });

    it('should extract task from first system message', () => {
      const timeline = createTestTimeline([
        {
          type: 'system_message',
          content: 'You are a helpful assistant. Your task is to solve math problems.',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
      ]);

      expect(extractTaskFromTimeline(timeline)).toBe('You are a helpful assistant');
    });

    it('should truncate long tasks to 50 characters', () => {
      const timeline = createTestTimeline([
        {
          type: 'agent_message',
          content:
            'This is a very long task description that should be truncated because it exceeds the maximum length of fifty characters.',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
      ]);

      expect(extractTaskFromTimeline(timeline)).toBe(
        'This is a very long task description that should b...'
      );
    });

    it('should return "Unknown Task" when no messages found', () => {
      const timeline = createTestTimeline([
        {
          type: 'tool_execution',
          call: { id: 'call-1', name: 'bash', arguments: {} },
          timestamp: new Date('2024-01-01T10:00:00Z'),
          callId: 'call-1',
        },
      ]);

      expect(extractTaskFromTimeline(timeline)).toBe('Unknown Task');
    });

    it('should return "Unknown Task" when message has no content', () => {
      const timeline = createTestTimeline([
        {
          type: 'agent_message',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
      ]);

      expect(extractTaskFromTimeline(timeline)).toBe('Unknown Task');
    });
  });

  describe('calculateDuration', () => {
    it('should return "0s" for empty timeline', () => {
      const timeline = createTestTimeline();
      expect(calculateDuration(timeline)).toBe('0s');
    });

    it('should calculate seconds for short durations', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T10:00:05Z'),
          id: 'msg-2',
        },
      ]);

      expect(calculateDuration(timeline)).toBe('5s');
    });

    it('should calculate minutes and seconds for medium durations', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T10:02:30Z'),
          id: 'msg-2',
        },
      ]);

      expect(calculateDuration(timeline)).toBe('2m 30s');
    });

    it('should calculate hours and minutes for long durations', () => {
      const timeline = createTestTimeline([
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'msg-1',
        },
        {
          type: 'agent_message',
          content: 'Hello back',
          timestamp: new Date('2024-01-01T11:15:00Z'),
          id: 'msg-2',
        },
      ]);

      expect(calculateDuration(timeline)).toBe('1h 15m');
    });
  });

  describe('extractDelegateThreadId', () => {
    it('should extract thread ID from metadata', () => {
      const item = createTestToolExecutionItem({ threadId: 'delegate-thread-123' });
      expect(extractDelegateThreadId(item)).toBe('delegate-thread-123');
    });

    it('should return null when no metadata', () => {
      const item = createTestToolExecutionItem();
      expect(extractDelegateThreadId(item)).toBe(null);
    });

    it('should return null when no threadId in metadata', () => {
      const item = createTestToolExecutionItem({});
      expect(extractDelegateThreadId(item)).toBe(null);
    });

    it('should return null when threadId is empty string', () => {
      const item = createTestToolExecutionItem({ threadId: '' });
      expect(extractDelegateThreadId(item)).toBe(null);
    });

    it('should return null when threadId is not a string', () => {
      const item = createTestToolExecutionItem({ threadId: 123 as any });
      expect(extractDelegateThreadId(item)).toBe(null);
    });

    it('should return null when threadId is null', () => {
      const item = createTestToolExecutionItem({ threadId: null as any });
      expect(extractDelegateThreadId(item)).toBe(null);
    });
  });
});
