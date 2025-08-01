// ABOUTME: Tests for useSessionEvents hook with Zod date hydration
// ABOUTME: Verifies streaming events, history loading, and tool approval handling

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionEvents } from './useSessionEvents';
import type { ThreadId, SessionEvent, ToolApprovalRequestData } from '@/types/api';
import { asThreadId } from '@/lib/server/core-types';
import { useEventStream } from './useEventStream';

// Mock the useEventStream hook
vi.mock('./useEventStream', () => ({
  useEventStream: vi.fn(),
}));

// Mock fetch for history and approval requests
global.fetch = vi.fn();

// Mock console.error to avoid noise in tests
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

describe('useSessionEvents', () => {
  const sessionId = asThreadId('lace_20250801_test123');
  const agentId = asThreadId('lace_20250801_test123.1');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEventStream).mockReturnValue({
      connection: { connected: true },
    });

    // Mock successful history fetch
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes('/history')) {
        return Promise.resolve({
          json: () => Promise.resolve({ events: [] }),
        });
      }
      if (url.includes('/approvals/pending')) {
        return Promise.resolve({
          json: () => Promise.resolve({ pendingApprovals: [] }),
        });
      }
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  afterEach(() => {
    mockConsoleError.mockClear();
  });

  describe('initialization', () => {
    it('should initialize with empty state', () => {
      const { result } = renderHook(() => useSessionEvents(null, null));

      expect(result.current.allEvents).toEqual([]);
      expect(result.current.filteredEvents).toEqual([]);
      expect(result.current.pendingApprovals).toEqual([]);
      expect(result.current.loadingHistory).toBe(false);
    });

    it('should set up event stream subscription correctly', () => {
      renderHook(() => useSessionEvents(sessionId, agentId));

      expect(useEventStream).toHaveBeenCalledWith({
        subscription: {
          sessions: [sessionId],
          threads: [agentId],
          eventTypes: [
            'USER_MESSAGE',
            'AGENT_MESSAGE',
            'TOOL_CALL',
            'TOOL_RESULT',
            'TOOL_APPROVAL_REQUEST',
            'TOOL_APPROVAL_RESPONSE',
            'LOCAL_SYSTEM_MESSAGE',
            'AGENT_TOKEN',
            'AGENT_STREAMING',
            'COMPACTION',
            'SYSTEM_PROMPT',
            'USER_SYSTEM_PROMPT',
          ],
        },
        onEvent: expect.any(Function),
        onConnect: expect.any(Function),
        onError: expect.any(Function),
      });
    });
  });

  describe('event handling', () => {
    it('should handle valid SessionEvents with date hydration', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      // Get the onEvent handler from the useEventStream call
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // Create a stream event with string timestamp (like from JSON)
      const streamEvent = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z', // String timestamp
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T12:00:00.000Z', // String timestamp
          data: { content: 'Hello world' },
        },
      };

      act(() => {
        onEventHandler(streamEvent);
      });

      expect(result.current.allEvents).toHaveLength(1);
      const event = result.current.allEvents[0];
      expect(event.type).toBe('USER_MESSAGE');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.timestamp.toISOString()).toBe('2025-08-01T12:00:00.000Z');
      expect(event.data).toEqual({ content: 'Hello world' });
    });

    it('should handle tool approval requests', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      const approvalData: ToolApprovalRequestData = {
        requestId: 'req-123',
        toolName: 'bash',
        input: { command: 'ls -la' },
        isReadOnly: false,
        riskLevel: 'moderate',
      };

      const streamEvent = {
        id: 'event-2',
        timestamp: '2025-08-01T12:01:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'TOOL_APPROVAL_REQUEST',
          threadId: agentId,
          timestamp: '2025-08-01T12:01:00.000Z',
          data: approvalData,
        },
      };

      act(() => {
        onEventHandler(streamEvent);
      });

      expect(result.current.pendingApprovals).toHaveLength(1);
      const pending = result.current.pendingApprovals[0];
      expect(pending.toolCallId).toBe('req-123');
      expect(pending.toolCall.name).toBe('bash');
      expect(pending.requestedAt).toBeInstanceOf(Date);
      expect(pending.requestData).toEqual(approvalData);

      // Should not add approval requests to timeline
      expect(result.current.allEvents).toHaveLength(0);
    });

    it('should handle tool approval responses', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // First add a pending approval
      const approvalEvent = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'TOOL_APPROVAL_REQUEST',
          threadId: agentId,
          timestamp: '2025-08-01T12:00:00.000Z',
          data: {
            requestId: 'req-123',
            toolName: 'bash',
            input: { command: 'ls' },
            isReadOnly: false,
            riskLevel: 'moderate',
          },
        },
      };

      act(() => {
        onEventHandler(approvalEvent);
      });

      expect(result.current.pendingApprovals).toHaveLength(1);

      // Now send approval response
      const responseEvent = {
        id: 'event-2',
        timestamp: '2025-08-01T12:01:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'TOOL_APPROVAL_RESPONSE',
          threadId: agentId,
          timestamp: '2025-08-01T12:01:00.000Z',
          data: { toolCallId: 'req-123', decision: 'approved' },
        },
      };

      act(() => {
        onEventHandler(responseEvent);
      });

      // Should remove the pending approval
      expect(result.current.pendingApprovals).toHaveLength(0);
      // Should not add approval responses to timeline
      expect(result.current.allEvents).toHaveLength(0);
    });

    it('should handle invalid events gracefully', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // Send an invalid event
      const invalidEvent = {
        id: 'event-1',
        timestamp: 'invalid-date',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'INVALID_TYPE',
          threadId: sessionId,
          timestamp: 'invalid-date',
          data: { content: 'test' },
        },
      };

      act(() => {
        onEventHandler(invalidEvent);
      });

      // Should not crash and should log error
      expect(result.current.allEvents).toHaveLength(0);
      expect(mockConsoleError).toHaveBeenCalledWith(
        '[SESSION_EVENTS] Failed to parse stream event:',
        expect.any(Error),
        invalidEvent
      );
    });

    it('should prevent duplicate events', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      const streamEvent = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T12:00:00.000Z',
          data: { content: 'Hello world' },
        },
      };

      // Send the same event twice
      act(() => {
        onEventHandler(streamEvent);
        onEventHandler(streamEvent);
      });

      // Should only have one event
      expect(result.current.allEvents).toHaveLength(1);
    });

    it('should sort events by timestamp', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // Send events out of order
      const event2 = {
        id: 'event-2',
        timestamp: '2025-08-01T12:02:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T12:02:00.000Z',
          data: { content: 'Second message' },
        },
      };

      const event1 = {
        id: 'event-1',
        timestamp: '2025-08-01T12:01:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T12:01:00.000Z',
          data: { content: 'First message' },
        },
      };

      act(() => {
        onEventHandler(event2);
        onEventHandler(event1);
      });

      expect(result.current.allEvents).toHaveLength(2);
      expect(result.current.allEvents[0].data).toEqual({ content: 'First message' });
      expect(result.current.allEvents[1].data).toEqual({ content: 'Second message' });
    });
  });

  describe('history loading', () => {
    it('should load and parse history events', async () => {
      const historyEvents = [
        {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T10:00:00.000Z',
          data: { content: 'History message 1' },
        },
        {
          type: 'AGENT_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T10:01:00.000Z',
          data: { content: 'History message 2' },
        },
      ];

      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/history')) {
          return Promise.resolve({
            json: () => Promise.resolve({ events: historyEvents }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      });

      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      // Trigger the onConnect callback to set loading to false
      const onConnect = vi.mocked(useEventStream).mock.calls[0][0].onConnect;

      // Wait for history to load
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        onConnect?.();
      });

      expect(result.current.allEvents).toHaveLength(2);
      expect(result.current.allEvents[0].timestamp).toBeInstanceOf(Date);
      expect(result.current.allEvents[1].timestamp).toBeInstanceOf(Date);
      expect(result.current.loadingHistory).toBe(false);
    });

    it('should filter out approval events from history', async () => {
      const historyEvents = [
        {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T10:00:00.000Z',
          data: { content: 'Regular message' },
        },
        {
          type: 'TOOL_APPROVAL_REQUEST',
          threadId: agentId,
          timestamp: '2025-08-01T10:01:00.000Z',
          data: {
            requestId: 'req-1',
            toolName: 'bash',
            input: {},
            isReadOnly: false,
            riskLevel: 'safe',
          },
        },
        {
          type: 'TOOL_APPROVAL_RESPONSE',
          threadId: agentId,
          timestamp: '2025-08-01T10:02:00.000Z',
          data: { toolCallId: 'req-1', decision: 'approved' },
        },
      ];

      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/history')) {
          return Promise.resolve({
            json: () => Promise.resolve({ events: historyEvents }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      });

      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should only have the regular message, not the approval events
      expect(result.current.allEvents).toHaveLength(1);
      expect(result.current.allEvents[0].type).toBe('USER_MESSAGE');
    });

    it('should handle history parsing errors gracefully', async () => {
      const invalidHistoryEvents = [
        {
          type: 'INVALID_TYPE',
          threadId: 'invalid-id',
          timestamp: 'invalid-date',
          data: null,
        },
      ];

      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/history')) {
          return Promise.resolve({
            json: () => Promise.resolve({ events: invalidHistoryEvents }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      });

      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Should fallback to empty array
      expect(result.current.allEvents).toHaveLength(0);
      expect(mockConsoleError).toHaveBeenCalledWith(
        '[SESSION_EVENTS] Failed to parse history events:',
        expect.any(Error)
      );
    });
  });

  describe('event filtering', () => {
    it('should filter events by selected agent', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // Add events from different threads
      const userMessage = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId, // User messages should always show
          timestamp: '2025-08-01T12:00:00.000Z',
          data: { content: 'User message' },
        },
      };

      const agentMessage = {
        id: 'event-2',
        timestamp: '2025-08-01T12:01:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'AGENT_MESSAGE',
          threadId: agentId, // From selected agent
          timestamp: '2025-08-01T12:01:00.000Z',
          data: { content: 'Agent message' },
        },
      };

      const otherAgentMessage = {
        id: 'event-3',
        timestamp: '2025-08-01T12:02:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'AGENT_MESSAGE',
          threadId: asThreadId('lace_20250801_test123.2'), // Different agent
          timestamp: '2025-08-01T12:02:00.000Z',
          data: { content: 'Other agent message' },
        },
      };

      act(() => {
        onEventHandler(userMessage);
        onEventHandler(agentMessage);
        onEventHandler(otherAgentMessage);
      });

      expect(result.current.allEvents).toHaveLength(3);
      expect(result.current.filteredEvents).toHaveLength(2); // User + selected agent only
      expect(result.current.filteredEvents[0].data).toEqual({ content: 'User message' });
      expect(result.current.filteredEvents[1].data).toEqual({ content: 'Agent message' });
    });

    it('should return empty filtered events when no agent selected', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, null));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      const userMessage = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'USER_MESSAGE',
          threadId: sessionId,
          timestamp: '2025-08-01T12:00:00.000Z',
          data: { content: 'User message' },
        },
      };

      act(() => {
        onEventHandler(userMessage);
      });

      expect(result.current.allEvents).toHaveLength(1);
      expect(result.current.filteredEvents).toHaveLength(0);
    });
  });

  describe('pending approvals', () => {
    it('should load pending approvals on agent selection', async () => {
      const pendingApprovals = [
        {
          toolCallId: 'req-123',
          toolCall: { name: 'bash', arguments: { command: 'ls' } },
          requestedAt: '2025-08-01T12:00:00.000Z',
          requestData: {
            requestId: 'req-123',
            toolName: 'bash',
            input: { command: 'ls' },
            isReadOnly: false,
            riskLevel: 'moderate',
          },
        },
      ];

      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/approvals/pending')) {
          return Promise.resolve({
            json: () => Promise.resolve({ pendingApprovals }),
          });
        }
        return Promise.resolve({ json: () => Promise.resolve({}) });
      });

      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current.pendingApprovals).toHaveLength(1);
      expect(result.current.pendingApprovals[0].toolCallId).toBe('req-123');
      expect(result.current.pendingApprovals[0].requestedAt).toBeInstanceOf(Date);
    });

    it('should clear approvals when clearApprovalRequest is called', () => {
      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));
      const onEventHandler = vi.mocked(useEventStream).mock.calls[0][0].onEvent;

      // Add a pending approval
      const approvalEvent = {
        id: 'event-1',
        timestamp: '2025-08-01T12:00:00.000Z',
        eventType: 'session',
        scope: { sessionId },
        data: {
          type: 'TOOL_APPROVAL_REQUEST',
          threadId: agentId,
          timestamp: '2025-08-01T12:00:00.000Z',
          data: {
            requestId: 'req-123',
            toolName: 'bash',
            input: { command: 'ls' },
            isReadOnly: false,
            riskLevel: 'moderate',
          },
        },
      };

      act(() => {
        onEventHandler(approvalEvent);
      });

      expect(result.current.pendingApprovals).toHaveLength(1);

      act(() => {
        result.current.clearApprovalRequest();
      });

      expect(result.current.pendingApprovals).toHaveLength(0);
    });
  });

  describe('connection state', () => {
    it('should reflect connection state from useEventStream', () => {
      vi.mocked(useEventStream).mockReturnValue({
        connection: { connected: false },
      });

      const { result } = renderHook(() => useSessionEvents(sessionId, agentId));

      expect(result.current.connected).toBe(false);
    });
  });
});
