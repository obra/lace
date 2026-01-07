// ABOUTME: Tests for useProcessedEvents hook with AppEvent support

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProcessedEvents } from '@lace/web/hooks/useProcessedEvents';
import type { AppEvent, ProtocolEvent, WebEvent } from '@lace/web/types/app-events';
import type { SessionId } from '@lace/ent-protocol';
import type { ThreadId } from '@lace/web/types/core';

describe('useProcessedEvents', () => {
  // Use branded SessionId for type safety (cast is safe in tests)
  const mockWorkspaceSessionId = 'ws_00000000-0000-0000-0000-000000000000';
  const mockAgentSessionId = 'sess_00000000-0000-0000-0000-000000000000' as SessionId;

  describe('WebEvent handling', () => {
    it('should convert USER_MESSAGE events to InternalTimelineEvent format', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Hello',
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as WebEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('USER_MESSAGE');
    });

    it('should always show system prompt and notifications even when filtering by selected agent', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_prompt',
          type: 'SYSTEM_PROMPT',
          timestamp: new Date('2024-01-01T09:59:00Z'),
          data: 'System prompt content',
          workspaceSessionId: mockWorkspaceSessionId,
          // No agentSessionId on purpose (session-level event)
        } as unknown as WebEvent,
        {
          id: 'evt_notification',
          type: 'SYSTEM_NOTIFICATION',
          timestamp: new Date('2024-01-01T09:59:30Z'),
          data: { message: 'Hello', level: 'info' },
          workspaceSessionId: mockWorkspaceSessionId,
          // No agentSessionId on purpose (session-level event)
        } as unknown as WebEvent,
      ];

      const { result } = renderHook(() =>
        useProcessedEvents(events, mockAgentSessionId as unknown as ThreadId)
      );

      expect(result.current.map((e) => e.type)).toEqual(['SYSTEM_PROMPT', 'SYSTEM_NOTIFICATION']);
    });
  });

  describe('Protocol Event handling', () => {
    it('should process text_delta protocol events into AGENT_MESSAGE', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello world',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('AGENT_MESSAGE');
      expect((result.current[0].data as { content: string }).content).toBe('Hello world');
    });

    it('should aggregate multiple text_delta events by agent session', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello ',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 2,
            type: 'text_delta',
            text: 'world',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('AGENT_MESSAGE');
      expect((result.current[0].data as { content: string }).content).toBe('Hello world');
    });

    it('should process tool_use protocol events into TOOL_AGGREGATED', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            turnId: 'turn_1',
            turnSeq: 0,
            type: 'tool_use',
            toolCallId: 'call_1',
            name: 'bash',
            input: { command: 'ls' },
            status: 'pending',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('TOOL_AGGREGATED');
      expect((result.current[0].data as { toolName: string }).toolName).toBe('bash');
    });

    it('should aggregate tool_use pending and completed events', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            turnId: 'turn_1',
            turnSeq: 0,
            type: 'tool_use',
            toolCallId: 'call_1',
            name: 'bash',
            input: { command: 'ls' },
            status: 'pending',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 2,
            turnId: 'turn_1',
            turnSeq: 1,
            type: 'tool_use',
            toolCallId: 'call_1',
            name: 'bash',
            input: { command: 'ls' },
            status: 'completed',
            result: {
              outcome: 'completed',
              content: [{ type: 'text', text: 'file.txt' }],
              meta: {},
            },
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('TOOL_AGGREGATED');
      expect(
        ((result.current[0].data as { result?: { status?: string } }).result as { status?: string })
          ?.status
      ).toBe('completed');
    });

    it('should process error protocol events into AGENT_ERROR', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            type: 'error',
            code: 'TOOL_ERROR',
            message: 'Tool execution failed',
            phase: 'tool_execution',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('AGENT_ERROR');
    });

    it('should ignore thinking protocol events for timeline display', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockAgentSessionId,
            streamSeq: 1,
            type: 'thinking',
            text: 'Let me think about this...',
          },
          workspaceSessionId: mockWorkspaceSessionId,
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(0);
    });
  });

  describe('Mixed WebEvent and ProtocolEvent handling', () => {
    it('should process both WebEvent and ProtocolEvent in the same stream', () => {
      const webEvent: WebEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Hello',
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      const protocolEvent: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:01Z'),
        update: {
          sessionId: mockAgentSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello back!',
        },
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      const events: AppEvent[] = [webEvent, protocolEvent];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(2);
      expect(result.current[0].type).toBe('USER_MESSAGE');
      expect(result.current[1].type).toBe('AGENT_MESSAGE');
    });

    it('should sort events by timestamp', () => {
      const laterEvent: WebEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:02Z'),
        data: 'Second',
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      const earlierEvent: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: mockAgentSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'First',
        },
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      // Pass later event first to test sorting
      const events: AppEvent[] = [laterEvent, earlierEvent];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(2);
      // Should be sorted chronologically
      expect(result.current[0].type).toBe('AGENT_MESSAGE');
      expect(result.current[1].type).toBe('USER_MESSAGE');
    });
  });
});
