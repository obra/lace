// ABOUTME: Tests for EventStreamProvider context that manages event streams and tool approvals
// ABOUTME: Validates event handling, streaming connections, and approval workflow state management

import React from 'react';
import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { stringify } from '@/lib/serialization';
import {
  EventStreamProvider,
  useEventStreamConnection,
  useSessionEvents,
  useAgentAPI,
} from './EventStreamProvider';
import { ToolApprovalProvider } from './ToolApprovalProvider';
import { AgentProvider } from './AgentProvider';
import type { ReactNode } from 'react';
import type { ThreadId } from '@/types/core';
import type { LaceEvent } from '~/threads/types';
import type { PendingApproval } from '@/types/api';
import type { StreamConnection } from '@/types/stream-events';
import type { UseAgentEventsReturn } from '@/hooks/useAgentEvents';
import type { UseEventStreamResult } from '@/hooks/useEventStream';
import type { UseSessionAPIReturn } from '@/hooks/useSessionAPI';
import type { UseAgentAPIReturn } from '@/hooks/useAgentAPI';

// Mock all dependencies
vi.mock('@/hooks/useAgentEvents');
vi.mock('@/hooks/useEventStream');
vi.mock('@/hooks/useSessionAPI');
vi.mock('@/hooks/useAgentAPI');
vi.mock('@/hooks/useAgentManagement');

// Import and type the mocked hooks
import { useAgentEvents as useAgentEventsHook } from '@/hooks/useAgentEvents';
import { useEventStream as useEventStreamHook } from '@/hooks/useEventStream';
import { useSessionAPI as useSessionAPIHook } from '@/hooks/useSessionAPI';
import { useAgentAPI as useAgentAPIHook } from '@/hooks/useAgentAPI';
import { useAgentManagement } from '@/hooks/useAgentManagement';

const mockUseAgentEvents = useAgentEventsHook as MockedFunction<() => UseAgentEventsReturn>;
const mockUseEventStream = useEventStreamHook as MockedFunction<() => UseEventStreamResult>;
const mockUseSessionAPI = useSessionAPIHook as MockedFunction<() => UseSessionAPIReturn>;
const mockUseAgentAPI = useAgentAPIHook as MockedFunction<() => UseAgentAPIReturn>;
const mockUseAgentManagement = vi.mocked(useAgentManagement);

describe('EventStreamProvider', () => {
  // Mock fetch globally
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AgentProvider sessionId="test-session" selectedAgentId="lace_20250101_abc123.1">
      <ToolApprovalProvider agentId={'lace_20250101_abc123.1' as ThreadId}>
        <EventStreamProvider
          projectId="test-project"
          sessionId={'lace_20250101_def456' as ThreadId}
          agentId={'lace_20250101_abc123.1' as ThreadId}
        >
          {children}
        </EventStreamProvider>
      </ToolApprovalProvider>
    </AgentProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch API responses with proper superjson serialized content
    mockFetch.mockImplementation((url: string) => {
      // Handle tool approval endpoints
      if (url.includes('/approvals/pending')) {
        const response = stringify([]);
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(response),
          json: () => Promise.resolve([]),
          clone: function () {
            return this;
          },
        } as Response);
      }

      // Default fallback for other URLs
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(stringify({})),
        json: () => Promise.resolve({}),
        clone: function () {
          return this;
        },
      } as Response);
    });

    // Set up default mock return values
    const mockAgentEventsReturn: UseAgentEventsReturn = {
      events: [],
      loadingHistory: false,
      connected: false,
      addAgentEvent: vi.fn(),
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
    };

    const mockAgentAPIReturn: UseAgentAPIReturn = {
      error: null,
      sendMessage: vi.fn(),
      stopAgent: vi.fn(),
    };

    const mockAgentManagementReturn = {
      sessionDetails: null,
      loading: false,
      createAgent: vi.fn(),
      updateAgentState: vi.fn(),
      reloadSessionDetails: vi.fn(),
      loadAgentConfiguration: vi.fn(),
      updateAgent: vi.fn(),
    };

    mockUseAgentEvents.mockReturnValue(mockAgentEventsReturn);
    mockUseEventStream.mockReturnValue(mockEventStreamReturn);
    mockUseSessionAPI.mockReturnValue(mockSessionAPIReturn);
    mockUseAgentAPI.mockReturnValue(mockAgentAPIReturn);
    mockUseAgentManagement.mockReturnValue(mockAgentManagementReturn);
  });

  it('provides event stream context to children', async () => {
    const { result } = renderHook(() => useEventStreamConnection(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current).toBeDefined();
    expect(result.current.connection).toBeDefined();
    expect(result.current.lastEvent).toBeUndefined(); // lastEvent is optional and undefined by default
    expect(result.current.sendCount).toBeDefined();
    expect(result.current.close).toBeDefined();
    expect(result.current.reconnect).toBeDefined();
  });

  it('provides session events context to children', async () => {
    const { result } = renderHook(() => useSessionEvents(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current).toBeDefined();
    expect(result.current.events).toBeDefined();
    expect(result.current.loadingHistory).toBeDefined();
    expect(result.current.addAgentEvent).toBeDefined();
  });

  it('provides agent API context to children', async () => {
    const { result } = renderHook(() => useAgentAPI(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current).toBeDefined();
    expect(result.current.sendMessage).toBeDefined();
    expect(result.current.stopAgent).toBeDefined();
  });

  // Note: Tool approval functionality has been moved to ToolApprovalProvider

  it('exposes session events state', async () => {
    const mockEvents: LaceEvent[] = [
      {
        id: 'event-1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        threadId: 'lace_20250101_abc123.1' as ThreadId,
        data: 'Hello',
      },
    ];

    const mockAgentEventsWithData: UseAgentEventsReturn = {
      events: mockEvents,
      loadingHistory: false,
      connected: false,
      addAgentEvent: vi.fn(),
    };

    mockUseAgentEvents.mockReturnValue(mockAgentEventsWithData);

    const { result } = renderHook(() => useSessionEvents(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current.events).toEqual(mockEvents);
    expect(result.current.loadingHistory).toBe(false);
  });

  // Note: Tool approval functionality has been moved to ToolApprovalProvider

  it('exposes event stream connection state', async () => {
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

    const { result } = renderHook(() => useEventStreamConnection(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current.connection.connected).toBe(true);
    expect(result.current.connection.lastEventId).toBe('conn-1');
    expect(result.current.sendCount).toBe(5);
  });

  it('exposes agent API methods', async () => {
    const mockSendMessage = vi.fn();
    const mockStopAgent = vi.fn();

    const mockAgentAPIWithMethods: UseAgentAPIReturn = {
      error: null,
      sendMessage: mockSendMessage,
      stopAgent: mockStopAgent,
    };

    mockUseAgentAPI.mockReturnValue(mockAgentAPIWithMethods);

    const { result } = renderHook(() => useAgentAPI(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(result.current.sendMessage).toBe(mockSendMessage);
    expect(result.current.stopAgent).toBe(mockStopAgent);
  });

  it('passes correct parameters to underlying hooks', async () => {
    renderHook(() => useEventStreamConnection(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(mockUseAgentEvents).toHaveBeenCalledWith('lace_20250101_abc123.1', false);
    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'lace_20250101_def456',
      threadIds: ['lace_20250101_abc123.1'],
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onAgentError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onAgentToken: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
      onApprovalResponse: expect.any(Function),
      onCompactionStart: expect.any(Function),
      onCompactionComplete: expect.any(Function),
    });
  });

  it('throws error when used outside provider', () => {
    // Suppress console.error for expected error scenarios
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useEventStreamConnection());
    }).toThrow('useEventStreamConnection must be used within EventStreamProvider');

    expect(() => {
      renderHook(() => useSessionEvents());
    }).toThrow('useSessionEvents must be used within EventStreamProvider');

    expect(() => {
      renderHook(() => useAgentAPI());
    }).toThrow('useAgentAPI must be used within EventStreamProvider');

    // Verify React error boundary logging occurred (these are expected)
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();

    // Note: Tool approval functionality has been moved to ToolApprovalProvider
  });

  it('calls underlying hooks with correct parameters', async () => {
    renderHook(() => useEventStreamConnection(), { wrapper });

    await act(async () => {
      // Wait for any async effects to complete
    });

    // Verify initial calls are made with correct parameters
    expect(mockUseAgentEvents).toHaveBeenCalledWith('lace_20250101_abc123.1', false);
    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'lace_20250101_def456',
      threadIds: ['lace_20250101_abc123.1'],
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onAgentError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onAgentToken: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
      onApprovalResponse: expect.any(Function),
      onCompactionStart: expect.any(Function),
      onCompactionComplete: expect.any(Function),
    });
  });

  it('handles missing agentId gracefully', async () => {
    const wrapperWithoutAgent = ({ children }: { children: ReactNode }) => (
      <AgentProvider sessionId="test-session" selectedAgentId={null}>
        <ToolApprovalProvider agentId={null}>
          <EventStreamProvider
            projectId="test-project"
            sessionId={'lace_20250101_def456' as ThreadId}
            agentId={null}
          >
            {children}
          </EventStreamProvider>
        </ToolApprovalProvider>
      </AgentProvider>
    );

    renderHook(() => useEventStreamConnection(), { wrapper: wrapperWithoutAgent });

    await act(async () => {
      // Wait for any async effects to complete
    });

    expect(mockUseEventStream).toHaveBeenCalledWith({
      projectId: 'test-project',
      sessionId: 'lace_20250101_def456',
      threadIds: undefined,
      onConnect: expect.any(Function),
      onError: expect.any(Function),
      onAgentError: expect.any(Function),
      onUserMessage: expect.any(Function),
      onAgentMessage: expect.any(Function),
      onAgentToken: expect.any(Function),
      onToolCall: expect.any(Function),
      onToolResult: expect.any(Function),
      onAgentStateChange: expect.any(Function),
      onApprovalRequest: expect.any(Function),
      onApprovalResponse: expect.any(Function),
      onCompactionStart: expect.any(Function),
      onCompactionComplete: expect.any(Function),
    });
  });
});
