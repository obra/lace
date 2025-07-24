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
          originalEventCount: 2,
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
        newEvent,
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

      expect(result).toEqual((secondCompaction.data as unknown as CompactionData).compactedEvents);
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
});
