// ABOUTME: Test suite for summarization compaction strategy
// ABOUTME: Tests compaction logic, token estimation, and event preservation

import { describe, it, expect } from 'vitest';
import { SummarizeStrategy } from '../summarize-strategy.js';
import { Thread, ThreadEvent } from '../../types.js';

describe('SummarizeStrategy', () => {
  const createThread = (events: ThreadEvent[]): Thread => ({
    id: 'test_thread',
    createdAt: new Date(),
    updatedAt: new Date(),
    events,
  });

  const createEvent = (id: string, type: string, data: string, timestamp = new Date()): ThreadEvent => ({
    id,
    threadId: 'test_thread',
    type: type as any,
    timestamp,
    data,
  });

  describe('shouldCompact', () => {
    it('should return false for threads under token limit', () => {
      const strategy = new SummarizeStrategy({ maxTokens: 1000 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Short message'),
        createEvent('2', 'AGENT_MESSAGE', 'Short reply'),
      ];
      const thread = createThread(events);

      expect(strategy.shouldCompact(thread)).toBe(false);
    });

    it('should return true for threads over token limit', () => {
      const strategy = new SummarizeStrategy({ maxTokens: 50 });
      const longMessage = 'This is a very long message that should exceed the token limit when repeated multiple times. '.repeat(10);
      const events = [
        createEvent('1', 'USER_MESSAGE', longMessage),
        createEvent('2', 'AGENT_MESSAGE', longMessage),
      ];
      const thread = createThread(events);

      expect(strategy.shouldCompact(thread)).toBe(true);
    });

    it('should use default token limit when not specified', () => {
      const strategy = new SummarizeStrategy();
      const events = [createEvent('1', 'USER_MESSAGE', 'Short message')];
      const thread = createThread(events);

      expect(strategy.shouldCompact(thread)).toBe(false);
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

      // Should have: all user/agent messages + 1 summary for tool events + 3 recent events
      // Important events: 1, 2, 5, 6 (all user/agent messages)
      // Summarizable events: 3, 4 (tool call/result)
      // Recent events: 4, 5, 6 (last 3)
      // Result: [summary] + [1, 2] + [4, 5, 6] = 6 events
      expect(compacted).toHaveLength(6);
      
      // First event should be summary
      expect(compacted[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
      expect(compacted[0].data).toContain('**Compaction Summary**');
      
      // All user and agent messages should be preserved
      const userAgentEvents = compacted.filter(e => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE');
      expect(userAgentEvents).toHaveLength(4);
      expect(userAgentEvents.map(e => e.id)).toEqual(['1', '2', '5', '6']);
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

      // Should have: [summary for tool events] + [preserved user message] + [recent user message]
      // Since event 3 is both important (user message) and recent, it appears once
      expect(compacted).toHaveLength(2);
      expect(compacted[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
      expect(compacted[0].data).toContain('🗜️ **Compaction Summary**');
      expect(compacted[0].data).toContain('2 events');
      expect(compacted[0].data).toContain('compressed');
      expect(compacted[1].id).toBe('3'); // The user message is preserved
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
      expect(compacted.every(e => e.type === 'USER_MESSAGE')).toBe(true);
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

      // Should have: [summary for tool events] + [all user/agent messages] + [recent events]
      // Important: 4, 5 (user/agent messages)
      // Recent: 4, 5 (last 2)
      // Summary: for events 1, 2, 3
      expect(compacted).toHaveLength(3); // summary + 2 user/agent messages
      expect(compacted[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
      expect(compacted[1].type).toBe('USER_MESSAGE');
      expect(compacted[2].type).toBe('AGENT_MESSAGE');
    });
  });
});