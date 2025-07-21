// ABOUTME: Test suite for LaceMessageDisplay component using design system
// ABOUTME: Covers all event types, streaming states, and visual requirements

import React from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SessionEvent, Agent, ThreadId } from '@/types/api';
import { LaceMessageDisplay } from '../LaceMessageDisplay';

// Mock design system components
vi.mock('@/components/ui/MessageBubble', () => ({
  default: ({ children, align, variant, ...props }: any) => (
    <div data-testid="message-bubble" data-align={align} data-variant={variant} {...props}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/MessageHeader', () => ({
  default: ({ timestamp, agent, ...props }: any) => (
    <div data-testid="message-header" data-timestamp={timestamp} data-agent={agent} {...props}>
      Header: {timestamp} - {agent}
    </div>
  ),
}));

vi.mock('@/components/ui/AgentBadge', () => ({
  default: ({ name, provider, model, ...props }: any) => (
    <div data-testid="agent-badge" data-name={name} data-provider={provider} data-model={model} {...props}>
      {name} ({provider}/{model})
    </div>
  ),
}));

vi.mock('@/components/ui/CodeBlock', () => ({
  default: ({ children, language, ...props }: any) => (
    <div data-testid="code-block" data-language={language} {...props}>
      <pre>{children}</pre>
    </div>
  ),
}));

vi.mock('@/components/ui/StreamingIndicator', () => ({
  default: ({ ...props }: any) => (
    <span data-testid="streaming-indicator" {...props}>
      ▌
    </span>
  ),
}));

const mockAgent: Agent = {
  threadId: 'session-123.agent-1' as ThreadId,
  name: 'Claude',
  provider: 'anthropic',
  model: 'claude-3-sonnet',
  status: 'active',
  createdAt: '2025-07-21T10:00:00Z',
};

describe('LaceMessageDisplay', () => {
  test('renders user message with timestamp and proper styling', () => {
    const event: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId: 'session-123' as ThreadId,
      timestamp: '2025-07-21T10:30:00Z',
      data: { content: 'Hello, can you help me with TypeScript?' },
    };

    render(<LaceMessageDisplay event={event} />);

    // Should use MessageBubble with user styling
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-align', 'right');
    expect(bubble).toHaveAttribute('data-variant', 'user');

    // Should display message content
    expect(screen.getByText('Hello, can you help me with TypeScript?')).toBeInTheDocument();

    // Should include timestamp in header
    const header = screen.getByTestId('message-header');
    expect(header).toHaveAttribute('data-timestamp', '2025-07-21T10:30:00Z');
  });

  test('renders agent message with agent badge and proper styling', () => {
    const event: SessionEvent = {
      type: 'AGENT_MESSAGE',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:31:00Z',
      data: { content: 'Of course! I\'d be happy to help you with TypeScript.' },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should use MessageBubble with agent styling
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toHaveAttribute('data-align', 'left');
    expect(bubble).toHaveAttribute('data-variant', 'agent');

    // Should display agent badge
    const badge = screen.getByTestId('agent-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('data-name', 'Claude');
    expect(badge).toHaveAttribute('data-provider', 'anthropic');
    expect(badge).toHaveAttribute('data-model', 'claude-3-sonnet');

    // Should display message content
    expect(screen.getByText('Of course! I\'d be happy to help you with TypeScript.')).toBeInTheDocument();
  });

  test('renders tool call with parameters in code block', () => {
    const event: SessionEvent = {
      type: 'TOOL_CALL',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:32:00Z',
      data: {
        toolName: 'file_read',
        input: { path: '/src/components/Button.tsx', limit: 100 },
      },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should display tool name
    expect(screen.getByText(/file_read/)).toBeInTheDocument();

    // Should display parameters in code block
    const codeBlock = screen.getByTestId('code-block');
    expect(codeBlock).toBeInTheDocument();
    expect(codeBlock).toHaveAttribute('data-language', 'json');

    // Should format parameters as JSON
    expect(screen.getByText(/"path": "\/src\/components\/Button.tsx"/)).toBeInTheDocument();
    expect(screen.getByText(/"limit": 100/)).toBeInTheDocument();
  });

  test('renders tool result with success state and formatted output', () => {
    const event: SessionEvent = {
      type: 'TOOL_RESULT',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:32:30Z',
      data: {
        toolName: 'file_read',
        result: {
          content: 'export const Button = ({ children }) => <button>{children}</button>;',
          metadata: { fileSize: 1024 },
        },
      },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should display tool name
    expect(screen.getByText(/file_read/)).toBeInTheDocument();

    // Should display success indicator (implementation will add visual success state)
    expect(screen.getByTestId('code-block')).toBeInTheDocument();

    // Should format result content
    expect(screen.getByText(/export const Button/)).toBeInTheDocument();
  });

  test('renders streaming message with indicator', () => {
    const event: SessionEvent = {
      type: 'AGENT_STREAMING',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:33:00Z',
      data: { content: 'I can help you with TypeScript. Let me start by...' },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} isStreaming={true} />);

    // Should use agent message styling
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toHaveAttribute('data-variant', 'agent');

    // Should display streaming indicator
    expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument();

    // Should display partial content
    expect(screen.getByText('I can help you with TypeScript. Let me start by...')).toBeInTheDocument();
  });

  test('renders thinking indicator with agent info', () => {
    const event: SessionEvent = {
      type: 'THINKING',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:32:15Z',
      data: { status: 'start' },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should display thinking indicator (implementation will add visual thinking state)
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();

    // Should include agent information (use more specific text match)
    expect(screen.getByText('Claude is thinking...')).toBeInTheDocument();
  });

  test('handles empty content gracefully', () => {
    const event: SessionEvent = {
      type: 'AGENT_MESSAGE',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:33:30Z',
      data: { content: '' },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should render without crashing
    expect(screen.getByTestId('message-bubble')).toBeInTheDocument();

    // Should handle empty content gracefully (implementation will add placeholder)
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toBeInTheDocument();
  });

  test('handles missing agent gracefully', () => {
    const event: SessionEvent = {
      type: 'AGENT_MESSAGE',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:34:00Z',
      data: { content: 'Message from unknown agent' },
    };

    render(<LaceMessageDisplay event={event} />);

    // Should render without crashing when no agent provided
    expect(screen.getByTestId('message-bubble')).toBeInTheDocument();
    expect(screen.getByText('Message from unknown agent')).toBeInTheDocument();
  });

  test('formats timestamp correctly', () => {
    const event: SessionEvent = {
      type: 'USER_MESSAGE',
      threadId: 'session-123' as ThreadId,
      timestamp: '2025-07-21T10:35:45.123Z',
      data: { content: 'Test message' },
    };

    render(<LaceMessageDisplay event={event} />);

    // Should pass timestamp to header component
    const header = screen.getByTestId('message-header');
    expect(header).toHaveAttribute('data-timestamp', '2025-07-21T10:35:45.123Z');
  });

  test('handles system messages with appropriate styling', () => {
    const event: SessionEvent = {
      type: 'LOCAL_SYSTEM_MESSAGE',
      threadId: 'session-123' as ThreadId,
      timestamp: '2025-07-21T10:36:00Z',
      data: { message: 'Connected to session stream' },
    };

    render(<LaceMessageDisplay event={event} />);

    // Should display system message content (wrapped with em dashes)
    expect(screen.getByText(/Connected to session stream/)).toBeInTheDocument();

    // Should use appropriate styling for system messages (implementation will add system variant)
    const bubble = screen.getByTestId('message-bubble');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-variant', 'system');
    expect(bubble).toHaveAttribute('data-align', 'center');
  });

  test('handles tool calls with no parameters', () => {
    const event: SessionEvent = {
      type: 'TOOL_CALL',
      threadId: 'session-123.agent-1' as ThreadId,
      timestamp: '2025-07-21T10:37:00Z',
      data: {
        toolName: 'get_current_time',
        input: null,
      },
    };

    render(<LaceMessageDisplay event={event} agent={mockAgent} />);

    // Should display tool name
    expect(screen.getByText(/get_current_time/)).toBeInTheDocument();

    // Should handle null input gracefully
    expect(screen.getByTestId('code-block')).toBeInTheDocument();
  });
});