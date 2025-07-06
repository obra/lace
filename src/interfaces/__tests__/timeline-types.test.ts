// ABOUTME: Test for shared timeline types extraction
// ABOUTME: Ensures timeline types can be imported from shared location

import { describe, it, expect } from 'vitest';
import { Timeline, TimelineItem, TimelineProcessor } from '../timeline-types.js';

describe('Timeline Types', () => {
  it('should export Timeline interface', () => {
    // Test that Timeline interface exists and has correct structure
    const timeline: Timeline = {
      items: [],
      metadata: {
        eventCount: 0,
        messageCount: 0,
        lastActivity: new Date(),
      },
    };

    expect(timeline.items).toBeDefined();
    expect(timeline.metadata).toBeDefined();
    expect(timeline.metadata.eventCount).toBe(0);
    expect(timeline.metadata.messageCount).toBe(0);
    expect(timeline.metadata.lastActivity).toBeInstanceOf(Date);
  });

  it('should export TimelineItem type with all variants', () => {
    // Test user_message variant
    const userMessage: TimelineItem = {
      type: 'user_message',
      content: 'Hello',
      timestamp: new Date(),
      id: 'msg-1',
    };
    expect(userMessage.type).toBe('user_message');

    // Test agent_message variant
    const agentMessage: TimelineItem = {
      type: 'agent_message',
      content: 'Hi there',
      timestamp: new Date(),
      id: 'msg-2',
    };
    expect(agentMessage.type).toBe('agent_message');

    // Test tool_execution variant
    const toolExecution: TimelineItem = {
      type: 'tool_execution',
      call: {
        id: 'call-1',
        name: 'test-tool',
        arguments: {},
      },
      timestamp: new Date(),
      callId: 'call-1',
    };
    expect(toolExecution.type).toBe('tool_execution');

    // Test system_message variant
    const systemMessage: TimelineItem = {
      type: 'system_message',
      content: 'System message',
      timestamp: new Date(),
      id: 'sys-1',
    };
    expect(systemMessage.type).toBe('system_message');

    // Test ephemeral_message variant
    const ephemeralMessage: TimelineItem = {
      type: 'ephemeral_message',
      messageType: 'assistant',
      content: 'Thinking...',
      timestamp: new Date(),
    };
    expect(ephemeralMessage.type).toBe('ephemeral_message');
  });

  it('should export TimelineProcessor interface', () => {
    // Test that TimelineProcessor interface has required methods
    const processor: TimelineProcessor = {
      appendEvent: () => {},
      loadEvents: () => {},
      getTimeline: () => ({
        items: [],
        metadata: {
          eventCount: 0,
          messageCount: 0,
          lastActivity: new Date(),
        },
      }),
      reset: () => {},
    };

    expect(typeof processor.appendEvent).toBe('function');
    expect(typeof processor.loadEvents).toBe('function');
    expect(typeof processor.getTimeline).toBe('function');
    expect(typeof processor.reset).toBe('function');
  });
});
