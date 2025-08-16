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
  useToolApprovals,
} from './EventStreamProvider';
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
    <EventStreamProvider
      projectId="test-project"
      sessionId={'test-session' as ThreadId}
      agentId={'test-agent' as ThreadId}
    >
      {children}
    </EventStreamProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mock return values
    const mockSessionEventsReturn: UseSessionEventsReturn = {
      allEvents: [],
      filteredEvents: [],
      pendingApprovals: [],
      loadingHistory: false,
      connected: false,
      clearApprovalRequest: vi.fn(),
      addSessionEvent: vi.fn(),
      handleApprovalRequest: vi.fn(),
      handleApprovalResponse: vi.fn(),
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

  it('provides tool approvals context to children', () => {
    const { result } = renderHook(() => useToolApprovals(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.pendingApprovals).toBeDefined();
    expect(result.current.clearApprovalRequest).toBeDefined();
    expect(result.current.handleApprovalRequest).toBeDefined();
    expect(result.current.handleApprovalResponse).toBeDefined();
  });

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
      pendingApprovals: [],
      loadingHistory: false,
      connected: false,
      clearApprovalRequest: vi.fn(),
      addSessionEvent: vi.fn(),
      handleApprovalRequest: vi.fn(),
      handleApprovalResponse: vi.fn(),
    };

    mockUseSessionEvents.mockReturnValue(mockSessionEventsWithData);

    const { result } = renderHook(() => useSessionEvents(), { wrapper });

    expect(result.current.events).toEqual(mockEvents);
    expect(result.current.loadingHistory).toBe(false);
  });

  it('exposes tool approval state', () => {
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

    const mockSessionEventsWithApprovals: UseSessionEventsReturn = {
      allEvents: [],
      filteredEvents: [],
      pendingApprovals: mockApprovals,
      loadingHistory: false,
      connected: false,
      clearApprovalRequest: vi.fn(),
      addSessionEvent: vi.fn(),
      handleApprovalRequest: vi.fn(),
      handleApprovalResponse: vi.fn(),
    };

    mockUseSessionEvents.mockReturnValue(mockSessionEventsWithApprovals);

    const { result } = renderHook(() => useToolApprovals(), { wrapper });

    expect(result.current.pendingApprovals).toEqual(mockApprovals);
  });

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

    expect(() => {
      renderHook(() => useToolApprovals());
    }).toThrow('useToolApprovals must be used within EventStreamProvider');
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
      <EventStreamProvider
        projectId="test-project"
        sessionId={'test-session' as ThreadId}
        agentId={null}
      >
        {children}
      </EventStreamProvider>
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
