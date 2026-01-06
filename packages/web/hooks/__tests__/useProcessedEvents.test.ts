// ABOUTME: Tests for useProcessedEvents hook with AppEvent support

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProcessedEvents } from '@lace/web/hooks/useProcessedEvents';
import type { AppEvent, ProtocolEvent, WebEvent } from '@lace/web/types/app-events';
import type { SessionId } from '@lace/ent-protocol';

describe('useProcessedEvents', () => {
  // Use branded SessionId for type safety (cast is safe in tests)
  const mockSessionId = 'sess_123' as SessionId;
  const mockAgentSessionId = 'agent_123' as SessionId;

  describe('WebEvent handling', () => {
    it('should convert USER_MESSAGE events to InternalTimelineEvent format', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: 'Hello',
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as WebEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('USER_MESSAGE');
    });
  });

  describe('Protocol Event handling', () => {
    it('should process text_delta protocol events into PROTOCOL_TEXT', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockSessionId,
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello world',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_TEXT');
    });

    it('should aggregate multiple text_delta events by agent session', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockSessionId,
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello ',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          update: {
            sessionId: mockSessionId,
            streamSeq: 2,
            type: 'text_delta',
            text: 'world',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_TEXT');
      expect((result.current[0].data as { content: string }).content).toBe('Hello world');
    });

    it('should process tool_use protocol events into PROTOCOL_TOOL', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
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
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_TOOL');
      expect((result.current[0].data as { name: string }).name).toBe('bash');
    });

    it('should aggregate tool_use pending and completed events', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
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
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          update: {
            sessionId: mockSessionId,
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
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_TOOL');
      expect((result.current[0].data as { status: string }).status).toBe('completed');
    });

    it('should process error protocol events into PROTOCOL_ERROR', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
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
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_ERROR');
    });

    it('should process thinking protocol events into PROTOCOL_THINKING', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: mockSessionId,
            streamSeq: 1,
            type: 'thinking',
            text: 'Let me think about this...',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: mockAgentSessionId,
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_THINKING');
    });
  });

  describe('Mixed WebEvent and ProtocolEvent handling', () => {
    it('should process both WebEvent and ProtocolEvent in the same stream', () => {
      const webEvent: WebEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: 'Hello',
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      const protocolEvent: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:01Z'),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello back!',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      const events: AppEvent[] = [webEvent, protocolEvent];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(2);
      expect(result.current[0].type).toBe('USER_MESSAGE');
      expect(result.current[1].type).toBe('PROTOCOL_TEXT');
    });

    it('should sort events by timestamp', () => {
      const laterEvent: WebEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:02Z'),
        data: 'Second',
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      const earlierEvent: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        update: {
          sessionId: mockSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'First',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: mockAgentSessionId,
      };

      // Pass later event first to test sorting
      const events: AppEvent[] = [laterEvent, earlierEvent];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(2);
      // Should be sorted chronologically
      expect(result.current[0].type).toBe('PROTOCOL_TEXT');
      expect(result.current[1].type).toBe('USER_MESSAGE');
    });
  });
});
