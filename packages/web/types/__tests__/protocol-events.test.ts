// ABOUTME: Tests for protocol event types extracted from ent-protocol schemas.
// These tests verify that we correctly extract and wrap protocol event types.
import { describe, it, expect } from 'vitest';
import { asSessionId } from '@lace/ent-protocol';
import type {
  ProtocolEvent,
  TextDeltaUpdate,
  PermissionRequestEvent,
} from '@lace/web/types/protocol-events';

describe('Protocol Event Types', () => {
  it('should extract TextDeltaUpdate type correctly', () => {
    const update: TextDeltaUpdate = {
      sessionId: asSessionId('sess_12345678-1234-1234-1234-123456789012'),
      streamSeq: 1,
      turnId: 'turn_1',
      turnSeq: 0,
      type: 'text_delta',
      text: 'Hello',
    };

    expect(update.type).toBe('text_delta');
    expect(update.text).toBe('Hello');
  });

  it('should create ProtocolEvent wrapper', () => {
    const sessionId = asSessionId('sess_12345678-1234-1234-1234-123456789012');
    const protocolEvent: ProtocolEvent = {
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

    expect(protocolEvent.id).toBe('evt_123');
    expect(protocolEvent.update.type).toBe('text_delta');
  });

  it('should create PermissionRequestEvent wrapper', () => {
    const permEvent: PermissionRequestEvent = {
      id: 'evt_456',
      timestamp: new Date(),
      request: {
        sessionId: asSessionId('sess_12345678-1234-1234-1234-123456789012'),
        turnId: 'turn_1',
        turnSeq: 0,
        toolCallId: 'call_1',
        tool: 'bash',
        resource: 'rm -rf /',
        options: [
          { optionId: 'allow', label: 'Allow' },
          { optionId: 'deny', label: 'Deny' },
        ],
        requestedAt: new Date().toISOString(),
      },
      workspaceSessionId: 'ws_123',
    };

    expect(permEvent.request.tool).toBe('bash');
    expect(permEvent.request.options).toHaveLength(2);
  });
});
