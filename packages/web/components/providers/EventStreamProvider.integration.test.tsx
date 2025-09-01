// ABOUTME: Integration tests for EventStreamProvider with real component usage
// ABOUTME: Tests actual integration behavior and event flow coordination

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStreamConnection,
  useSessionEvents,
  useAgentAPI,
} from './EventStreamProvider';
import { ToolApprovalProvider } from './ToolApprovalProvider';
import { AgentProvider } from './AgentProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { createMockResponse } from '@/test-utils/mock-fetch';
import type { ThreadId } from '@/types/core';
import type { LaceEvent } from '~/threads/types';

// Mock all the hooks that EventStreamProvider depends on
vi.mock('@/hooks/useAgentEvents');
vi.mock('@/hooks/useEventStream');
vi.mock('@/hooks/useSessionAPI');
vi.mock('@/hooks/useAgentAPI');
vi.mock('@/hooks/useAgentManagement');

// Mock global fetch for ToolApprovalProvider
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(createMockResponse([])) as unknown as typeof fetch;
});

import { useAgentEvents as useAgentEventsHook } from '@/hooks/useAgentEvents';
import { useEventStream as useEventStreamHook } from '@/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@/hooks/useSessionAPI';
import { useAgentAPI as useAgentAPIHook } from '@/hooks/useAgentAPI';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import type { PendingApproval } from '@/types/api';
import type { StreamConnection } from '@/types/stream-events';

// Test component that consumes event stream state without receiving it through props
function TestEventStreamConsumer() {
  const { connection } = useEventStreamConnection();
  const { events, loadingHistory } = useSessionEvents();
  const { sendMessage, stopAgent } = useAgentAPI();

  return (
    <div>
      <div data-testid="is-connected">{connection.connected.toString()}</div>
      <div data-testid="connection-id">{connection.lastEventId || 'none'}</div>
      <div data-testid="events-count">{events.length}</div>
      <div data-testid="loading-history">{loadingHistory.toString()}</div>
      <button
        data-testid="send-message-button"
        onClick={() => sendMessage('lace_20250101_abc123' as ThreadId, 'Hello')}
      >
        Send Message
      </button>
      <button
        data-testid="stop-agent-button"
        onClick={() => stopAgent('lace_20250101_abc123' as ThreadId)}
      >
        Stop Agent
      </button>
    </div>
  );
}

// Test component that should fail without provider
function TestComponentWithoutProvider() {
  const { connection } = useEventStreamConnection();
  return <div data-testid="connected">{connection.connected}</div>;
}

describe('EventStreamProvider Integration', () => {
  const mockSendMessage = vi.fn();
  const mockStopAgent = vi.fn();
  const mockAddAgentEvent = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock implementations
    vi.mocked(useAgentEventsHook).mockReturnValue({
      events: [],
      loadingHistory: false,
      connected: false,
      addAgentEvent: mockAddAgentEvent,
    });

    vi.mocked(useEventStreamHook).mockReturnValue({
      connection: {
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      } as StreamConnection,
      lastEvent: undefined,
      sendCount: 0,
      close: vi.fn(),
      reconnect: vi.fn(),
    });

    vi.mocked(useSessionAPIHook).mockReturnValue({
      error: null,
      createSession: vi.fn(),
      getSession: vi.fn(),
      spawnAgent: vi.fn(),
      listAgents: vi.fn(),
    });

    vi.mocked(useAgentAPIHook).mockReturnValue({
      error: null,
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
    });

    vi.mocked(useAgentManagement).mockReturnValue({
      sessionDetails: null,
      loading: false,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
      loadAgentConfiguration: vi.fn(),
      updateAgent: vi.fn(),
    });
  });

  it('provides event stream state to deeply nested components without prop drilling', async () => {
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        threadId: 'lace_20250101_abc123' as ThreadId,
        data: 'Hello',
      },
      {
        id: 'event-2',
        type: 'AGENT_MESSAGE',
        timestamp: new Date(),
        threadId: 'lace_20250101_abc123' as ThreadId,
        data: { content: 'Hi there!' },
      },
    ];

    const mockApprovals: PendingApproval[] = [
      {
        toolCallId: 'approval-1',
        toolCall: {
          name: 'test_tool',
          arguments: {},
        },
        requestedAt: new Date(),
        requestData: {
          requestId: 'approval-1',
          toolName: 'test_tool',
          isReadOnly: false,
          riskLevel: 'safe',
          input: {},
        },
      },
    ];

    // Setup test data
    vi.mocked(useEventStreamHook).mockReturnValue({
      connection: {
        connected: true,
        lastEventId: 'conn-123',
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      } as StreamConnection,
      lastEvent: undefined,
      sendCount: 0,
      close: vi.fn(),
      reconnect: vi.fn(),
    });

    vi.mocked(useAgentEventsHook).mockReturnValue({
      events: mockEvents,
      loadingHistory: true,
      connected: true,
      addAgentEvent: mockAddAgentEvent,
    });

    await act(async () => {
      render(
        <ThemeProvider>
          <AgentProvider sessionId="test-session" selectedAgentId="lace_20250101_abc123">
            <ToolApprovalProvider agentId={'lace_20250101_abc123' as ThreadId}>
              <EventStreamProvider
                projectId="test-project"
                sessionId={'lace_20250101_def456' as ThreadId}
                agentId={'lace_20250101_abc123' as ThreadId}
              >
                <div>
                  <div>
                    <div>
                      <TestEventStreamConsumer />
                    </div>
                  </div>
                </div>
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
    });

    // Verify state is accessible without prop drilling
    expect(screen.getByTestId('is-connected')).toHaveTextContent('true');
    expect(screen.getByTestId('connection-id')).toHaveTextContent('conn-123');
    expect(screen.getByTestId('events-count')).toHaveTextContent('2');
    expect(screen.getByTestId('loading-history')).toHaveTextContent('true');
  });

  it('allows API calls to be made from deeply nested components', async () => {
    const userEvent = await import('@testing-library/user-event');
    const user = userEvent.default.setup();

    await act(async () => {
      render(
        <ThemeProvider>
          <AgentProvider sessionId="test-session" selectedAgentId="lace_20250101_abc123">
            <ToolApprovalProvider agentId={'lace_20250101_abc123' as ThreadId}>
              <EventStreamProvider
                projectId="test-project"
                sessionId={'lace_20250101_def456' as ThreadId}
                agentId={'lace_20250101_abc123' as ThreadId}
              >
                <div>
                  <div>
                    <div>
                      <TestEventStreamConsumer />
                    </div>
                  </div>
                </div>
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
    });

    // Test API calls work without prop drilling
    await user.click(screen.getByTestId('send-message-button'));
    expect(mockSendMessage).toHaveBeenCalledWith('lace_20250101_abc123', 'Hello');

    await user.click(screen.getByTestId('stop-agent-button'));
    expect(mockStopAgent).toHaveBeenCalledWith('lace_20250101_abc123');
  });

  it('throws error when used outside provider', async () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <ThemeProvider>
          <TestComponentWithoutProvider />
        </ThemeProvider>
      );
    }).toThrow('useEventStreamConnection must be used within EventStreamProvider');

    consoleSpy.mockRestore();
  });

  it('updates state when underlying hooks change', async () => {
    let rerender: ReturnType<typeof render>['rerender'];
    await act(async () => {
      const result = render(
        <ThemeProvider>
          <AgentProvider sessionId="test-session" selectedAgentId="lace_20250101_abc123">
            <ToolApprovalProvider agentId={'lace_20250101_abc123' as ThreadId}>
              <EventStreamProvider
                projectId="test-project"
                sessionId={'lace_20250101_def456' as ThreadId}
                agentId={'lace_20250101_abc123' as ThreadId}
              >
                <TestEventStreamConsumer />
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
      rerender = result.rerender;
    });

    // Initially not connected
    expect(screen.getByTestId('is-connected')).toHaveTextContent('false');

    // Mock hook returns different value
    vi.mocked(useEventStreamHook).mockReturnValue({
      connection: {
        connected: true,
        lastEventId: 'new-conn',
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      } as StreamConnection,
      lastEvent: undefined,
      sendCount: 0,
      close: vi.fn(),
      reconnect: vi.fn(),
    });

    // Force re-render with new mock data
    await act(async () => {
      rerender(
        <ThemeProvider>
          <AgentProvider sessionId="test-session" selectedAgentId="lace_20250101_abc123">
            <ToolApprovalProvider agentId={'lace_20250101_abc123' as ThreadId}>
              <EventStreamProvider
                projectId="test-project"
                sessionId={'lace_20250101_def456' as ThreadId}
                agentId={'lace_20250101_abc123' as ThreadId}
              >
                <TestEventStreamConsumer />
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
    });

    // Should reflect updated state
    expect(screen.getByTestId('is-connected')).toHaveTextContent('true');
    expect(screen.getByTestId('connection-id')).toHaveTextContent('new-conn');
  });

  it('forwards events to child components when they occur', async () => {
    // Mock an event stream that receives events
    const mockEvents: LaceEvent[] = [];
    const mockAddAgentEvent = vi.fn((event: LaceEvent) => {
      mockEvents.push(event);
    });

    vi.mocked(useAgentEventsHook).mockReturnValue({
      events: mockEvents,
      loadingHistory: false,
      connected: true,
      addAgentEvent: mockAddAgentEvent,
    });

    // Mock the event stream to simulate receiving events
    let eventHandlers: Record<string, Function> = {};
    vi.mocked(useEventStreamHook).mockImplementation((options) => {
      // Capture the event handlers so we can simulate events
      eventHandlers = {
        onUserMessage: options.onUserMessage || (() => {}),
        onAgentMessage: options.onAgentMessage || (() => {}),
        onSessionEvent: options.onSessionEvent || (() => {}),
      };

      return {
        connection: { connected: true, reconnectAttempts: 0, maxReconnectAttempts: 5 },
        lastEvent: undefined,
        sendCount: 0,
        close: vi.fn(),
        reconnect: vi.fn(),
      };
    });

    await act(async () => {
      render(
        <ThemeProvider>
          <AgentProvider sessionId="my-session" selectedAgentId="lace_20250101_xyz789">
            <ToolApprovalProvider agentId={'lace_20250101_xyz789' as ThreadId}>
              <EventStreamProvider
                projectId="my-project"
                sessionId={'lace_20250101_qrs456' as ThreadId}
                agentId={'lace_20250101_xyz789' as ThreadId}
              >
                <TestEventStreamConsumer />
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
    });

    // Test behavior: Simulate an AGENT_SUMMARY_UPDATED event coming through SSE
    const summaryEvent: LaceEvent = {
      id: 'test-summary-event',
      type: 'AGENT_SUMMARY_UPDATED',
      threadId: 'lace_20250101_xyz789',
      timestamp: new Date(),
      data: {
        summary: 'Working on test summary',
        agentThreadId: 'lace_20250101_xyz789',
        timestamp: new Date(),
      },
      transient: true,
    };

    // Trigger the event through the session event handler
    await act(async () => {
      if (eventHandlers.onSessionEvent) {
        eventHandlers.onSessionEvent(summaryEvent);
      }
    });

    // Test behavior: Verify the event was properly forwarded to child components
    expect(mockAddAgentEvent).toHaveBeenCalledWith(summaryEvent);
    expect(mockEvents).toContain(summaryEvent);
  });

  it('handles null agentId gracefully without breaking', async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <AgentProvider sessionId="test-session" selectedAgentId={null}>
            <ToolApprovalProvider agentId={null}>
              <EventStreamProvider
                projectId="test-project"
                sessionId={'lace_20250101_def456' as ThreadId}
                agentId={null}
              >
                <TestEventStreamConsumer />
              </EventStreamProvider>
            </ToolApprovalProvider>
          </AgentProvider>
        </ThemeProvider>
      );
    });

    // Test behavior: Provider should render without crashing when agentId is null
    expect(screen.getByTestId('is-connected')).toHaveTextContent('false');
    expect(screen.getByTestId('events-count')).toHaveTextContent('0');

    // Test configuration: Verify event stream is configured with correct filters
    expect(useEventStreamHook).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'test-project',
        sessionId: 'lace_20250101_def456',
        threadIds: undefined,
      })
    );
  });
});
