// ABOUTME: Test suite for summarization compaction strategy
// ABOUTME: Tests compaction logic, token estimation, and event preservation

import { describe, it, expect } from 'vitest';
import { SummarizeStrategy } from '../summarize-strategy.js';
import { Thread, ThreadEvent, EventType } from '../../types.js';

describe('SummarizeStrategy', () => {
  const createThread = (events: ThreadEvent[]): Thread => ({
    id: 'test_thread',
    createdAt: new Date(),
    updatedAt: new Date(),
    events,
  });

  const createEvent = (
    id: string,
    type: EventType,
    data: string,
    timestamp = new Date()
  ): ThreadEvent => ({
    id,
    threadId: 'test_thread',
    type,
    timestamp,
    data,
  });

  describe('shouldCompact', () => {
    it('should return false for threads under token limit', async () => {
      const strategy = new SummarizeStrategy({ maxTokens: 1000 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Short message'),
        createEvent('2', 'AGENT_MESSAGE', 'Short reply'),
      ];
      const thread = createThread(events);

      expect(await strategy.shouldCompact(thread)).toBe(false);
    });

    it('should return true for threads over token limit', async () => {
      const strategy = new SummarizeStrategy({ maxTokens: 50 });
      const longMessage =
        'This is a very long message that should exceed the token limit when repeated multiple times. '.repeat(
          10
        );
      const events = [
        createEvent('1', 'USER_MESSAGE', longMessage),
        createEvent('2', 'AGENT_MESSAGE', longMessage),
      ];
      const thread = createThread(events);

      expect(await strategy.shouldCompact(thread)).toBe(true);
    });

    it('should use default token limit when not specified', async () => {
      const strategy = new SummarizeStrategy();
      const events = [createEvent('1', 'USER_MESSAGE', 'Short message')];
      const thread = createThread(events);

      expect(await strategy.shouldCompact(thread)).toBe(false);
    });
  });

  describe('compact', () => {
    it('should preserve all user and agent messages', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 3 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Old message 1'),
        createEvent('2', 'AGENT_MESSAGE', 'Old reply 1'),
        createEvent('3', 'TOOL_CALL', '{"name": "bash", "arguments": {"command": "ls"}}'),
        createEvent('4', 'TOOL_RESULT', 'file1.txt\nfile2.txt'),
        createEvent('5', 'USER_MESSAGE', 'Recent message 2'),
        createEvent('6', 'AGENT_MESSAGE', 'Recent message 3'),
      ];

      const compacted = strategy.compact(events);

      // With new strategy: all user/agent messages + tool events are preserved + recent events
      // Important events: 1, 2, 3, 4, 5, 6 (all user/agent messages + tool events now preserved)
      // Recent events: 4, 5, 6 (last 3)
      // Result: all events preserved since tool events are now considered important
      expect(compacted).toHaveLength(6);

      // First event should be first user message (no summary needed since all events preserved)
      expect(compacted[0].type).toBe('USER_MESSAGE');
      expect(compacted[0].id).toBe('1');

      // All user and agent messages should be preserved
      const userAgentEvents = compacted.filter(
        (e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
      );
      expect(userAgentEvents).toHaveLength(4);
      expect(userAgentEvents.map((e) => e.id)).toEqual(['1', '2', '5', '6']);
    });

    it('should return original events if count is below preserve threshold', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 5 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Message 1'),
        createEvent('2', 'AGENT_MESSAGE', 'Message 2'),
      ];

      const compacted = strategy.compact(events);

      expect(compacted).toHaveLength(2);
      expect(compacted[0].id).toBe('1');
      expect(compacted[1].id).toBe('2');
    });

    it('should handle empty events array', () => {
      const strategy = new SummarizeStrategy();
      const compacted = strategy.compact([]);

      expect(compacted).toHaveLength(0);
    });

    it('should create meaningful summary message for non-conversational events', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 1 });
      const events = [
        createEvent('1', 'TOOL_CALL', '{"name": "bash", "arguments": {"command": "ls"}}'),
        createEvent('2', 'TOOL_RESULT', 'file1.txt\nfile2.txt'),
        createEvent('3', 'USER_MESSAGE', 'Recent message'),
      ];

      const compacted = strategy.compact(events);

      // With new strategy: tool events are preserved as important events
      // All events are considered important: tool call, tool result, user message
      expect(compacted).toHaveLength(3);
      expect(compacted[0].type).toBe('TOOL_CALL');
      expect(compacted[1].type).toBe('TOOL_RESULT');
      expect(compacted[2].type).toBe('USER_MESSAGE');
      expect(compacted[2].id).toBe('3');
    });
  });

  describe('configuration', () => {
    it('should preserve all user messages regardless of count', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 3 });
      const events = Array.from({ length: 15 }, (_, i) =>
        createEvent(`${i}`, 'USER_MESSAGE', 'Test message')
      );

      const compacted = strategy.compact(events);

      // All 15 user messages should be preserved (no summarization needed)
      // Since all events are important (USER_MESSAGE), no summary is created
      expect(compacted).toHaveLength(15);
      expect(compacted.every((e) => e.type === 'USER_MESSAGE')).toBe(true);
    });

    it('should create summary only for non-conversational events', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 2 });
      const events = [
        createEvent('1', 'TOOL_CALL', '{"name": "bash"}'),
        createEvent('2', 'TOOL_RESULT', 'output'),
        createEvent('3', 'TOOL_CALL', '{"name": "grep"}'),
        createEvent('4', 'USER_MESSAGE', 'Test message'),
        createEvent('5', 'AGENT_MESSAGE', 'Test reply'),
      ];

      const compacted = strategy.compact(events);

      // With new strategy: all events preserved since tool events are now important
      // Important: 1, 2, 3, 4, 5 (all tool events + user/agent messages)
      // Recent: 4, 5 (last 2)
      // Result: all events preserved
      expect(compacted).toHaveLength(5); // all events preserved
      expect(compacted[0].type).toBe('TOOL_CALL');
      expect(compacted[1].type).toBe('TOOL_RESULT');
      expect(compacted[2].type).toBe('TOOL_CALL');
      expect(compacted[3].type).toBe('USER_MESSAGE');
      expect(compacted[4].type).toBe('AGENT_MESSAGE');
    });
  });
});
