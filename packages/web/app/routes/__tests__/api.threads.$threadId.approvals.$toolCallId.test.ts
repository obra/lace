// ABOUTME: Tests for approval decision API route (supervisor-backed)
// ABOUTME: Verifies decision mapping and resolution of pending permissions

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { action as POST } from '@lace/web/app/routes/api.threads.$threadId.approvals.$toolCallId';
import { parseResponse } from '@lace/web/lib/serialization';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';

vi.mock('server-only', () => ({}));

const mockGetSupervisor = vi.fn();
const mockListPendingPermissions = vi.fn();
const mockResolvePendingPermission = vi.fn();

vi.mock('@lace/web/lib/server/supervisor-service', async () => {
  const actual = await vi.importActual<typeof import('@lace/web/lib/server/supervisor-service')>(
    '@lace/web/lib/server/supervisor-service'
  );
  return {
    ...actual,
    getSupervisor: () => mockGetSupervisor(),
    listPendingPermissions: (...args: unknown[]) => mockListPendingPermissions(...args),
    resolvePendingPermission: (...args: unknown[]) => mockResolvePendingPermission(...args),
  };
});

describe('POST /api/threads/[threadId]/approvals/[toolCallId]', () => {
  beforeEach(() => {
    mockGetSupervisor.mockReset();
    mockListPendingPermissions.mockReset();
    mockResolvePendingPermission.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve an approval (allow_once -> allow)', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }] },
      ],
    });

    mockListPendingPermissions.mockReturnValue([
      {
        toolCallId,
        agentSessionId: threadId,
        request: { tool: 'bash' },
        requestedAt: new Date().toISOString(),
      },
    ]);

    mockResolvePendingPermission.mockReturnValue(true);

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow_once' }),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(200);
    expect(mockResolvePendingPermission).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_1',
      toolCallId,
      decision: 'allow',
    });
  });

  it('should resolve an approval (deny -> deny)', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }] },
      ],
    });

    mockListPendingPermissions.mockReturnValue([
      {
        toolCallId,
        agentSessionId: threadId,
        request: { tool: 'bash' },
        requestedAt: new Date().toISOString(),
      },
    ]);

    mockResolvePendingPermission.mockReturnValue(true);

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'deny' }),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(200);
    expect(mockResolvePendingPermission).toHaveBeenCalledWith({
      workspaceSessionId: 'ws_1',
      toolCallId,
      decision: 'deny',
    });
  });

  it('should return 404 if agent session not found', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [],
    });

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow_once' }),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({ error: 'Agent not found', code: 'RESOURCE_NOT_FOUND' });
  });

  it('should return 404 if tool call not found', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }] },
      ],
    });

    mockListPendingPermissions.mockReturnValue([]);

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow_once' }),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(404);
  });

  it('should return error for invalid JSON', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(400);
  });

  it('should return error for missing decision', async () => {
    const threadId = 'agent_1';
    const toolCallId = 'call_123';

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(400);
  });

  it('should return 400 for invalid thread ID', async () => {
    const threadId = 'bad..id';
    const toolCallId = 'call_123';

    const request = new Request(
      `http://localhost/api/threads/${threadId}/approvals/${encodeURIComponent(toolCallId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'allow_once' }),
      }
    );

    const response = await POST(createActionArgs(request, { threadId, toolCallId }));
    expect(response.status).toBe(400);
  });
});
