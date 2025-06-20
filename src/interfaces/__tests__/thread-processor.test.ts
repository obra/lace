// ABOUTME: Comprehensive tests for ThreadProcessor including performance optimization features
// ABOUTME: Tests caching, thinking block extraction, tool grouping, and timeline generation

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThreadProcessor,
  EphemeralMessage,
  ProcessedThreadItems,
  EphemeralTimelineItems,
} from '../thread-processor.js';
import { ThreadEvent, ToolCallData, ToolResultData } from '../../threads/types.js';

describe('ThreadProcessor', () => {
  let processor: ThreadProcessor;

  beforeEach(() => {
    processor = new ThreadProcessor();
  });

  describe('processEvents (caching)', () => {
    const sampleEvents: ThreadEvent[] = [
      {
        id: 'user-1',
        threadId: 'thread-1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Hello world',
      },
      {
        id: 'agent-1',
        threadId: 'thread-1',
        type: 'AGENT_MESSAGE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: 'Hi there!',
      },
    ];

    it('processes thread events into timeline items', () => {
      const result = processor.processEvents(sampleEvents);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'user_message',
        content: 'Hello world',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'user-1',
      });
      expect(result[1]).toEqual({
        type: 'agent_message',
        content: 'Hi there!',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        id: 'agent-1',
      });
    });

    it('caches results for identical event arrays', () => {
      const result1 = processor.processEvents(sampleEvents);
      const result2 = processor.processEvents(sampleEvents);

      // Should return exact same reference (cached)
      expect(result1).toBe(result2);
    });

    it('reprocesses when events change', () => {
      const result1 = processor.processEvents(sampleEvents);

      const newEvents = [
        ...sampleEvents,
        {
          id: 'user-2',
          threadId: 'thread-1',
          type: 'USER_MESSAGE' as const,
          timestamp: new Date('2024-01-01T10:02:00Z'),
          data: 'Another message',
        },
      ];

      const result2 = processor.processEvents(newEvents);

      // Should be different references and different lengths
      expect(result1).not.toBe(result2);
      expect(result1).toHaveLength(2);
      expect(result2).toHaveLength(3);
    });

    it('clears cache when requested', () => {
      const result1 = processor.processEvents(sampleEvents);
      processor.clearCache();
      const result2 = processor.processEvents(sampleEvents);

      // Should be different references after cache clear
      expect(result1).not.toBe(result2);
      // But should have same content
      expect(result1).toEqual(result2);
    });
  });

  describe('thinking block extraction', () => {
    it('extracts thinking blocks from agent messages', () => {
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

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'thinking',
        content: 'Let me think about this',
        timestamp: new Date('2024-01-01T09:59:59.990Z'), // Slight offset
        id: 'agent-1_thinking_0',
      });
      expect(result[1]).toEqual({
        type: 'agent_message',
        content: 'Here is my response',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('handles multiple thinking blocks in one message', () => {
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

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('thinking');
      expect('content' in result[0] ? result[0].content : '').toBe('First thought');
      expect(result[1].type).toBe('thinking');
      expect('content' in result[1] ? result[1].content : '').toBe('Second thought');
      expect(result[2].type).toBe('agent_message');
      expect('content' in result[2] ? result[2].content : '').toBe('Some textFinal response');
    });

    it('handles agent messages with no thinking blocks', () => {
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

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'agent_message',
        content: 'Just a regular response',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'agent-1',
      });
    });

    it('handles standalone THINKING events', () => {
      const events: ThreadEvent[] = [
        {
          id: 'thinking-1',
          threadId: 'thread-1',
          type: 'THINKING',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Standalone thinking block',
        },
      ];

      const result = processor.processEvents(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'thinking',
        content: 'Standalone thinking block',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'thinking-1',
      });
    });
  });

  describe('tool call grouping', () => {
    it('groups tool calls with their results', () => {
      const toolCallData: ToolCallData = {
        toolName: 'bash',
        input: { command: 'ls' },
        callId: 'call-123',
      };

      const toolResultData: ToolResultData = {
        callId: 'call-123',
        output: 'file1.txt\nfile2.txt',
        success: true,
      };

      const events: ThreadEvent[] = [
        {
          id: 'call-1',
          threadId: 'thread-1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: toolCallData,
        },
        {
          id: 'result-1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          data: toolResultData,
        },
      ];

      const result = processor.processEvents(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'tool_execution',
        call: toolCallData,
        result: toolResultData,
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
      });
    });

    it('handles tool calls without results', () => {
      const toolCallData: ToolCallData = {
        toolName: 'bash',
        input: { command: 'ls' },
        callId: 'call-123',
      };

      const events: ThreadEvent[] = [
        {
          id: 'call-1',
          threadId: 'thread-1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: toolCallData,
        },
      ];

      const result = processor.processEvents(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'tool_execution',
        call: toolCallData,
        result: undefined,
        timestamp: new Date('2024-01-01T10:00:00Z'),
        callId: 'call-123',
      });
    });

    it('handles orphaned tool results', () => {
      const toolResultData: ToolResultData = {
        callId: 'missing-call',
        output: 'orphaned result',
        success: true,
      };

      const events: ThreadEvent[] = [
        {
          id: 'result-1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: toolResultData,
        },
      ];

      const result = processor.processEvents(events);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'system_message',
        content: 'Tool result (orphaned): orphaned result',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        id: 'result-1',
      });
    });
  });

  describe('processEphemeralEvents', () => {
    it('converts ephemeral messages to timeline items', () => {
      const ephemeralMessages: EphemeralMessage[] = [
        {
          type: 'assistant',
          content: 'Streaming response...',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        },
        {
          type: 'thinking',
          content: 'Let me think...',
          timestamp: new Date('2024-01-01T10:00:01Z'),
        },
      ];

      const result = processor.processEphemeralEvents(ephemeralMessages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'ephemeral_message',
        messageType: 'assistant',
        content: 'Streaming response...',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      });
      expect(result[1]).toEqual({
        type: 'ephemeral_message',
        messageType: 'thinking',
        content: 'Let me think...',
        timestamp: new Date('2024-01-01T10:00:01Z'),
      });
    });
  });

  describe('buildTimeline', () => {
    it('merges processed events and ephemeral items chronologically', () => {
      const processedEvents: ProcessedThreadItems = [
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'user-1',
        },
        {
          type: 'agent_message',
          content: 'Hi there',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          id: 'agent-1',
        },
      ];

      const ephemeralItems: EphemeralTimelineItems = [
        {
          type: 'ephemeral_message',
          messageType: 'assistant',
          content: 'Streaming...',
          timestamp: new Date('2024-01-01T10:01:00Z'),
        },
      ];

      const timeline = processor.buildTimeline(processedEvents, ephemeralItems);

      expect(timeline.items).toHaveLength(3);
      // Should be in chronological order
      expect(timeline.items[0].timestamp).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(timeline.items[1].timestamp).toEqual(new Date('2024-01-01T10:01:00Z'));
      expect(timeline.items[2].timestamp).toEqual(new Date('2024-01-01T10:02:00Z'));

      expect(timeline.metadata).toEqual({
        eventCount: 2,
        messageCount: 2,
        lastActivity: new Date('2024-01-01T10:02:00Z'),
      });
    });

    it('calculates correct metadata', () => {
      const processedEvents: ProcessedThreadItems = [
        {
          type: 'user_message',
          content: 'Hello',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          id: 'user-1',
        },
        {
          type: 'thinking',
          content: 'Thinking...',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          id: 'thinking-1',
        },
        {
          type: 'agent_message',
          content: 'Response',
          timestamp: new Date('2024-01-01T10:02:00Z'),
          id: 'agent-1',
        },
      ];

      const timeline = processor.buildTimeline(processedEvents, []);

      expect(timeline.metadata).toEqual({
        eventCount: 3,
        messageCount: 2, // Only user_message and agent_message count
        lastActivity: new Date('2024-01-01T10:02:00Z'),
      });
    });
  });

  describe('processThread (convenience method)', () => {
    it('combines all processing steps', () => {
      const events: ThreadEvent[] = [
        {
          id: 'user-1',
          threadId: 'thread-1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Hello',
        },
      ];

      const ephemeralMessages: EphemeralMessage[] = [
        {
          type: 'assistant',
          content: 'Streaming...',
          timestamp: new Date('2024-01-01T10:01:00Z'),
        },
      ];

      const timeline = processor.processThread(events, ephemeralMessages);

      expect(timeline.items).toHaveLength(2);
      expect(timeline.items[0].type).toBe('user_message');
      expect(timeline.items[1].type).toBe('ephemeral_message');
      expect(timeline.metadata.eventCount).toBe(1);
      expect(timeline.metadata.messageCount).toBe(1);
    });
  });

  describe('performance characteristics', () => {
    it('should process large event arrays efficiently', () => {
      // Create a large number of events
      const events: ThreadEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        events.push({
          id: `event-${i}`,
          threadId: 'thread-1',
          type: 'USER_MESSAGE',
          timestamp: new Date(Date.now() + i * 1000),
          data: `Message ${i}`,
        });
      }

      const result1 = processor.processEvents(events);
      const result2 = processor.processEvents(events); // Should be cached

      expect(result1).toBe(result2); // Same reference due to caching
      expect(result1).toHaveLength(1000);
    });

    it('should cache results correctly', () => {
      const events: ThreadEvent[] = [
        {
          id: 'user-1',
          threadId: 'thread-1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Hello',
        },
      ];

      // First call should process
      const result1 = processor.processEvents(events);

      // Second call should return cached result
      const result2 = processor.processEvents(events);

      // Should be exact same reference (cached)
      expect(result1).toBe(result2);

      // Clear cache and verify new processing
      processor.clearCache();
      const result3 = processor.processEvents(events);

      // Should be different reference but same content
      expect(result1).not.toBe(result3);
      expect(result1).toEqual(result3);
    });
  });
});
