// ABOUTME: Tests for agent message processing after timeline refactor
// ABOUTME: Documents new behavior where thinking blocks stay within agent messages

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadProcessor } from '../thread-processor.js';
import { ThreadEvent } from '../../threads/types.js';

describe('Agent Message Processing - Unified Content', () => {
  let processor: ThreadProcessor;

  beforeEach(() => {
    processor = new ThreadProcessor();
  });

  describe('Unified content behavior', () => {
    it('should keep agent message with thinking as single timeline item', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>Let me think about this</think>Here is my response',
        },
      ];

      const result = processor.processEvents(events);

      // New behavior: Creates 1 timeline item with full content
      expect(result).toHaveLength(1);

      // Single item: agent message with thinking blocks intact
      expect(result[0]).toEqual({
        type: 'agent_message',
        content: '<think>Let me think about this</think>Here is my response',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('should handle multiple thinking blocks', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>First thought</think>Some text<think>Second thought</think>Final response',
        },
      ];

      const result = processor.processEvents(events);

      // New behavior: Creates 1 timeline item with full content
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'agent_message',
        content: '<think>First thought</think>Some text<think>Second thought</think>Final response',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('should handle agent message with no thinking blocks', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Just a regular response',
        },
      ];

      const result = processor.processEvents(events);

      // Behavior unchanged: Creates 1 timeline item (no thinking blocks)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'agent_message',
        content: 'Just a regular response',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('should handle agent message with only thinking blocks', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>Only thinking here</think>',
        },
      ];

      const result = processor.processEvents(events);

      // New behavior: Creates 1 agent message item with thinking content
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'agent_message',
        content: '<think>Only thinking here</think>',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });
  });
});
