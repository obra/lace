// ABOUTME: Tests for useProcessedEvents hook with AppEvent support
// ABOUTME: Verifies event processing for timeline display

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProcessedEvents } from '../useProcessedEvents';
import type { LaceEvent } from '@lace/web/types/core';
import type { AppEvent, ProtocolEvent } from '@lace/web/types/app-events';

describe('useProcessedEvents', () => {
  describe('Legacy LaceEvent handling', () => {
    it('should process USER_MESSAGE events', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt_1',
          type: 'USER_MESSAGE',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: { content: 'Hello' },
          context: { sessionId: 'sess_123' },
        },
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('USER_MESSAGE');
    });

    it('should aggregate AGENT_TOKEN events into AGENT_STREAMING', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt_1',
          type: 'AGENT_TOKEN',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          transient: true,
          data: { token: 'Hello ' },
          context: { threadId: 'agent_123' },
        },
        {
          id: 'evt_2',
          type: 'AGENT_TOKEN',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          transient: true,
          data: { token: 'world' },
          context: { threadId: 'agent_123' },
        },
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('AGENT_STREAMING');
      expect((result.current[0].data as { content: string }).content).toBe('Hello world');
    });

    it('should aggregate TOOL_CALL and TOOL_RESULT events', () => {
      const events: LaceEvent[] = [
        {
          id: 'evt_1',
          type: 'TOOL_CALL',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          data: { id: 'call_1', name: 'bash', arguments: { command: 'ls' } },
          context: { threadId: 'agent_123' },
        },
        {
          id: 'evt_2',
          type: 'TOOL_RESULT',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          data: {
            id: 'call_1',
            status: 'completed',
            content: [{ type: 'text', text: 'file.txt' }],
          },
          context: { threadId: 'agent_123' },
        },
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('TOOL_AGGREGATED');
    });
  });

  describe('Protocol Event handling', () => {
    it('should process text_delta protocol events into PROTOCOL_TEXT', () => {
      const events: AppEvent[] = [
        {
          id: 'evt_1',
          timestamp: new Date('2024-01-01T10:00:00Z'),
          update: {
            sessionId: 'agent_123',
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello world',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
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
            sessionId: 'agent_123',
            streamSeq: 1,
            type: 'text_delta',
            text: 'Hello ',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:01Z'),
          update: {
            sessionId: 'agent_123',
            streamSeq: 2,
            type: 'text_delta',
            text: 'world',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
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
        } as ProtocolEvent,
        {
          id: 'evt_2',
          timestamp: new Date('2024-01-01T10:00:02Z'),
          update: {
            sessionId: 'agent_123',
            streamSeq: 2,
            turnId: 'turn_1',
            turnSeq: 1,
            type: 'tool_use',
            toolCallId: 'call_1',
            name: 'bash',
            status: 'completed',
            result: {
              outcome: 'success',
              content: [{ type: 'text', text: 'file.txt' }],
              meta: {},
            },
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
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
            sessionId: 'agent_123',
            streamSeq: 1,
            type: 'error',
            code: 'TOOL_ERROR',
            message: 'Tool execution failed',
            phase: 'execution',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
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
            sessionId: 'agent_123',
            streamSeq: 1,
            type: 'thinking',
            text: 'Let me think about this...',
          },
          workspaceSessionId: 'sess_123',
          agentSessionId: 'agent_123',
        } as ProtocolEvent,
      ];

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(1);
      expect(result.current[0].type).toBe('PROTOCOL_THINKING');
    });
  });

  describe('Mixed event handling', () => {
    it('should process both LaceEvent and AppEvent in the same stream', () => {
      const laceEvent: LaceEvent = {
        id: 'evt_1',
        type: 'USER_MESSAGE',
        timestamp: new Date('2024-01-01T10:00:00Z'),
        data: { content: 'Hello' },
        context: { sessionId: 'sess_123' },
      };

      const protocolEvent: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date('2024-01-01T10:00:01Z'),
        update: {
          sessionId: 'agent_123',
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello back!',
        },
        workspaceSessionId: 'sess_123',
        agentSessionId: 'agent_123',
      };

      const events = [laceEvent, protocolEvent] as Array<LaceEvent | AppEvent>;

      const { result } = renderHook(() => useProcessedEvents(events));

      expect(result.current).toHaveLength(2);
      expect(result.current[0].type).toBe('USER_MESSAGE');
      expect(result.current[1].type).toBe('PROTOCOL_TEXT');
    });
  });
});
