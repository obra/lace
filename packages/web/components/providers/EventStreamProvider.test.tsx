// ABOUTME: Tests for EventStreamProvider context that manages event streams and tool approvals
// ABOUTME: Validates event handling, streaming connections, and approval workflow state management

import React from 'react';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  EventStreamProvider,
  useEventStream,
  useSessionEvents,
  useSessionAPI,
} from './EventStreamProvider';
import { ToolApprovalProvider } from './ToolApprovalProvider';
import type { ReactNode } from 'react';
import type { ThreadId } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { PendingApproval } from '@/types/api';
import type { StreamConnection } from '@/types/stream-events';
import type { UseSessionEventsReturn } from '@/hooks/useSessionEvents';
import type { UseEventStreamResult } from '@/hooks/useEventStream';
import type { UseSessionAPIReturn } from '@/hooks/useSessionAPI';

// Mock all dependencies
vi.mock('@/hooks/useSessionEvents');
vi.mock('@/hooks/useEventStream');
vi.mock('@/hooks/useSessionAPI');

// Import and type the mocked hooks
import { useSessionEvents as useSessionEventsHook } from '@/hooks/useSessionEvents';
import { useEventStream as useEventStreamHook } from '@/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@/hooks/useSessionAPI';

const mockUseSessionEvents = useSessionEventsHook as MockedFunction<() => UseSessionEventsReturn>;
const mockUseEventStream = useEventStreamHook as MockedFunction<() => UseEventStreamResult>;
const mockUseSessionAPI = useSessionAPIHook as MockedFunction<() => UseSessionAPIReturn>;

describe('EventStreamProvider', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ToolApprovalProvider agentId={'test-agent' as ThreadId}>
      <EventStreamProvider
        projectId="test-project"
        sessionId={'test-session' as ThreadId}
        agentId={'test-agent' as ThreadId}
      >
        {children}
      </EventStreamProvider>
    </ToolApprovalProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock return values
    const mockSessionEventsReturn: UseSessionEventsReturn = {
      allEvents: [],
      filteredEvents: [],
      loadingHistory: false,
      connected: false,
      addSessionEvent: vi.fn(),
    };

    const mockEventStreamReturn: UseEventStreamResult = {
      connection: {
        connected: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      } as StreamConnection,
      lastEvent: undefined,
      sendCount: 0,
      close: vi.fn(),
      reconnect: vi.fn(),
    };

    const mockSessionAPIReturn: UseSessionAPIReturn = {
      error: null,
      createSession: vi.fn(),
      getSession: vi.fn(),
      spawnAgent: vi.fn(),
      listAgents: vi.fn(),
      sendMessage: vi.fn(),
      stopAgent: vi.fn(),
    };

    mockUseSessionEvents.mockReturnValue(mockSessionEventsReturn);
    mockUseEventStream.mockReturnValue(mockEventStreamReturn);
    mockUseSessionAPI.mockReturnValue(mockSessionAPIReturn);
  });

  it('provides event stream context to children', () => {
    const { result } = renderHook(() => useEventStream(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.connection).toBeDefined();
    expect(result.current.lastEvent).toBeUndefined(); // lastEvent is optional and undefined by default
    expect(result.current.sendCount).toBeDefined();
    expect(result.current.close).toBeDefined();
    expect(result.current.reconnect).toBeDefined();
  });

  it('provides session events context to children', () => {
    const { result } = renderHook(() => useSessionEvents(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.events).toBeDefined();
    expect(result.current.loadingHistory).toBeDefined();
    expect(result.current.addSessionEvent).toBeDefined();
  });

  it('provides session API context to children', () => {
    const { result } = renderHook(() => useSessionAPI(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeDefined();
    expect(result.current.stopAgent).toBeDefined();
  });

  // Note: Tool approval functionality has been moved to ToolApprovalProvider

  it('exposes session events state', () => {
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        threadId: 'test-agent' as ThreadId,
        data: 'Hello',
      },
    ];

    const mockSessionEventsWithData: UseSessionEventsReturn = {
      allEvents: mockEvents,
      filteredEvents: mockEvents,
      loadingHistory: false,
      connected: false,
      addSessionEvent: vi.fn(),
    };

    mockUseSessionEvents.mockReturnValue(mockSessionEventsWithData);

    const { result } = renderHook(() => useSessionEvents(), { wrapper });

    expect(result.current.events).toEqual(mockEvents);
    expect(result.current.loadingHistory).toBe(false);
  });

  // Note: Tool approval functionality has been moved to ToolApprovalProvider

  it('exposes event stream connection state', () => {
    mockUseEventStream.mockReturnValue({
      connection: {
        connected: true,
        lastEventId: 'conn-1',
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
      },
      lastEvent: undefined,
      sendCount: 5,
      close: vi.fn(),
      reconnect: vi.fn(),
    });

    const { result } = renderHook(() => useEventStream(), { wrapper });

    expect(result.current.connection.connected).toBe(true);
    expect(result.current.connection.lastEventId).toBe('conn-1');
    expect(result.current.sendCount).toBe(5);
  });

  it('exposes session API methods', () => {
    const mockSendMessage = vi.fn();
    const mockStopAgent = vi.fn();

    const mockSessionAPIWithMethods: UseSessionAPIReturn = {
      error: null,
      createSession: vi.fn(),
      getSession: vi.fn(),
      spawnAgent: vi.fn(),
      listAgents: vi.fn(),
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
    };

    mockUseSessionAPI.mockReturnValue(mockSessionAPIWithMethods);

    const { result } = renderHook(() => useSessionAPI(), { wrapper });

    expect(result.current.sendMessage).toBe(mockSendMessage);
    expect(result.current.stopAgent).toBe(mockStopAgent);
  });

  it('passes correct parameters to underlying hooks', () => {
    renderHook(() => useEventStream(), { wrapper });

    expect(mockUseSessionEvents).toHaveBeenCalledWith('test-session', 'test-agent', false);
    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'test-session',
      threadIds: ['test-agent'],
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
    });
  });

  it('throws error when used outside provider', () => {
    expect(() => {
      renderHook(() => useEventStream());
    }).toThrow('useEventStream must be used within EventStreamProvider');

    expect(() => {
      renderHook(() => useSessionEvents());
    }).toThrow('useSessionEvents must be used within EventStreamProvider');

    expect(() => {
      renderHook(() => useSessionAPI());
    }).toThrow('useSessionAPI must be used within EventStreamProvider');

    // Note: Tool approval functionality has been moved to ToolApprovalProvider
  });

  it('calls underlying hooks with correct parameters', () => {
    renderHook(() => useEventStream(), { wrapper });

    // Verify initial calls are made with correct parameters
    expect(mockUseSessionEvents).toHaveBeenCalledWith('test-session', 'test-agent', false);
    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'test-session',
      threadIds: ['test-agent'],
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
    });
  });

  it('handles missing agentId gracefully', () => {
    const wrapperWithoutAgent = ({ children }: { children: ReactNode }) => (
      <ToolApprovalProvider agentId={null}>
        <EventStreamProvider
          projectId="test-project"
          sessionId={'test-session' as ThreadId}
          agentId={null}
        >
          {children}
        </EventStreamProvider>
      </ToolApprovalProvider>
    );

    renderHook(() => useEventStream(), { wrapper: wrapperWithoutAgent });

    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'test-session',
      threadIds: undefined,
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
    });
  });
});
