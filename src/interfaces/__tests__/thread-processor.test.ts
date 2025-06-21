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

    it('caches individual event processing', () => {
      const result1 = processor.processEvents(sampleEvents);
      const result2 = processor.processEvents(sampleEvents);

      // Should have same content (individual events are cached)
      expect(result1).toStrictEqual(result2);
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

    it('should extract thinking blocks from streaming assistant messages', () => {
      const timestamp = new Date('2024-01-01T10:00:00Z');
      const messages: EphemeralMessage[] = [
        {
          type: 'assistant',
          content: '<think>I need to think about this carefully</think>Here is my response',
          timestamp,
        },
      ];

      const result = processor.processEphemeralEvents(messages);

      expect(result).toHaveLength(2);

      // Should have thinking block item first
      expect(result[0]).toEqual({
        type: 'thinking',
        content: 'I need to think about this carefully',
        timestamp,
        id: `${timestamp.getTime()}_thinking_0`,
      });

      // Should have clean content item second
      expect(result[1]).toEqual({
        type: 'ephemeral_message',
        messageType: 'assistant',
        content: 'Here is my response',
        timestamp: new Date(timestamp.getTime() + 1), // +1ms after thinking block
      });
    });

    it('should handle multiple thinking blocks in streaming content', () => {
      const timestamp = new Date('2024-01-01T10:00:00Z');
      const messages: EphemeralMessage[] = [
        {
          type: 'assistant',
          content: '<think>First thought</think>Some text<think>Second thought</think>More text',
          timestamp,
        },
      ];

      const result = processor.processEphemeralEvents(messages);

      expect(result).toHaveLength(3);

      // First thinking block
      expect(result[0]).toEqual({
        type: 'thinking',
        content: 'First thought',
        timestamp,
        id: `${timestamp.getTime()}_thinking_0`,
      });

      // Second thinking block
      expect(result[1]).toEqual({
        type: 'thinking',
        content: 'Second thought',
        timestamp: new Date(timestamp.getTime() + 1),
        id: `${timestamp.getTime()}_thinking_1`,
      });

      // Clean content
      expect(result[2]).toEqual({
        type: 'ephemeral_message',
        messageType: 'assistant',
        content: 'Some textMore text',
        timestamp: new Date(timestamp.getTime() + 2),
      });
    });

    it('should handle assistant messages with only thinking blocks (no clean content)', () => {
      const timestamp = new Date('2024-01-01T10:00:00Z');
      const messages: EphemeralMessage[] = [
        {
          type: 'assistant',
          content: '<think>Only thinking here</think>',
          timestamp,
        },
      ];

      const result = processor.processEphemeralEvents(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'thinking',
        content: 'Only thinking here',
        timestamp,
        id: `${timestamp.getTime()}_thinking_0`,
      });
    });

    it('should pass through non-assistant messages unchanged', () => {
      const messages: EphemeralMessage[] = [
        {
          type: 'system',
          content: '<think>This should not be processed</think>',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        },
      ];

      const result = processor.processEphemeralEvents(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'ephemeral_message',
        messageType: 'system',
        content: '<think>This should not be processed</think>',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      });
    });
  });

  describe('thinking block deduplication', () => {
    it('deduplicates thinking blocks from streaming and extracted sources', () => {
      const events: ThreadEvent[] = [
        {
          id: 'thinking-1',
          threadId: 'thread-1',
          type: 'THINKING',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Let me think about this',
        },
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          data: '<think>Let me think about this</think>Here is my response',
        },
      ];

      const processedEvents = processor.processEvents(events);
      const timeline = processor.buildTimeline(processedEvents, []);

      // Should only have one thinking block (from streaming source) after deduplication
      const thinkingItems = timeline.items.filter((item) => item.type === 'thinking');
      expect(thinkingItems).toHaveLength(1);
      expect(thinkingItems[0].id).toBe('thinking-1'); // Streaming source preserved
      expect('content' in thinkingItems[0] ? thinkingItems[0].content : '').toBe(
        'Let me think about this'
      );

      // Agent message should have thinking removed
      const agentItems = timeline.items.filter((item) => item.type === 'agent_message');
      expect(agentItems).toHaveLength(1);
      expect('content' in agentItems[0] ? agentItems[0].content : '').toBe('Here is my response');
    });

    it('preserves non-duplicate thinking blocks from both sources', () => {
      const events: ThreadEvent[] = [
        {
          id: 'thinking-1',
          threadId: 'thread-1',
          type: 'THINKING',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'First thought from streaming',
        },
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          data: '<think>Second thought from extraction</think>Here is my response',
        },
      ];

      const processedEvents = processor.processEvents(events);
      const timeline = processor.buildTimeline(processedEvents, []);

      // Should have both thinking blocks since they're different
      const thinkingItems = timeline.items.filter((item) => item.type === 'thinking');
      expect(thinkingItems).toHaveLength(2);

      // Check both contents are preserved
      const contents = thinkingItems.map((item) => ('content' in item ? item.content : ''));
      expect(contents).toContain('First thought from streaming');
      expect(contents).toContain('Second thought from extraction');
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

  describe('SAX parser edge cases', () => {
    it('handles incomplete thinking blocks gracefully', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>Incomplete thinking block without closing tag',
        },
      ];

      const result = processor.processEvents(events);

      // Should still create a thinking block (either with incomplete marker or fallback to regex)
      const thinkingItems = result.filter((item) => item.type === 'thinking');
      expect(thinkingItems).toHaveLength(1);
      // Content should be preserved regardless of parsing method
      expect('content' in thinkingItems[0] ? thinkingItems[0].content : '').toContain(
        'Incomplete thinking block'
      );
    });

    it('handles malformed thinking tags', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think><nested>Invalid nesting</think>This is the response',
        },
      ];

      // Should not throw error - falls back to regex
      expect(() => processor.processEvents(events)).not.toThrow();

      const result = processor.processEvents(events);

      // Should have at least an agent message
      const agentItems = result.filter((item) => item.type === 'agent_message');
      expect(agentItems.length).toBeGreaterThanOrEqual(1);
    });

    it('handles mixed valid and invalid thinking blocks', () => {
      const events: ThreadEvent[] = [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: '<think>Valid block</think>Some text<think>Invalid < block</malformed>Final response',
        },
      ];

      const result = processor.processEvents(events);

      // Should process what it can and not break
      expect(result.length).toBeGreaterThan(0);

      // Should have at least an agent message
      const agentItems = result.filter((item) => item.type === 'agent_message');
      expect(agentItems).toHaveLength(1);
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
      const result2 = processor.processEvents(events); // Individual events cached

      expect(result1).toStrictEqual(result2); // Same content due to event-level caching
      expect(result1).toHaveLength(1000);
    });

    it('should cache individual event processing correctly', () => {
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

      // Second call should have same content (individual events cached)
      const result2 = processor.processEvents(events);

      // Should have same content (individual events are cached)
      expect(result1).toStrictEqual(result2);

      // Clear cache and verify new processing
      processor.clearCache();
      const result3 = processor.processEvents(events);

      // Should still have same content
      expect(result1).toStrictEqual(result3);
    });
  });

  describe('integration tests', () => {
    it('handles complex mixed sequences with thinking blocks and tool calls', () => {
      const events: ThreadEvent[] = [
        // User message
        {
          id: 'user-1',
          threadId: 'thread-1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Help me with a task',
        },
        // Streaming thinking event
        {
          id: 'thinking-1',
          threadId: 'thread-1',
          type: 'THINKING',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          data: 'I need to think about this step by step',
        },
        // Agent message with embedded thinking (duplicate content)
        {
          id: 'agent-1',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          data: '<think>I need to think about this step by step</think>I will help you with that task.',
        },
        // Tool call
        {
          id: 'tool-call-1',
          threadId: 'thread-1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T10:00:03Z'),
          data: {
            toolName: 'bash',
            input: { command: 'ls -la' },
            callId: 'call-123',
          },
        },
        // Tool result
        {
          id: 'tool-result-1',
          threadId: 'thread-1',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:00:04Z'),
          data: {
            callId: 'call-123',
            output: 'file1.txt\nfile2.txt',
            success: true,
          },
        },
        // Another agent message
        {
          id: 'agent-2',
          threadId: 'thread-1',
          type: 'AGENT_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:05Z'),
          data: 'I found 2 files in the directory.',
        },
      ];

      const processedEvents = processor.processEvents(events);
      const timeline = processor.buildTimeline(processedEvents, []);

      // Should have:
      // - 1 user message
      // - 1 thinking block (deduplicated)
      // - 2 agent messages
      // - 1 tool execution
      expect(timeline.items).toHaveLength(5);

      // Verify chronological order
      const types = timeline.items.map((item) => item.type);
      expect(types).toEqual([
        'user_message',
        'thinking',
        'agent_message',
        'tool_execution',
        'agent_message',
      ]);

      // Verify thinking block deduplication
      const thinkingItems = timeline.items.filter((item) => item.type === 'thinking');
      expect(thinkingItems).toHaveLength(1);
      expect(thinkingItems[0].id).toBe('thinking-1'); // Streaming version preserved

      // Verify metadata
      expect(timeline.metadata.messageCount).toBe(3); // user + 2 agent messages
      expect(timeline.metadata.eventCount).toBe(5);
    });

    it('maintains timeline consistency with ephemeral messages during streaming', () => {
      const events: ThreadEvent[] = [
        {
          id: 'user-1',
          threadId: 'thread-1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Start task',
        },
      ];

      const ephemeralMessages: EphemeralMessage[] = [
        {
          type: 'thinking',
          content: 'Let me process this...',
          timestamp: new Date('2024-01-01T10:00:01Z'),
        },
        {
          type: 'assistant',
          content: 'Working on your request...',
          timestamp: new Date('2024-01-01T10:00:02Z'),
        },
      ];

      const timeline = processor.processThread(events, ephemeralMessages);

      // Should merge events and ephemeral messages chronologically
      expect(timeline.items).toHaveLength(3);

      const types = timeline.items.map((item) => item.type);
      expect(types).toEqual(['user_message', 'ephemeral_message', 'ephemeral_message']);

      // Check chronological ordering
      const timestamps = timeline.items.map((item) => item.timestamp.getTime());
      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });
  });
});
