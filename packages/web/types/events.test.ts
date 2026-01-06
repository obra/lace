// ABOUTME: Test AppEvent type definitions and type guards

import { describe, it, expect } from 'vitest';
import { asThreadId } from '@lace/web/types/core';
import type { AppEvent, ProtocolEvent, WebEvent } from '@lace/web/types/app-events';
import { isProtocolEvent, isWebEvent, isPermissionRequestEvent } from '@lace/web/types/app-events';
import { testSessionId } from '@lace/web/test-utils/test-ids';

describe('AppEvent Types', () => {
  const mockWorkspaceSessionId = 'ws_123';
  const mockAgentSessionId = asThreadId(testSessionId(1));

  describe('ProtocolEvent', () => {
    it('should create valid ProtocolEvent', () => {
      const event: ProtocolEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockAgentSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'Hello world',
        },
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      expect(event.update.type).toBe('text_delta');
      expect(isProtocolEvent(event)).toBe(true);
      expect(isWebEvent(event)).toBe(false);
    });

    it('should create tool_use ProtocolEvent', () => {
      const event: ProtocolEvent = {
        id: 'evt_2',
        timestamp: new Date(),
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
      };

      expect(event.update.type).toBe('tool_use');
      expect(isProtocolEvent(event)).toBe(true);
    });
  });

  describe('WebEvent', () => {
    it('should create valid WebEvent', () => {
      const event: WebEvent = {
        id: 'evt_3',
        timestamp: new Date(),
        type: 'USER_MESSAGE',
        data: 'Hello',
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      expect(event.type).toBe('USER_MESSAGE');
      expect(isWebEvent(event)).toBe(true);
      expect(isProtocolEvent(event)).toBe(false);
    });

    it('should create AGENT_STATE_CHANGE WebEvent', () => {
      const event: WebEvent = {
        id: 'evt_4',
        timestamp: new Date(),
        type: 'AGENT_STATE_CHANGE',
        data: {
          agentSessionId: mockAgentSessionId,
          previousState: 'idle',
          newState: 'thinking',
        },
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      };

      expect(event.type).toBe('AGENT_STATE_CHANGE');
      expect(isWebEvent(event)).toBe(true);
    });
  });

  describe('Type guards', () => {
    it('should correctly distinguish event types', () => {
      const protocolEvent: AppEvent = {
        id: 'evt_1',
        timestamp: new Date(),
        update: {
          sessionId: mockAgentSessionId,
          streamSeq: 1,
          type: 'text_delta',
          text: 'test',
        },
        workspaceSessionId: mockWorkspaceSessionId,
        agentSessionId: mockAgentSessionId,
      } as ProtocolEvent;

      const webEvent: AppEvent = {
        id: 'evt_2',
        timestamp: new Date(),
        type: 'LOCAL_SYSTEM_MESSAGE',
        data: { content: 'System message' },
        workspaceSessionId: mockWorkspaceSessionId,
      } as WebEvent;

      expect(isProtocolEvent(protocolEvent)).toBe(true);
      expect(isWebEvent(protocolEvent)).toBe(false);
      expect(isPermissionRequestEvent(protocolEvent)).toBe(false);

      expect(isWebEvent(webEvent)).toBe(true);
      expect(isProtocolEvent(webEvent)).toBe(false);
      expect(isPermissionRequestEvent(webEvent)).toBe(false);
    });
  });
});
