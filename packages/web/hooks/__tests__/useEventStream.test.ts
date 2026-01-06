// ABOUTME: Tests for useEventStream hook with AppEvent support
// ABOUTME: FLAG-DAY: Only AppEvent (ProtocolEvent | WebEvent), no LaceEvent

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventStream } from '@lace/web/hooks/useEventStream';
import type { ProtocolEvent, WebEvent, AppEvent } from '@lace/web/types/app-events';
import type { SessionId } from '@lace/ent-protocol';

// Mock the SSE store
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockReconnect = vi.fn();
const mockGetConnectionStats = vi.fn();

vi.mock('@lace/web/lib/sse-store', () => ({
  useSSEStore: {
    getState: () => ({
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      reconnect: mockReconnect,
      getConnectionStats: mockGetConnectionStats,
    }),
  },
}));

describe('useEventStream', () => {
  // Use branded SessionId for type safety (cast is safe in tests)
  const mockSessionId = 'sess_123' as SessionId;
  const mockAgentSessionId = 'agent_123' as SessionId;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscribe.mockReturnValue('sub_123');
    mockGetConnectionStats.mockReturnValue({
      isConnected: true,
      subscriptionCount: 1,
      connectionUrl: '/api/events/stream',
      connectedAt: new Date(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper to get the AppEvent callback (single callback passed to subscribe)
   * FLAG-DAY: Only one callback now - no separate LaceEvent callback
   */
  function getAppEventCallback(): (event: AppEvent) => void {
    return mockSubscribe.mock.calls[0][1];
  }

  describe('Protocol Event handling', () => {
    it('should route text_delta protocol events to onProtocolTextDelta handler', async () => {
      const onProtocolTextDelta = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onProtocolTextDelta,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello world',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onProtocolTextDelta).toHaveBeenCalledWith({
        text: 'Hello world',
        agentSessionId: mockAgentSessionId,
        streamSeq: 1,
      });
    });

    it('should route tool_use protocol events to onProtocolToolUse handler', async () => {
      const onProtocolToolUse = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onProtocolToolUse,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          turnId: 'turn_1',
          turnSeq: 0,
          type: 'tool_use',
          toolCallId: 'call_1',
          name: 'bash',
          input: { command: 'ls' },
          status: 'pending',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onProtocolToolUse).toHaveBeenCalledWith({
        toolCallId: 'call_1',
        name: 'bash',
        input: { command: 'ls' },
        status: 'pending',
        result: undefined,
      });
    });

    it('should route error protocol events to onProtocolError handler', async () => {
      const onProtocolError = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onProtocolError,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'error',
          code: 'TOOL_ERROR',
          message: 'Tool execution failed',
          phase: 'tool_execution',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onProtocolError).toHaveBeenCalledWith({
        code: 'TOOL_ERROR',
        message: 'Tool execution failed',
        phase: 'tool_execution',
      });
    });

    it('should route turn_start protocol events to onProtocolTurnStart handler', async () => {
      const onProtocolTurnStart = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onProtocolTurnStart,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'turn_start',
          turnId: 'turn_1',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onProtocolTurnStart).toHaveBeenCalledWith({
        turnId: 'turn_1',
        agentSessionId: mockAgentSessionId,
      });
    });

    it('should route text_delta to onAgentToken for legacy compatibility', async () => {
      const onAgentToken = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onAgentToken,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onAgentToken).toHaveBeenCalledWith(protocolEvent);
    });
  });

  describe('Web Event handling', () => {
    it('should route USER_MESSAGE_SENT web events to onWebUserMessage handler', async () => {
      const onWebUserMessage = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onWebUserMessage,
        })
      );

      const callback = getAppEventCallback();

      const webEvent: WebEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        type: 'USER_MESSAGE_SENT',
        data: {
          content: 'Test message',
          agentSessionId: mockAgentSessionId,
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(webEvent);
      });

      expect(onWebUserMessage).toHaveBeenCalledWith({
        content: 'Test message',
        agentSessionId: mockAgentSessionId,
      });
    });

    it('should route USER_MESSAGE_SENT to legacy onUserMessage handler', async () => {
      const onUserMessage = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onUserMessage,
        })
      );

      const callback = getAppEventCallback();

      const webEvent: WebEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        type: 'USER_MESSAGE_SENT',
        data: {
          content: 'Test message',
          agentSessionId: mockAgentSessionId,
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(webEvent);
      });

      expect(onUserMessage).toHaveBeenCalledWith(webEvent);
    });
  });

  describe('Generic event handler', () => {
    it('should call onAppEvent for all event types', async () => {
      const onAppEvent = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onAppEvent,
        })
      );

      const callback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(protocolEvent);
      });

      expect(onAppEvent).toHaveBeenCalledWith(protocolEvent);
    });

    it('should call onSessionEvent for legacy compatibility', async () => {
      const onSessionEvent = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onSessionEvent,
        })
      );

      const callback = getAppEventCallback();

      const webEvent: WebEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        type: 'USER_MESSAGE_SENT',
        data: {
          content: 'Test',
          agentSessionId: mockAgentSessionId,
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      act(() => {
        callback(webEvent);
      });

      expect(onSessionEvent).toHaveBeenCalledWith(webEvent);
    });
  });

  describe('Connection management', () => {
    it('should unsubscribe on unmount', () => {
      const { unmount } = renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
        })
      );

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledWith('sub_123');
    });

    it('should return connection status', () => {
      const { result } = renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
        })
      );

      expect(result.current.connection.connected).toBe(true);
    });

    it('should call reconnect when reconnect function is called', () => {
      const { result } = renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
        })
      );

      act(() => {
        result.current.reconnect();
      });

      expect(mockReconnect).toHaveBeenCalled();
    });
  });
});
