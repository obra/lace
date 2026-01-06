// ABOUTME: Test suite for unified app event types and type guards
import { describe, it, expect } from 'vitest';
import { asSessionId } from '@lace/ent-protocol';
import {
  isProtocolEvent,
  isPermissionRequestEvent,
  isWebEvent,
  getEventType,
  getAgentSessionId,
  getWorkspaceSessionId,
  type AppEvent,
} from '@lace/web/types/app-events';
import type { ProtocolEvent, PermissionRequestEvent } from '@lace/web/types/protocol-events';
import type { WebEvent } from '@lace/web/types/web-events';

describe('App Event Type Guards', () => {
  it('should identify protocol events', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const event: ProtocolEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId,
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: sessionId,
    };

    expect(isProtocolEvent(event)).toBe(true);
    expect(isPermissionRequestEvent(event)).toBe(false);
    expect(isWebEvent(event)).toBe(false);
  });

  it('should identify permission request events', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const event: PermissionRequestEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      request: {
        sessionId,
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'test',
        options: [],
        requestedAt: new Date().toISOString(),
      },
      workspaceSessionId: 'ws_123',
    };

    expect(isProtocolEvent(event)).toBe(false);
    expect(isPermissionRequestEvent(event)).toBe(true);
    expect(isWebEvent(event)).toBe(false);
  });

  it('should identify web events', () => {
    const event: WebEvent = {
      id: 'evt_789',
      timestamp: new Date(),
      type: 'USER_MESSAGE',
      data: 'test',
      workspaceSessionId: 'ws_123',
    };

    expect(isProtocolEvent(event)).toBe(false);
    expect(isPermissionRequestEvent(event)).toBe(false);
    expect(isWebEvent(event)).toBe(true);
  });

  it('should narrow types in conditional blocks', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const protocolEvent: AppEvent = {
      id: 'evt_123',
      timestamp: new Date(),
      update: {
        sessionId,
        streamSeq: 1,
        type: 'text_delta',
        text: 'test',
      },
      workspaceSessionId: 'ws_123',
      agentSessionId: sessionId,
    };

    if (isProtocolEvent(protocolEvent)) {
      // TypeScript should narrow to ProtocolEvent
      expect(protocolEvent.update.type).toBe('text_delta');
    }
  });

  it('should get event type string', () => {
    const sessionId1 = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const protocolEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: { sessionId: sessionId1, streamSeq: 1, type: 'text_delta', text: 'hi' },
      workspaceSessionId: 'ws_1',
      agentSessionId: sessionId1,
    };

    const webEvent: WebEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      type: 'USER_MESSAGE',
      data: 'hello',
      workspaceSessionId: 'ws_1',
    };

    expect(getEventType(protocolEvent)).toBe('protocol:text_delta');
    expect(getEventType(webEvent)).toBe('web:USER_MESSAGE');
  });

  it('should get agent session ID from any event type', () => {
    const sessionIdProto = asSessionId('sess_12345678-1234-1234-1234-111111111111');
    const protocolEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: { sessionId: sessionIdProto, streamSeq: 1, type: 'text_delta', text: 'hi' },
      workspaceSessionId: 'ws_1',
      agentSessionId: sessionIdProto,
    };

    const webEvent: WebEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      type: 'USER_MESSAGE',
      data: 'hello',
      workspaceSessionId: 'ws_1',
      agentSessionId: 'sess_web',
    };

    expect(getAgentSessionId(protocolEvent)).toBe(sessionIdProto);
    expect(getAgentSessionId(webEvent)).toBe('sess_web');
  });

  it('should get workspace session ID from any event type', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const protocolEvent: ProtocolEvent = {
      id: 'evt_1',
      timestamp: new Date(),
      update: { sessionId, streamSeq: 1, type: 'text_delta', text: 'hi' },
      workspaceSessionId: 'ws_proto',
      agentSessionId: sessionId,
    };

    const webEvent: WebEvent = {
      id: 'evt_2',
      timestamp: new Date(),
      type: 'USER_MESSAGE',
      data: 'hello',
      workspaceSessionId: 'ws_web',
    };

    expect(getWorkspaceSessionId(protocolEvent)).toBe('ws_proto');
    expect(getWorkspaceSessionId(webEvent)).toBe('ws_web');
  });

  it('should handle permission request events in helper functions', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const permissionEvent: PermissionRequestEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      request: {
        sessionId,
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'test',
        options: [],
        requestedAt: new Date().toISOString(),
      },
      workspaceSessionId: 'ws_123',
    };

    expect(getEventType(permissionEvent)).toBe('protocol:permission_request');
    expect(getAgentSessionId(permissionEvent)).toBe(sessionId);
    expect(getWorkspaceSessionId(permissionEvent)).toBe('ws_123');
  });
});
