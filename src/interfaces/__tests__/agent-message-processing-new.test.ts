// ABOUTME: Tests for simplified agent message processing after refactor
// ABOUTME: Verifies agent messages keep thinking blocks intact for AgentMessageDisplay to handle

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadProcessor } from '../thread-processor.js';
import { ThreadEvent } from '../../threads/types.js';

describe('Agent Message Processing - New Simplified Behavior', () => {
  let processor: ThreadProcessor;

  beforeEach(() => {
    processor = new ThreadProcessor();
  });

  describe('Simplified agent message processing', () => {
    it('should create single timeline item with full content including thinking blocks', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>Let me think about this</think>Here is my response',
        },
      ];

      const result = processor.processThreads(events).items;

      // New behavior: Creates 1 timeline item with full content
      expect(result).toHaveLength(1);

      expect(result[0]).toEqual({
        type: 'agent_message',
        content: '<think>Let me think about this</think>Here is my response', // Full content preserved
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('should handle multiple thinking blocks in single item', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>First thought</think>Some text<think>Second thought</think>Final response',
        },
      ];

      const result = processor.processThreads(events).items;

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

      const result = processor.processThreads(events).items;

      // New behavior: Creates 1 timeline item
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

      const result = processor.processThreads(events).items;

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

  describe('Ephemeral message processing', () => {
    it('should keep full assistant content with thinking blocks', () => {
      const ephemeralMessages = [
        {
          type: 'assistant' as const,
          content: '<think>I need to think</think>Here is my response',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      const result = processor.processEphemeralEvents(ephemeralMessages);

      // New behavior: Single ephemeral item with full content
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'ephemeral_message',
        messageType: 'assistant',
        content: '<think>I need to think</think>Here is my response', // Full content preserved
        timestamp: new Date('2024-01-01T10:00:00Z'),
      });
    });
  });
});
