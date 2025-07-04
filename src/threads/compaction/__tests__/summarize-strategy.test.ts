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
    it('should preserve recent events', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 3 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Old message 1'),
        createEvent('2', 'AGENT_MESSAGE', 'Old reply 1'),
        createEvent('3', 'USER_MESSAGE', 'Old message 2'),
        createEvent('4', 'AGENT_MESSAGE', 'Recent message 1'),
        createEvent('5', 'USER_MESSAGE', 'Recent message 2'),
        createEvent('6', 'AGENT_MESSAGE', 'Recent message 3'),
      ];

      const compacted = strategy.compact(events);

      // Should have 1 summary + 3 preserved recent events
      expect(compacted).toHaveLength(4);
      
      // First event should be summary
      expect(compacted[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
      expect(compacted[0].data).toContain('Summarized 3 earlier messages');
      
      // Last 3 events should be preserved
      expect(compacted[1].id).toBe('4');
      expect(compacted[2].id).toBe('5');
      expect(compacted[3].id).toBe('6');
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

    it('should create meaningful summary message', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 1 });
      const events = [
        createEvent('1', 'USER_MESSAGE', 'Old message 1'),
        createEvent('2', 'AGENT_MESSAGE', 'Old reply 1'),
        createEvent('3', 'USER_MESSAGE', 'Recent message'),
      ];

      const compacted = strategy.compact(events);

      expect(compacted).toHaveLength(2);
      expect(compacted[0].type).toBe('LOCAL_SYSTEM_MESSAGE');
      expect(compacted[0].data).toContain('📝 Summarized 2 earlier messages');
      expect(compacted[0].data).toContain('save tokens');
    });
  });

  describe('configuration', () => {
    it('should use default values when no config provided', () => {
      const strategy = new SummarizeStrategy();
      const events = Array.from({ length: 15 }, (_, i) => 
        createEvent(`${i}`, 'USER_MESSAGE', 'Test message')
      );

      const compacted = strategy.compact(events);

      // Should preserve 10 recent events (default) + 1 summary
      expect(compacted).toHaveLength(11);
    });

    it('should respect custom preserve count', () => {
      const strategy = new SummarizeStrategy({ preserveRecentEvents: 2 });
      const events = Array.from({ length: 5 }, (_, i) => 
        createEvent(`${i}`, 'USER_MESSAGE', 'Test message')
      );

      const compacted = strategy.compact(events);

      // Should preserve 2 recent events + 1 summary
      expect(compacted).toHaveLength(3);
    });
  });
});