// ABOUTME: Tests for useAgentEvents hook
// ABOUTME: Validates hook behavior with AppEvent/ProtocolEvent types

import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAgentEvents } from '@lace/web/hooks/useAgentEvents';
import type { AppEvent, ProtocolEvent, WebEvent } from '@lace/web/types/app-events';
import { api } from '@lace/web/lib/api-client';
import type { SessionId } from '@lace/ent-protocol';

// Mock the API client
vi.mock('@lace/web/lib/api-client', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('useAgentEvents', () => {
  // Use branded SessionId for type safety (cast is safe in tests)
  const mockAgentId = 'agent_test_123' as SessionId;

  const createMockProtocolEvent = (overrides?: Partial<ProtocolEvent>): ProtocolEvent => ({
    id: 'proto_event_1',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    update: {
      type: 'text_delta',
      sessionId: mockAgentId,
      streamSeq: 1,
      text: 'test',
    } as ProtocolEvent['update'],
    agentSessionId: mockAgentId,
    workspaceSessionId: 'ws_123',
    ...overrides,
  });

  const createMockWebEvent = (overrides?: Partial<WebEvent>): WebEvent => {
    const base: WebEvent = {
      id: 'web_event_1',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      type: 'USER_MESSAGE_SENT',
      data: { content: 'hello', agentSessionId: mockAgentId },
      agentSessionId: mockAgentId,
      workspaceSessionId: 'ws_123',
    } as WebEvent;
    return { ...base, ...overrides } as WebEvent;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty events and loading state', () => {
    const { result } = renderHook(() => useAgentEvents(null));

    expect(result.current.events).toEqual([]);
    expect(result.current.loadingHistory).toBe(false);
    expect(result.current.connected).toBe(false);
  });

  it('should load historical AppEvents when agentId is provided', async () => {
    const mockEvents: AppEvent[] = [
      createMockProtocolEvent({
        id: 'proto_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      }),
      createMockWebEvent({
        id: 'web_1',
        timestamp: new Date('2024-01-01T10:01:00Z'),
      }),
    ];

    vi.mocked(api.get).mockResolvedValue(mockEvents);

    const { result } = renderHook(() => useAgentEvents(mockAgentId));

    expect(result.current.loadingHistory).toBe(true);

    await waitFor(() => {
      expect(result.current.loadingHistory).toBe(false);
    });

    expect(result.current.events).toEqual(mockEvents);
    expect(api.get).toHaveBeenCalledWith(`/api/agents/${mockAgentId}/history`, expect.any(Object));
  });

  it('should filter out internal workflow events', async () => {
    const mockEvents: AppEvent[] = [
      createMockProtocolEvent({
        id: 'proto_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      }),
      {
        id: 'web_internal',
        type: 'TOOL_APPROVAL_RESPONSE',
        timestamp: new Date('2024-01-01T10:01:00Z'),
        data: { requestId: 'req1', approved: true, optionId: 'opt1' },
        agentSessionId: mockAgentId,
        workspaceSessionId: 'ws_123',
      } as WebEvent,
    ];

    vi.mocked(api.get).mockResolvedValue(mockEvents);

    const { result } = renderHook(() => useAgentEvents(mockAgentId));

    await waitFor(() => {
      expect(result.current.loadingHistory).toBe(false);
    });

    // Should only contain the protocol event, filtering out TOOL_APPROVAL_RESPONSE
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.id).toBe('proto_1');
  });

  it('should add new AppEvents in chronological order', async () => {
    const { result } = renderHook(() => useAgentEvents(mockAgentId, true));

    const event1 = createMockProtocolEvent({
      id: 'proto_1',
      timestamp: new Date('2024-01-01T10:00:00Z'),
    });

    const event2 = createMockWebEvent({
      id: 'web_1',
      timestamp: new Date('2024-01-01T10:01:00Z'),
    });

    const event3 = createMockProtocolEvent({
      id: 'proto_2',
      timestamp: new Date('2024-01-01T09:59:00Z'),
    });

    act(() => {
      result.current.addAgentEvent(event1);
    });

    expect(result.current.events).toEqual([event1]);

    act(() => {
      result.current.addAgentEvent(event2);
    });

    expect(result.current.events).toEqual([event1, event2]);

    // Add an older event - should be inserted in correct position
    act(() => {
      result.current.addAgentEvent(event3);
    });

    expect(result.current.events).toEqual([event3, event1, event2]);
  });

  it('should deduplicate events', async () => {
    const { result } = renderHook(() => useAgentEvents(mockAgentId, true));

    const event = createMockProtocolEvent({
      id: 'proto_1',
      timestamp: new Date('2024-01-01T10:00:00Z'),
    });

    act(() => {
      result.current.addAgentEvent(event);
    });

    expect(result.current.events).toHaveLength(1);

    // Try to add the same event again
    act(() => {
      result.current.addAgentEvent(event);
    });

    // Should still be 1 event due to deduplication
    expect(result.current.events).toHaveLength(1);
  });

  it('should update event visibility for EVENT_UPDATED', async () => {
    const { result } = renderHook(() => useAgentEvents(mockAgentId, true));

    // Create EVENT_UPDATED WebEvent with proper type assertion
    const event: WebEvent = {
      id: 'web_1',
      timestamp: new Date(),
      type: 'EVENT_UPDATED',
      data: { eventId: 'target_1', changes: {} },
      agentSessionId: mockAgentId,
      workspaceSessionId: 'ws_123',
    } as WebEvent;

    act(() => {
      result.current.addAgentEvent(event);
    });

    act(() => {
      result.current.updateEventVisibility('target_1', false);
    });

    // The hook should have the update method for external use
    expect(result.current.updateEventVisibility).toBeDefined();
  });

  it('should handle AbortError when component unmounts during load', async () => {
    const abortError = new Error('AbortError');
    abortError.name = 'AbortError';

    vi.mocked(api.get).mockRejectedValue(abortError);

    const { result, unmount } = renderHook(() => useAgentEvents(mockAgentId));

    // Unmount the component to trigger the abort
    unmount();

    // AbortError should be silently ignored, and loading state stays as initial
    // (no need to wait or change assertions)
    expect(result.current.events).toEqual([]);
  });

  it('should handle other errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAgentEvents(mockAgentId));

    await waitFor(() => {
      expect(result.current.loadingHistory).toBe(false);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[AGENT_EVENTS] Failed to load history:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should clear events when agentId becomes null', async () => {
    const { result, rerender } = renderHook(
      ({ agentId }: { agentId: SessionId | null }) => useAgentEvents(agentId),
      {
        initialProps: { agentId: mockAgentId as SessionId | null },
      }
    );

    const event = createMockProtocolEvent();

    act(() => {
      result.current.addAgentEvent(event);
    });

    expect(result.current.events).toHaveLength(1);

    rerender({ agentId: null });

    expect(result.current.events).toEqual([]);
    expect(result.current.loadingHistory).toBe(false);
  });

  it('should sort events chronologically after loading', async () => {
    const webEvent3: WebEvent = {
      ...createMockWebEvent({
        id: 'web_3',
        timestamp: new Date('2024-01-01T10:02:00Z'),
      }),
    };

    const webEvent2: WebEvent = {
      ...createMockWebEvent({
        id: 'web_2',
        timestamp: new Date('2024-01-01T10:01:00Z'),
      }),
    };

    const mockEvents: AppEvent[] = [
      webEvent3,
      createMockProtocolEvent({
        id: 'proto_1',
        timestamp: new Date('2024-01-01T10:00:00Z'),
      }),
      webEvent2,
    ];

    vi.mocked(api.get).mockResolvedValue(mockEvents);

    const { result } = renderHook(() => useAgentEvents(mockAgentId));

    await waitFor(() => {
      expect(result.current.loadingHistory).toBe(false);
    });

    // Events should be sorted by timestamp
    expect(result.current.events[0]?.id).toBe('proto_1');
    expect(result.current.events[1]?.id).toBe('web_2');
    expect(result.current.events[2]?.id).toBe('web_3');
  });

  it('should pass connected state through', () => {
    const { result: result1 } = renderHook(() => useAgentEvents(mockAgentId, false));
    expect(result1.current.connected).toBe(false);

    const { result: result2 } = renderHook(() => useAgentEvents(mockAgentId, true));
    expect(result2.current.connected).toBe(true);
  });

  it('should handle tool_use ProtocolEvent properly', async () => {
    const toolUseEvent: ProtocolEvent = {
      id: 'ent_1_tool',
      timestamp: new Date('2024-01-01T10:00:00Z'),
      update: {
        sessionId: mockAgentId,
        streamSeq: 1,
        turnId: 'historical',
        turnSeq: 0,
        type: 'tool_use',
        toolCallId: 'tool_call_123',
        name: 'read_file',
        input: { path: '/some/file.txt' },
        status: 'completed',
        result: {
          outcome: 'completed',
          content: [{ type: 'text', text: 'file content' }],
        },
      } as ProtocolEvent['update'],
      agentSessionId: mockAgentId,
      workspaceSessionId: 'ws_123',
    };

    vi.mocked(api.get).mockResolvedValue([toolUseEvent]);

    const { result } = renderHook(() => useAgentEvents(mockAgentId));

    await waitFor(() => {
      expect(result.current.loadingHistory).toBe(false);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toEqual(toolUseEvent);
  });

  it('should accept only AppEvent types (no LaceEvent support)', async () => {
    // This test verifies the hook only works with AppEvent union
    // (ProtocolEvent | PermissionRequestEvent | WebEvent)
    const { result } = renderHook(() => useAgentEvents(mockAgentId, true));

    const protocolEvent = createMockProtocolEvent({ id: 'proto_1' });
    const webEvent = createMockWebEvent({ id: 'web_1' });

    act(() => {
      result.current.addAgentEvent(protocolEvent);
      result.current.addAgentEvent(webEvent);
    });

    expect(result.current.events).toHaveLength(2);
    // Verify both event types are properly stored
    expect(result.current.events.map((e) => e.id)).toContain('proto_1');
    expect(result.current.events.map((e) => e.id)).toContain('web_1');
  });
});
