// ABOUTME: Tests for StreamingTimelineProcessor ensuring feature parity with ThreadProcessor
// ABOUTME: Verifies O(1) incremental processing and all event type handling

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadEvent } from '../../threads/types.js';
import { ToolCall, ToolResult } from '../../tools/types.js';
import { StreamingTimelineProcessor } from '../streaming-timeline-processor.js';
import { ThreadProcessor } from '../thread-processor.js';
import { Timeline, TimelineItem } from '../timeline-types.js';

describe('StreamingTimelineProcessor', () => {
  let streamingProcessor: StreamingTimelineProcessor;
  let threadProcessor: ThreadProcessor;

  beforeEach(() => {
    streamingProcessor = new StreamingTimelineProcessor();
    threadProcessor = new ThreadProcessor();
  });

  describe('Feature Parity with ThreadProcessor', () => {
    it('should produce identical output for same event sequence', () => {
      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          data: 'Hello',
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2', 
          type: 'AGENT_MESSAGE',
          data: 'Hi there!',
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
      ];

      // Process with ThreadProcessor
      const threadProcessorResult = threadProcessor.processThreads(events);
      
      // Process with StreamingTimelineProcessor
      streamingProcessor.loadEvents(events);
      const streamingResult = streamingProcessor.getTimeline();

      // Compare results
      expect(streamingResult.items).toHaveLength(threadProcessorResult.items.length);
      expect(streamingResult.metadata.eventCount).toBe(threadProcessorResult.metadata.eventCount);
      expect(streamingResult.metadata.messageCount).toBe(threadProcessorResult.metadata.messageCount);
      
      // Compare each timeline item
      for (let i = 0; i < streamingResult.items.length; i++) {
        const streamingItem = streamingResult.items[i];
        const threadItem = threadProcessorResult.items[i];
        
        expect(streamingItem.type).toBe(threadItem.type);
        expect(streamingItem.timestamp).toEqual(threadItem.timestamp);
        
        if ('content' in streamingItem && 'content' in threadItem) {
          expect(streamingItem.content).toBe(threadItem.content);
        }
        if ('id' in streamingItem && 'id' in threadItem) {
          expect(streamingItem.id).toBe(threadItem.id);
        }
      }
    });

    it('should handle all event types correctly', () => {
      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          data: 'Hello',
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE', 
          data: 'Hi there!',
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
        {
          id: '3',
          type: 'LOCAL_SYSTEM_MESSAGE',
          data: 'System message',
          timestamp: new Date('2023-01-01T10:00:02Z'),
          threadId: 'thread-1',
        },
        {
          id: '4',
          type: 'SYSTEM_PROMPT',
          data: 'System prompt',
          timestamp: new Date('2023-01-01T10:00:03Z'),
          threadId: 'thread-1',
        },
        {
          id: '5',
          type: 'USER_SYSTEM_PROMPT',
          data: 'User system prompt',
          timestamp: new Date('2023-01-01T10:00:04Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.items).toHaveLength(5);
      expect(timeline.items[0].type).toBe('user_message');
      expect(timeline.items[1].type).toBe('agent_message');
      expect(timeline.items[2].type).toBe('system_message');
      expect(timeline.items[3].type).toBe('system_message');
      expect(timeline.items[4].type).toBe('system_message');
    });

    it('should handle tool call/result correlation correctly', () => {
      const toolCall: ToolCall = {
        id: 'call-123',
        name: 'test-tool',
        arguments: { param: 'value' },
      };

      const toolResult: ToolResult = {
        id: 'call-123',
        content: [{ type: 'text', text: 'Tool result' }],
        isError: false,
      };

      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'TOOL_CALL',
          data: toolCall,
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2',
          type: 'TOOL_RESULT',
          data: toolResult,
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.items).toHaveLength(1);
      
      const toolItem = timeline.items[0];
      expect(toolItem.type).toBe('tool_execution');
      
      if (toolItem.type === 'tool_execution') {
        expect(toolItem.call).toEqual(toolCall);
        expect(toolItem.result).toEqual(toolResult);
        expect(toolItem.callId).toBe('call-123');
      }
    });

    it('should handle orphaned tool results gracefully', () => {
      const toolResult: ToolResult = {
        id: 'orphaned-call',
        content: [{ type: 'text', text: 'Orphaned result' }],
        isError: false,
      };

      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'TOOL_RESULT',
          data: toolResult,
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.items).toHaveLength(1);
      
      const item = timeline.items[0];
      expect(item.type).toBe('system_message');
      
      if (item.type === 'system_message') {
        expect(item.content).toContain('Tool result (orphaned)');
        expect(item.content).toContain('Orphaned result');
      }
    });

    it('should handle pending tool calls without results', () => {
      const toolCall: ToolCall = {
        id: 'pending-call',
        name: 'test-tool',
        arguments: { param: 'value' },
      };

      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'TOOL_CALL',
          data: toolCall,
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.items).toHaveLength(1);
      
      const toolItem = timeline.items[0];
      expect(toolItem.type).toBe('tool_execution');
      
      if (toolItem.type === 'tool_execution') {
        expect(toolItem.call).toEqual(toolCall);
        expect(toolItem.result).toBeUndefined();
        expect(toolItem.callId).toBe('pending-call');
      }
    });
  });

  describe('Incremental Processing (O(1) behavior)', () => {
    it('should support appendEvent for incremental updates', () => {
      const event1: ThreadEvent = {
        id: '1',
        type: 'USER_MESSAGE',
        data: 'Hello',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        threadId: 'thread-1',
      };

      const event2: ThreadEvent = {
        id: '2',
        type: 'AGENT_MESSAGE',
        data: 'Hi there!',
        timestamp: new Date('2023-01-01T10:00:01Z'),
        threadId: 'thread-1',
      };

      // Add events incrementally
      streamingProcessor.appendEvent(event1);
      let timeline = streamingProcessor.getTimeline();
      expect(timeline.items).toHaveLength(1);
      expect(timeline.items[0].type).toBe('user_message');

      streamingProcessor.appendEvent(event2);
      timeline = streamingProcessor.getTimeline();
      expect(timeline.items).toHaveLength(2);
      expect(timeline.items[1].type).toBe('agent_message');
    });

    it('should maintain timeline order when appending events', () => {
      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          data: 'First',
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE',
          data: 'Second',
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
        {
          id: '3',
          type: 'USER_MESSAGE',
          data: 'Third',
          timestamp: new Date('2023-01-01T10:00:02Z'),
          threadId: 'thread-1',
        },
      ];

      // Add events one by one
      for (const event of events) {
        streamingProcessor.appendEvent(event);
      }

      const timeline = streamingProcessor.getTimeline();
      expect(timeline.items).toHaveLength(3);
      
      if (timeline.items[0].type === 'user_message') {
        expect(timeline.items[0].content).toBe('First');
      }
      if (timeline.items[1].type === 'agent_message') {
        expect(timeline.items[1].content).toBe('Second');
      }
      if (timeline.items[2].type === 'user_message') {
        expect(timeline.items[2].content).toBe('Third');
      }
    });
  });

  describe('State Management', () => {
    it('should support reset functionality', () => {
      const event: ThreadEvent = {
        id: '1',
        type: 'USER_MESSAGE',
        data: 'Hello',
        timestamp: new Date(),
        threadId: 'thread-1',
      };

      streamingProcessor.appendEvent(event);
      expect(streamingProcessor.getTimeline().items).toHaveLength(1);

      streamingProcessor.reset();
      expect(streamingProcessor.getTimeline().items).toHaveLength(0);
      expect(streamingProcessor.getTimeline().metadata.eventCount).toBe(0);
    });

    it('should support bulk loading with loadEvents', () => {
      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          data: 'Hello',
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE',
          data: 'Hi there!',
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.items).toHaveLength(2);
      expect(timeline.metadata.eventCount).toBe(2);
      expect(timeline.metadata.messageCount).toBe(2);
    });
  });

  describe('Timeline Metadata', () => {
    it('should calculate metadata correctly', () => {
      const events: ThreadEvent[] = [
        {
          id: '1',
          type: 'USER_MESSAGE',
          data: 'Hello',
          timestamp: new Date('2023-01-01T10:00:00Z'),
          threadId: 'thread-1',
        },
        {
          id: '2',
          type: 'AGENT_MESSAGE',
          data: 'Hi there!',
          timestamp: new Date('2023-01-01T10:00:01Z'),
          threadId: 'thread-1',
        },
        {
          id: '3',
          type: 'LOCAL_SYSTEM_MESSAGE',
          data: 'System message',
          timestamp: new Date('2023-01-01T10:00:02Z'),
          threadId: 'thread-1',
        },
      ];

      streamingProcessor.loadEvents(events);
      const timeline = streamingProcessor.getTimeline();

      expect(timeline.metadata.eventCount).toBe(3);
      expect(timeline.metadata.messageCount).toBe(2); // Only user and agent messages
      expect(timeline.metadata.lastActivity).toEqual(new Date('2023-01-01T10:00:02Z'));
    });
  });
});