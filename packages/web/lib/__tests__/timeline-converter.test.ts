// ABOUTME: Test suite for SessionEvent to TimelineEntry conversion
// ABOUTME: Comprehensive TDD tests for timeline converter functionality

import { describe, test, expect } from 'vitest';
import type { SessionEvent, Agent } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import { 
  convertSessionEventsToTimeline,
  type ConversionContext 
} from '@/lib/timeline-converter';

const mockAgents: Agent[] = [
  {
    threadId: asThreadId('session-123.agent-1'),
    name: 'Claude',
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    status: 'idle',
    createdAt: '2025-07-21T10:00:00Z',
  },
  {
    threadId: asThreadId('session-123.agent-2'),
    name: 'GPT-4',
    provider: 'openai',
    model: 'gpt-4',
    status: 'idle',
    createdAt: '2025-07-21T10:05:00Z',
  },
];

const mockSessionEvents: SessionEvent[] = [
  {
    type: 'USER_MESSAGE',
    threadId: asThreadId('session-123'),
    timestamp: new Date('2025-07-21T10:30:00Z'),
    data: { content: 'Hello, can you help me with TypeScript?' },
  },
  {
    type: 'AGENT_MESSAGE',
    threadId: asThreadId('session-123.agent-1'),
    timestamp: new Date('2025-07-21T10:30:30Z'),
    data: { content: 'Of course! I\'d be happy to help you with TypeScript.' },
  },
  {
    type: 'TOOL_CALL',
    threadId: asThreadId('session-123.agent-1'),
    timestamp: new Date('2025-07-21T10:31:00Z'),
    data: {
      toolName: 'file_read',
      input: { path: '/src/types.ts', limit: 100 },
    },
  },
  {
    type: 'TOOL_RESULT',
    threadId: asThreadId('session-123.agent-1'),
    timestamp: new Date('2025-07-21T10:31:15Z'),
    data: {
      toolName: 'file_read',
      result: { content: 'interface User { id: number; name: string; }' },
    },
  },
  {
    type: 'THINKING',
    threadId: asThreadId('session-123.agent-1'),
    timestamp: new Date('2025-07-21T10:31:30Z'),
    data: { status: 'start' },
  },
  {
    type: 'LOCAL_SYSTEM_MESSAGE',
    threadId: asThreadId('session-123'),
    timestamp: new Date('2025-07-21T10:32:00Z'),
    data: { content: 'Connected to session stream' },
  },
];

describe('convertSessionEventsToTimeline', () => {
  const defaultContext: ConversionContext = {
    agents: mockAgents,
    selectedAgent: undefined,
  };

  test('converts USER_MESSAGE to human timeline entry', () => {
    const events: SessionEvent[] = [mockSessionEvents[0]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123-\d+-0$/),
      type: 'human',
      content: 'Hello, can you help me with TypeScript?',
      timestamp: new Date('2025-07-21T10:30:00Z'),
    }));
  });

  test('converts AGENT_MESSAGE to ai timeline entry with agent name', () => {
    const events: SessionEvent[] = [mockSessionEvents[1]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'ai',
      content: 'Of course! I\'d be happy to help you with TypeScript.',
      timestamp: new Date('2025-07-21T10:30:30Z'),
      agent: 'Claude',
    }));
  });

  test('converts TOOL_CALL to tool timeline entry', () => {
    const events: SessionEvent[] = [mockSessionEvents[2]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'tool',
      content: 'Tool: file_read',
      tool: 'file_read',
      timestamp: new Date('2025-07-21T10:31:00Z'),
      agent: 'Claude',
    }));
  });

  test('converts TOOL_RESULT to tool timeline entry with result', () => {
    const events: SessionEvent[] = [mockSessionEvents[3]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'tool',
      content: expect.stringContaining('interface User'),
      result: expect.stringContaining('interface User'),
      timestamp: new Date('2025-07-21T10:31:15Z'),
      agent: 'Claude',
    }));
  });

  test('converts THINKING to ai timeline entry with thinking message', () => {
    const events: SessionEvent[] = [mockSessionEvents[4]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'ai',
      content: 'Claude is thinking...',
      timestamp: new Date('2025-07-21T10:31:30Z'),
      agent: 'Claude',
    }));
  });

  test('converts LOCAL_SYSTEM_MESSAGE to admin timeline entry', () => {
    const events: SessionEvent[] = [mockSessionEvents[5]];
    const result = convertSessionEventsToTimeline(events, defaultContext);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123-\d+-0$/),
      type: 'admin',
      content: 'Connected to session stream',
      timestamp: new Date('2025-07-21T10:32:00Z'),
    }));
  });

  test('filters events by selected agent', () => {
    const contextWithSelectedAgent: ConversionContext = {
      ...defaultContext,
      selectedAgent: asThreadId('session-123.agent-1'),
    };
    
    const result = convertSessionEventsToTimeline(mockSessionEvents, contextWithSelectedAgent);
    
    // Should include: user message + agent-1 messages, exclude agent-2 messages
    // Expecting: USER_MESSAGE, AGENT_MESSAGE, TOOL_CALL, TOOL_RESULT, THINKING, LOCAL_SYSTEM_MESSAGE
    expect(result).toHaveLength(6);
    
    // Verify agent filtering - no events from other agents
    const agentEventThreadIds = result
      .filter(entry => entry.type === 'ai' || entry.type === 'tool')
      .map(entry => entry.agent);
    
    expect(agentEventThreadIds.every(agent => agent === 'Claude')).toBe(true);
  });

  test('processes streaming tokens correctly', () => {
    const streamingEvents: SessionEvent[] = [
      {
        type: 'AGENT_TOKEN',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date('2025-07-21T10:35:00Z'),
        data: { token: 'Hello ' },
      },
      {
        type: 'AGENT_TOKEN',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date('2025-07-21T10:35:01Z'),
        data: { token: 'there!' },
      },
      {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date('2025-07-21T10:35:02Z'),
        data: { content: 'Hello there!' },
      },
    ];

    const result = convertSessionEventsToTimeline(streamingEvents, defaultContext);
    
    // Should merge streaming tokens and then replace with final message
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'ai',
      content: 'Hello there!',
      timestamp: new Date('2025-07-21T10:35:02Z'),
      agent: 'Claude',
    }));
  });

  test('handles streaming tokens without final message', () => {
    const incompleteStreamingEvents: SessionEvent[] = [
      {
        type: 'AGENT_TOKEN',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date('2025-07-21T10:36:00Z'),
        data: { token: 'Hello ' },
      },
      {
        type: 'AGENT_TOKEN',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date('2025-07-21T10:36:01Z'),
        data: { token: 'incomplete...' },
      },
    ];

    const result = convertSessionEventsToTimeline(incompleteStreamingEvents, defaultContext);
    
    // Should create AGENT_STREAMING entry from accumulated tokens
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123\.agent-1-\d+-0$/),
      type: 'ai',
      content: 'Hello incomplete...',
      timestamp: new Date('2025-07-21T10:36:01Z'),
      agent: 'Claude',
    }));
  });

  test('respects streaming token memory limit', () => {
    // Create events that exceed MAX_STREAMING_MESSAGES
    const manyTokenEvents: SessionEvent[] = [];
    for (let i = 0; i < 150; i++) {
      manyTokenEvents.push({
        type: 'AGENT_TOKEN',
        threadId: asThreadId('session-123.agent-1'),
        timestamp: new Date(`2025-07-21T10:40:${String(i).padStart(2, '0')}Z`),
        data: { token: `token${i} ` },
      });
    }

    const result = convertSessionEventsToTimeline(manyTokenEvents, defaultContext);
    
    // Should limit the number of streaming messages to prevent memory issues
    expect(result.length).toBeLessThanOrEqual(100); // MAX_STREAMING_MESSAGES
  });

  test('handles unknown agent threadId gracefully', () => {
    const unknownAgentEvent: SessionEvent[] = [
      {
        type: 'AGENT_MESSAGE',
        threadId: asThreadId('session-123.unknown-agent'),
        timestamp: new Date('2025-07-21T10:37:00Z'),
        data: { content: 'Message from unknown agent' },
      },
    ];

    const result = convertSessionEventsToTimeline(unknownAgentEvent, defaultContext);
    
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe('Agent unknown'); // Fallback agent name
  });

  test('handles empty events array', () => {
    const result = convertSessionEventsToTimeline([], defaultContext);
    expect(result).toEqual([]);
  });

  test('generates unique IDs for each timeline entry', () => {
    const result = convertSessionEventsToTimeline(mockSessionEvents, defaultContext);
    
    const ids = result.map(entry => entry.id);
    const uniqueIds = new Set(ids);
    
    expect(uniqueIds.size).toBe(result.length);
  });

  test('preserves chronological order', () => {
    const result = convertSessionEventsToTimeline(mockSessionEvents, defaultContext);
    
    // Verify timestamps are in ascending order
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp.getTime()).toBeGreaterThanOrEqual(
        result[i - 1].timestamp.getTime()
      );
    }
  });

  test('handles unknown event types gracefully', () => {
    const unknownEvent = {
      type: 'UNKNOWN_EVENT_TYPE',
      threadId: asThreadId('session-123'),
      timestamp: new Date('2025-07-21T10:38:00Z'),
      data: { someData: 'test' },
    } as unknown as SessionEvent; // Cast to SessionEvent to test fallback handling

    const result = convertSessionEventsToTimeline([unknownEvent], defaultContext);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^session-123-\d+-0$/),
      type: 'admin',
      content: 'Unknown event: UNKNOWN_EVENT_TYPE',
      timestamp: new Date('2025-07-21T10:38:00Z'),
    }));
  });
});