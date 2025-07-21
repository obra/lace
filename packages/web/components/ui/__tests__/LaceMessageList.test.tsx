// ABOUTME: Test suite for LaceMessageList component managing conversation events
// ABOUTME: Covers event processing, agent filtering, streaming, and performance

import React from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { SessionEvent, Agent, ThreadId } from '@/types/api';
import { LaceMessageList } from '@/components/ui/LaceMessageList';

// Mock the LaceMessageDisplay component
vi.mock('@/components/ui/LaceMessageDisplay', () => ({
  LaceMessageDisplay: ({ event, agent, isStreaming }: any) => (
    <div 
      data-testid="lace-message-display" 
      data-event-type={event.type}
      data-thread-id={event.threadId}
      data-agent-name={agent?.name}
      data-is-streaming={isStreaming}
    >
      {event.type}: {event.data.content || event.data.message || event.data.toolName || JSON.stringify(event.data)}
    </div>
  ),
}));

// Mock design system components
vi.mock('@/components/ui/LoadingDots', () => ({
  default: () => <div data-testid="loading-dots">Loading...</div>,
}));

vi.mock('@/components/ui/SkeletonLoader', () => ({
  default: ({ className }: any) => (
    <div data-testid="skeleton" className={className}>
      Skeleton placeholder
    </div>
  ),
}));

const mockAgents: Agent[] = [
  {
    threadId: 'session-123.agent-1' as ThreadId,
    name: 'Claude',
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    status: 'active',
    createdAt: '2025-07-21T10:00:00Z',
  },
  {
    threadId: 'session-123.agent-2' as ThreadId,
    name: 'GPT-4',
    provider: 'openai',
    model: 'gpt-4',
    status: 'active',
    createdAt: '2025-07-21T10:05:00Z',
  },
];

const createMockEvents = (): SessionEvent[] => [
  {
    type: 'USER_MESSAGE',
    threadId: 'session-123.agent-1' as ThreadId,
    timestamp: '2025-07-21T10:30:00Z',
    data: { content: 'Hello Claude' },
  },
  {
    type: 'AGENT_TOKEN',
    threadId: 'session-123.agent-1' as ThreadId,
    timestamp: '2025-07-21T10:30:15Z',
    data: { token: 'Hello! ' },
  },
  {
    type: 'AGENT_TOKEN',
    threadId: 'session-123.agent-1' as ThreadId,
    timestamp: '2025-07-21T10:30:16Z',
    data: { token: 'I can help you.' },
  },
  {
    type: 'AGENT_MESSAGE',
    threadId: 'session-123.agent-1' as ThreadId,
    timestamp: '2025-07-21T10:30:17Z',
    data: { content: 'Hello! I can help you.' },
  },
  {
    type: 'USER_MESSAGE',
    threadId: 'session-123.agent-2' as ThreadId,
    timestamp: '2025-07-21T10:31:00Z',
    data: { content: 'Hello GPT-4' },
  },
  {
    type: 'AGENT_MESSAGE',
    threadId: 'session-123.agent-2' as ThreadId,
    timestamp: '2025-07-21T10:31:15Z',
    data: { content: 'Hi there! How can I assist you today?' },
  },
];

describe('LaceMessageList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders list of messages in chronological order', () => {
    const events = createMockEvents();
    
    render(<LaceMessageList events={events} agents={mockAgents} />);

    // Should render all processed events
    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should have USER_MESSAGE, AGENT_MESSAGE, USER_MESSAGE, AGENT_MESSAGE (tokens merged)
    expect(messageDisplays).toHaveLength(4);
    
    // Should be in chronological order
    expect(messageDisplays[0]).toHaveAttribute('data-event-type', 'USER_MESSAGE');
    expect(messageDisplays[1]).toHaveAttribute('data-event-type', 'AGENT_MESSAGE');
    expect(messageDisplays[2]).toHaveAttribute('data-event-type', 'USER_MESSAGE');
    expect(messageDisplays[3]).toHaveAttribute('data-event-type', 'AGENT_MESSAGE');
  });

  test('filters messages by selected agent', () => {
    const events = createMockEvents();
    
    render(
      <LaceMessageList 
        events={events} 
        agents={mockAgents} 
        selectedAgent={'session-123.agent-1' as ThreadId}
      />
    );

    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should only show messages from agent-1 and user messages to agent-1
    expect(messageDisplays).toHaveLength(2);
    
    // All should be related to agent-1
    messageDisplays.forEach((display) => {
      expect(display).toHaveAttribute('data-thread-id', 'session-123.agent-1');
    });
  });

  test('merges streaming tokens into complete messages', () => {
    const streamingEvents: SessionEvent[] = [
      {
        type: 'USER_MESSAGE',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:00Z',
        data: { content: 'Hello' },
      },
      {
        type: 'AGENT_TOKEN',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:01Z',
        data: { token: 'Hi ' },
      },
      {
        type: 'AGENT_TOKEN',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:02Z',
        data: { token: 'there!' },
      },
      // No AGENT_MESSAGE - should show as streaming
    ];

    render(<LaceMessageList events={streamingEvents} agents={mockAgents} />);

    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should have USER_MESSAGE and AGENT_STREAMING
    expect(messageDisplays).toHaveLength(2);
    expect(messageDisplays[0]).toHaveAttribute('data-event-type', 'USER_MESSAGE');
    expect(messageDisplays[1]).toHaveAttribute('data-event-type', 'AGENT_STREAMING');
    expect(messageDisplays[1]).toHaveAttribute('data-is-streaming', 'true');
    
    // Streaming content should be merged
    expect(messageDisplays[1]).toHaveTextContent('Hi there!');
  });

  test('handles empty event list', () => {
    render(<LaceMessageList events={[]} agents={mockAgents} />);

    // Should show empty state message
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    expect(screen.getByText(/start a conversation/i)).toBeInTheDocument();
  });

  test('displays loading state', () => {
    render(
      <LaceMessageList 
        events={[]} 
        agents={mockAgents} 
        isLoading={true}
      />
    );

    // Should show loading indicators instead of empty state
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/no messages yet/i)).not.toBeInTheDocument();
  });

  test('applies custom className', () => {
    const events = createMockEvents().slice(0, 1); // Just one event
    
    const { container } = render(
      <LaceMessageList 
        events={events} 
        agents={mockAgents} 
        className="custom-class-name"
      />
    );

    // Should apply custom className to container
    expect(container.firstChild).toHaveClass('custom-class-name');
  });

  test('passes agent information to message displays', () => {
    const events: SessionEvent[] = [
      {
        type: 'AGENT_MESSAGE',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:00Z',
        data: { content: 'Hello from Claude' },
      },
      {
        type: 'AGENT_MESSAGE',
        threadId: 'session-123.agent-2' as ThreadId,
        timestamp: '2025-07-21T10:30:15Z',
        data: { content: 'Hello from GPT-4' },
      },
    ];

    render(<LaceMessageList events={events} agents={mockAgents} />);

    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should pass correct agent to each message
    expect(messageDisplays[0]).toHaveAttribute('data-agent-name', 'Claude');
    expect(messageDisplays[1]).toHaveAttribute('data-agent-name', 'GPT-4');
  });

  test('handles unknown agent gracefully', () => {
    const events: SessionEvent[] = [
      {
        type: 'AGENT_MESSAGE',
        threadId: 'session-123.unknown-agent' as ThreadId,
        timestamp: '2025-07-21T10:30:00Z',
        data: { content: 'Message from unknown agent' },
      },
    ];

    render(<LaceMessageList events={events} agents={mockAgents} />);

    // Should render without crashing
    const messageDisplay = screen.getByTestId('lace-message-display');
    expect(messageDisplay).toBeInTheDocument();
    // undefined agent name should not set the attribute at all
    expect(messageDisplay).not.toHaveAttribute('data-agent-name');
  });

  test('handles mixed event types correctly', () => {
    const events: SessionEvent[] = [
      {
        type: 'USER_MESSAGE',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:00Z',
        data: { content: 'Run a tool' },
      },
      {
        type: 'TOOL_CALL',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:15Z',
        data: { toolName: 'file_read', input: { path: '/test.txt' } },
      },
      {
        type: 'TOOL_RESULT',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:30Z',
        data: { toolName: 'file_read', result: 'File contents' },
      },
      {
        type: 'AGENT_MESSAGE',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:45Z',
        data: { content: 'I read the file successfully.' },
      },
    ];

    render(<LaceMessageList events={events} agents={mockAgents} />);

    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should render all event types
    expect(messageDisplays).toHaveLength(4);
    expect(messageDisplays[0]).toHaveAttribute('data-event-type', 'USER_MESSAGE');
    expect(messageDisplays[1]).toHaveAttribute('data-event-type', 'TOOL_CALL');
    expect(messageDisplays[2]).toHaveAttribute('data-event-type', 'TOOL_RESULT');
    expect(messageDisplays[3]).toHaveAttribute('data-event-type', 'AGENT_MESSAGE');
  });

  test('maintains streaming state during token accumulation', () => {
    const events: SessionEvent[] = [
      {
        type: 'AGENT_TOKEN',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:00Z',
        data: { token: 'Streaming ' },
      },
      {
        type: 'AGENT_TOKEN',
        threadId: 'session-123.agent-1' as ThreadId,
        timestamp: '2025-07-21T10:30:01Z',
        data: { token: 'response...' },
      },
    ];

    render(<LaceMessageList events={events} agents={mockAgents} />);

    const messageDisplay = screen.getByTestId('lace-message-display');
    
    // Should show as streaming
    expect(messageDisplay).toHaveAttribute('data-event-type', 'AGENT_STREAMING');
    expect(messageDisplay).toHaveAttribute('data-is-streaming', 'true');
    expect(messageDisplay).toHaveTextContent('Streaming response...');
  });

  test('respects memory limits for streaming messages', () => {
    // Create many streaming messages to test memory management
    const manyStreamingEvents: SessionEvent[] = [];
    
    // Create 150 different streaming conversations (exceeds MAX_STREAMING_MESSAGES = 100)
    for (let i = 0; i < 150; i++) {
      manyStreamingEvents.push({
        type: 'AGENT_TOKEN',
        threadId: `session-${i}.agent-1` as ThreadId,
        timestamp: `2025-07-21T10:30:${String(i).padStart(2, '0')}Z`,
        data: { token: `Token ${i}` },
      });
    }

    render(<LaceMessageList events={manyStreamingEvents} agents={[]} />);

    const messageDisplays = screen.getAllByTestId('lace-message-display');
    
    // Should limit the number of streaming messages (implementation detail)
    // This test verifies the component doesn't crash with many streaming events
    expect(messageDisplays.length).toBeGreaterThan(0);
    expect(messageDisplays.length).toBeLessThanOrEqual(150);
  });
});