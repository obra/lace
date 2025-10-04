import { describe, it, expect } from 'vitest';
import { buildWorkingConversation, buildCompleteHistory } from './conversation-builder';
import type { LaceEvent } from './types';

describe('conversation-builder', () => {
  const mockEvents: LaceEvent[] = [
    {
      id: 'e1',
      threadId: 'test-thread',
      type: 'USER_MESSAGE',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      data: 'Hello',
    },
    {
      id: 'e2',
      threadId: 'test-thread',
      type: 'AGENT_MESSAGE',
      timestamp: new Date('2024-01-01T10:01:00Z'),
      data: { content: 'Hi there' },
    },
    {
      id: 'e3',
      threadId: 'test-thread',
      type: 'USER_MESSAGE',
      timestamp: new Date('2024-01-01T10:02:00Z'),
      data: 'How are you?',
    },
  ];

  describe('buildWorkingConversation', () => {
    it('returns all events when no compaction exists', () => {
      const result = buildWorkingConversation(mockEvents);
      expect(result).toEqual(mockEvents);
    });

    it('filters out events with visibleToModel: false', () => {
      const hiddenEvent: LaceEvent = {
        id: 'e1',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Hidden message',
        visibleToModel: false,
      };

      const visibleEvent: LaceEvent = {
        id: 'e2',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { content: 'Visible message' },
      };

      const undefinedVisibilityEvent: LaceEvent = {
        id: 'e3',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: 'Also visible',
        visibleToModel: undefined,
      };

      const events = [hiddenEvent, visibleEvent, undefinedVisibilityEvent];
      const result = buildWorkingConversation(events);

      // Should exclude only the event with visibleToModel: false
      expect(result).toEqual([visibleEvent, undefinedVisibilityEvent]);
    });

    it('treats undefined and true visibleToModel as visible', () => {
      const eventWithTrue: LaceEvent = {
        id: 'e1',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Visible with true',
        visibleToModel: true,
      };

      const eventWithUndefined: LaceEvent = {
        id: 'e2',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { content: 'Visible with undefined' },
        visibleToModel: undefined,
      };

      const eventWithNoField: LaceEvent = {
        id: 'e3',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:02:00Z'),
        data: 'Visible without field',
      };

      const events = [eventWithTrue, eventWithUndefined, eventWithNoField];
      const result = buildWorkingConversation(events);

      // All should be visible
      expect(result).toEqual(events);
    });
  });

  describe('buildCompleteHistory', () => {
    it('returns all events including hidden ones', () => {
      const hiddenEvent: LaceEvent = {
        id: 'e1',
        threadId: 'test-thread',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Hidden message',
        visibleToModel: false,
      };

      const visibleEvent: LaceEvent = {
        id: 'e2',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { content: 'Visible message' },
      };

      const allEvents = [hiddenEvent, visibleEvent];
      const result = buildCompleteHistory(allEvents);

      // buildCompleteHistory returns ALL events, regardless of visibleToModel flag
      expect(result).toEqual(allEvents);
    });
  });

  describe('tool result deduplication', () => {
    it('should remove duplicate TOOL_RESULT events with same toolCallId', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: { id: 'tool-123', name: 'test', arguments: {} },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Result 1' }],
            status: 'completed',
          },
        },
        {
          id: 'evt3',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Result 2' }],
            status: 'completed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should have tool call + only one tool result (the first one)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Result 1'
      );
    });

    it('should keep TOOL_RESULT events with different toolCallIds', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Result A' }],
            status: 'completed',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-456',
            content: [{ type: 'text', text: 'Result B' }],
            status: 'completed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should keep both tool results (different IDs)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(2);
    });

    it('should skip TOOL_RESULT events missing toolCallId', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: { content: [{ type: 'text', text: 'Result without ID' }], status: 'completed' }, // Missing id field
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Valid result' }],
            status: 'completed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should skip the one without ID, keep the valid one
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { id: string }).id).toBe('tool-123');
    });

    it('should work correctly with visible and hidden events containing duplicates', () => {
      const visibleResult: LaceEvent = {
        id: 'c1',
        threadId: 'test-thread',
        type: 'TOOL_RESULT',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: {
          id: 'tool-999',
          content: [{ type: 'text', text: 'Visible result' }],
          status: 'completed',
        },
        visibleToModel: true,
      };

      const hiddenDuplicate: LaceEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'TOOL_RESULT',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: {
          id: 'tool-999',
          content: [{ type: 'text', text: 'Hidden duplicate' }],
          status: 'completed',
        },
        visibleToModel: false,
      };

      const events = [visibleResult, hiddenDuplicate];
      const result = buildWorkingConversation(events);

      // Should keep only the visible result (hidden is filtered by visibleToModel)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Visible result'
      );
    });

    it('should keep higher precedence status when multiple TOOL_RESULT events have same ID', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Completed result' }],
            status: 'completed',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Aborted result' }],
            status: 'aborted',
          },
        },
        {
          id: 'evt3',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:03:00Z'),
          data: {
            id: 'tool-123',
            content: [{ type: 'text', text: 'Failed result' }],
            status: 'failed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should keep the failed result (highest precedence: failed > aborted > completed)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Failed result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('failed');
    });

    it('should test deduplication with failed status first', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-456',
            content: [{ type: 'text', text: 'Failed result' }],
            status: 'failed',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-456',
            content: [{ type: 'text', text: 'Completed result' }],
            status: 'completed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should keep only the first result (failed - first encountered)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Failed result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('failed');
    });

    it('should test deduplication with aborted status first', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-789',
            content: [{ type: 'text', text: 'Aborted result' }],
            status: 'aborted',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-789',
            content: [{ type: 'text', text: 'Completed result' }],
            status: 'completed',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should keep the aborted result (aborted > completed)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Aborted result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('aborted');
    });

    it('should prioritize denied status over all others', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: {
            id: 'tool-999',
            content: [{ type: 'text', text: 'Completed result' }],
            status: 'completed',
          },
        },
        {
          id: 'evt2',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: {
            id: 'tool-999',
            content: [{ type: 'text', text: 'Failed result' }],
            status: 'failed',
          },
        },
        {
          id: 'evt3',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:03:00Z'),
          data: {
            id: 'tool-999',
            content: [{ type: 'text', text: 'Denied result' }],
            status: 'denied',
          },
        },
        {
          id: 'evt4',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:04:00Z'),
          data: {
            id: 'tool-999',
            content: [{ type: 'text', text: 'Aborted result' }],
            status: 'aborted',
          },
        },
      ];

      const result = buildWorkingConversation(events);

      // Should keep the denied result (denied > failed > aborted > completed)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Denied result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('denied');
    });
  });

  describe('visibleToModel filtering edge cases', () => {
    it('handles mixed visibility flags correctly', () => {
      const events: LaceEvent[] = [
        {
          id: 'e1',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Visible 1',
          visibleToModel: true,
        },
        {
          id: 'e2',
          threadId: 'test-thread',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          data: { content: 'Hidden 1' },
          visibleToModel: false,
        },
        {
          id: 'e3',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: 'Visible 2',
        },
        {
          id: 'e4',
          threadId: 'test-thread',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:03:00Z'),
          data: { content: 'Hidden 2' },
          visibleToModel: false,
        },
        {
          id: 'e5',
          threadId: 'test-thread',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:04:00Z'),
          data: 'Visible 3',
          visibleToModel: undefined,
        },
      ];

      const result = buildWorkingConversation(events);

      // Should only include events with visibleToModel !== false
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('e1');
      expect(result[1].id).toBe('e3');
      expect(result[2].id).toBe('e5');
    });

    it('empty event list returns empty result', () => {
      const result = buildWorkingConversation([]);
      expect(result).toEqual([]);
    });
  });
});
