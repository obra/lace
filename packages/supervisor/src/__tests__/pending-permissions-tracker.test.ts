import { describe, expect, it } from 'vitest';
import { asSessionId } from '@lace/ent-protocol';
import { PendingPermissionsTracker } from '../pending-permissions-tracker';
import type { SupervisorPermissionRequest, SupervisorSessionUpdate } from '../http/types';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${ms}ms: ${label}`)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

describe('PendingPermissionsTracker', () => {
  it('clears and resolves pending permission when tool use is cancelled', async () => {
    const tracker = new PendingPermissionsTracker({ timeoutMs: 60_000 });
    const workspaceSessionId = 'ws_1';
    const agentSessionId = asSessionId('sess_00000000-0000-0000-0000-000000000001');
    const toolCallId = 'tool_1';

    const awaitingPermissionUpdate: SupervisorSessionUpdate = {
      sessionId: agentSessionId,
      streamSeq: 1,
      type: 'tool_use',
      toolCallId,
      name: 'bash',
      kind: 'execute',
      input: { command: 'echo hi' },
      status: 'awaiting_permission',
    };
    tracker.onSessionUpdate(workspaceSessionId, awaitingPermissionUpdate);

    const request: SupervisorPermissionRequest = {
      sessionId: agentSessionId,
      turnId: 'turn_1',
      turnSeq: 1,
      requestedAt: '2026-05-20T00:00:00.000Z',
      toolCallId,
      tool: 'bash',
      kind: 'execute',
      resource: 'echo hi',
      options: [
        { optionId: 'allow', label: 'Allow' },
        { optionId: 'deny', label: 'Deny' },
      ],
    };
    const { waitForDecision } = tracker.startPermissionRequest(workspaceSessionId, request);

    expect(tracker.listPendingPermissions(workspaceSessionId)).toHaveLength(1);

    const cancelledUpdate: SupervisorSessionUpdate = {
      ...awaitingPermissionUpdate,
      streamSeq: 2,
      status: 'cancelled',
      result: {
        outcome: 'cancelled',
        content: [{ type: 'text', text: 'cancelled' }],
      },
    };
    tracker.onSessionUpdate(workspaceSessionId, cancelledUpdate);

    await expect(
      withTimeout(waitForDecision, 50, 'cancelled permission decision')
    ).resolves.toEqual({ decision: 'deny' });
    expect(tracker.listPendingPermissions(workspaceSessionId)).toEqual([]);
  });
});
