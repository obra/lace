// ABOUTME: Tests for useEventStream hook with AppEvent support
// ABOUTME: Verifies both legacy LaceEvent and new protocol event handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEventStream } from '@lace/web/hooks/useEventStream';
import type { ProtocolEvent, WebEvent } from '@lace/web/types/app-events';
import type { LaceEvent } from '@lace/web/types/core';

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
   * Helper to get the LaceEvent callback (first callback passed to subscribe)
   */
  function getLaceEventCallback() {
    return mockSubscribe.mock.calls[0][1];
  }

  /**
   * Helper to get the AppEvent callback (second callback passed to subscribe)
   */
  function getAppEventCallback() {
    return mockSubscribe.mock.calls[0][2];
  }

  describe('Legacy LaceEvent handling', () => {
    it('should route USER_MESSAGE events to onUserMessage handler', async () => {
      const onUserMessage = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onUserMessage,
        })
      );

      const laceCallback = getLaceEventCallback();

      const laceEvent: LaceEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date(),
        data: { content: 'Hello' },
        context: { sessionId: 'sess_123' },
      };

      act(() => {
        laceCallback(laceEvent);
      });

      expect(onUserMessage).toHaveBeenCalledWith(laceEvent);
    });

    it('should route AGENT_TOKEN events to onAgentToken handler', async () => {
      const onAgentToken = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onAgentToken,
        })
      );

      const laceCallback = getLaceEventCallback();

      const laceEvent: LaceEvent = {
        id: 'evt_1',
        type: 'AGENT_TOKEN',
        timestamp: new Date(),
        transient: true,
        data: { token: 'Hello' },
        context: { sessionId: 'sess_123' },
      };

      act(() => {
        laceCallback(laceEvent);
      });

      expect(onAgentToken).toHaveBeenCalledWith(laceEvent);
    });

    it('should route TOOL_CALL events to onToolCall handler', async () => {
      const onToolCall = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onToolCall,
        })
      );

      const laceCallback = getLaceEventCallback();

      const laceEvent: LaceEvent = {
        id: 'evt_1',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: { id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
        context: { sessionId: 'sess_123' },
      };

      act(() => {
        laceCallback(laceEvent);
      });

      expect(onToolCall).toHaveBeenCalledWith(laceEvent);
    });
  });

  describe('Protocol Event handling', () => {
    it('should route text_delta protocol events to onProtocolTextDelta handler', async () => {
      const onProtocolTextDelta = vi.fn();

      renderHook(() =>
        useEventStream({
          sessionId: 'sess_123',
          onProtocolTextDelta,
        })
      );

      const appCallback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: 'agent_123',
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello world',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(protocolEvent);
      });

      expect(onProtocolTextDelta).toHaveBeenCalledWith({
        text: 'Hello world',
        agentSessionId: 'agent_123',
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

      const appCallback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: 'agent_123',
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
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(protocolEvent);
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

      const appCallback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: 'agent_123',
          streamSeq: 1,
          type: 'error',
          code: 'TOOL_ERROR',
          message: 'Tool execution failed',
          phase: 'execution',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(protocolEvent);
      });

      expect(onProtocolError).toHaveBeenCalledWith({
        code: 'TOOL_ERROR',
        message: 'Tool execution failed',
        phase: 'execution',
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

      const appCallback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: 'agent_123',
          streamSeq: 1,
          type: 'turn_start',
          turnId: 'turn_1',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(protocolEvent);
      });

      expect(onProtocolTurnStart).toHaveBeenCalledWith({
        turnId: 'turn_1',
        agentSessionId: 'agent_123',
      });
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

      const appCallback = getAppEventCallback();

      const webEvent: WebEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        type: 'USER_MESSAGE_SENT',
        data: {
          content: 'Test message',
          agentSessionId: 'agent_123',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(webEvent);
      });

      expect(onWebUserMessage).toHaveBeenCalledWith({
        content: 'Test message',
        agentSessionId: 'agent_123',
      });
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

      const appCallback = getAppEventCallback();

      const protocolEvent: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: 'agent_123',
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      act(() => {
        appCallback(protocolEvent);
      });

      expect(onAppEvent).toHaveBeenCalledWith(protocolEvent);
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
