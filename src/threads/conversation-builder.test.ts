import { describe, it, expect } from 'vitest';
import { buildWorkingConversation, buildCompleteHistory } from '~/threads/conversation-builder';
import type { ThreadEvent } from '~/threads/types';
import type { CompactionData } from '~/threads/compaction/types';

describe('conversation-builder', () => {
  const mockEvents: ThreadEvent[] = [
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
      data: 'Hi there',
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

    it('uses compacted events when compaction exists', () => {
      const compactionEvent: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 3,
          compactedEvents: [
            {
              id: 'c1',
              threadId: 'test-thread',
              type: 'AGENT_MESSAGE',
              timestamp: new Date('2024-01-01T10:01:00Z'),
              data: 'Summary: User said hello, I replied',
            },
          ],
        },
      };

      const newEvent: ThreadEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: 'I am fine',
      };

      const eventsWithCompaction = [...mockEvents, compactionEvent, newEvent];
      const result = buildWorkingConversation(eventsWithCompaction);

      expect(result).toEqual([
        (compactionEvent.data as unknown as CompactionData).compactedEvents[0],
        compactionEvent, // Include COMPACTION event itself
        newEvent, // Only events after compaction timestamp
      ]);
    });

    it('uses latest compaction when multiple exist', () => {
      const firstCompaction: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: [
            {
              id: 'c1',
              threadId: 'test-thread',
              type: 'AGENT_MESSAGE',
              timestamp: new Date('2024-01-01T10:01:00Z'),
              data: 'First summary',
            },
          ],
        },
      };

      const secondCompaction: ThreadEvent = {
        id: 'comp2',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:05:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 3,
          compactedEvents: [
            {
              id: 'c2',
              threadId: 'test-thread',
              type: 'AGENT_MESSAGE',
              timestamp: new Date('2024-01-01T10:01:00Z'),
              data: 'Second summary',
            },
          ],
        },
      };

      const eventsWithTwoCompactions = [...mockEvents, firstCompaction, secondCompaction];
      const result = buildWorkingConversation(eventsWithTwoCompactions);

      expect(result).toEqual([
        ...(secondCompaction.data as unknown as CompactionData).compactedEvents,
        secondCompaction, // Include COMPACTION event itself
      ]);
    });
  });

  describe('buildCompleteHistory', () => {
    it('returns all events including compaction events', () => {
      const compactionEvent: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: [],
        },
      };

      const allEvents = [...mockEvents, compactionEvent];
      const result = buildCompleteHistory(allEvents);

      expect(result).toEqual(allEvents);
    });
  });

  describe('tool result deduplication', () => {
    it('should remove duplicate TOOL_RESULT events with same toolCallId', () => {
      const events: ThreadEvent[] = [
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
      const events: ThreadEvent[] = [
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
      const events: ThreadEvent[] = [
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

    it('should work correctly with compacted events containing duplicates', () => {
      const compactionEvent: ThreadEvent = {
        id: 'comp1',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 'test-strategy',
          originalEventCount: 2,
          compactedEvents: [
            {
              id: 'c1',
              threadId: 'test-thread',
              type: 'TOOL_RESULT',
              timestamp: new Date('2024-01-01T10:01:00Z'),
              data: {
                id: 'tool-999',
                content: [{ type: 'text', text: 'Compacted result' }],
                status: 'completed',
              },
            },
          ],
        },
      };

      const duplicateAfterCompaction: ThreadEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'TOOL_RESULT',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: {
          id: 'tool-999',
          content: [{ type: 'text', text: 'Duplicate result' }],
          status: 'completed',
        },
      };

      const events = [compactionEvent, duplicateAfterCompaction];
      const result = buildWorkingConversation(events);

      // Should keep only the compacted result, filter the duplicate
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Compacted result'
      );
    });

    it('should keep first TOOL_RESULT event when multiple have different statuses', () => {
      const events: ThreadEvent[] = [
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

      // Should keep only the first result (completed - first encountered)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Completed result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('completed');
    });

    it('should test deduplication with failed status first', () => {
      const events: ThreadEvent[] = [
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
      const events: ThreadEvent[] = [
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

      // Should keep only the first result (aborted - first encountered)
      const toolResults = result.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { content: Array<{ text: string }> }).content[0].text).toBe(
        'Aborted result'
      );
      expect((toolResults[0].data as { status: string }).status).toBe('aborted');
    });
  });

  describe('malformed compaction data handling', () => {
    it('gracefully handles malformed compaction data by falling back to all events', () => {
      const malformedCompactionEvent: ThreadEvent = {
        id: 'compaction-bad',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          strategyId: 123, // Invalid type - should be string
          originalEventCount: 'invalid', // Invalid type - should be number
          compactedEvents: 'not-an-array', // Invalid type - should be array
        } as unknown as CompactionData, // Type assertion to bypass TS checking
      };

      const newEvent: ThreadEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: 'After malformed compaction',
      };

      const events = [...mockEvents, malformedCompactionEvent, newEvent];
      const result = buildWorkingConversation(events);

      // Should fall back to returning all events when compaction data is malformed
      expect(result).toEqual(events);
    });

    it('handles invalid compaction data gracefully', () => {
      const invalidCompactionEvent: ThreadEvent = {
        id: 'compaction-invalid',
        threadId: 'test-thread',
        type: 'COMPACTION',
        timestamp: new Date('2024-01-01T10:03:00Z'),
        data: {
          // Missing required fields to make it truly invalid
          wrongField: 'this is not CompactionData',
        } as unknown as CompactionData, // Type assertion to bypass TS checking
      };

      const newEvent: ThreadEvent = {
        id: 'e4',
        threadId: 'test-thread',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:04:00Z'),
        data: 'After invalid compaction',
      };

      const events = [...mockEvents, invalidCompactionEvent, newEvent];
      const result = buildWorkingConversation(events);

      // Should fall back to returning all events when compaction data is invalid
      expect(result).toEqual(events);
    });
  });
});
