// ABOUTME: Tests for pending approvals API route (supervisor-backed)
// ABOUTME: Verifies filtering and error handling for agent-session approvals

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loader as GET } from '@lace/web/app/routes/api.threads.$threadId.approvals.pending';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';

vi.mock('server-only', () => ({}));

const mockGetSupervisor = vi.fn();
const mockListPendingPermissions = vi.fn();

vi.mock('@lace/web/lib/server/supervisor-service', async () => {
  const actual = await vi.importActual<typeof import('@lace/web/lib/server/supervisor-service')>(
    '@lace/web/lib/server/supervisor-service'
  );
  return {
    ...actual,
    getSupervisor: () => mockGetSupervisor(),
    listPendingPermissions: (...args: unknown[]) => mockListPendingPermissions(...args),
  };
});

describe('GET /api/threads/[threadId]/approvals/pending', () => {
  beforeEach(() => {
    mockGetSupervisor.mockReset();
    mockListPendingPermissions.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return pending approvals for the requested agent session', async () => {
    const threadId = 'agent_1';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }, { sessionId: 'agent_2' }] },
      ],
    });

    mockListPendingPermissions.mockReturnValue([
      {
        toolCallId: 'call_a',
        agentSessionId: threadId,
        toolCall: { name: 'file_write', arguments: { path: 'a.txt' } },
        request: { tool: 'file_write' },
        requestedAt: '2025-01-24T12:00:00.000Z',
      },
      {
        toolCallId: 'call_b',
        agentSessionId: 'agent_2',
        toolCall: { name: 'file_write', arguments: { path: 'b.txt' } },
        request: { tool: 'file_write' },
        requestedAt: '2025-01-24T12:01:00.000Z',
      },
    ]);

    const request = new Request(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const response = await GET(createLoaderArgs(request, { threadId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<unknown[]>(response);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
  });

  it('should return empty array when no pending approvals exist for the agent', async () => {
    const threadId = 'agent_1';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }] },
      ],
    });

    mockListPendingPermissions.mockReturnValue([]);

    const request = new Request(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const response = await GET(createLoaderArgs(request, { threadId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<unknown[]>(response);
    expect(data).toEqual([]);
  });

  it('should return 404 if agent session is not found in any workspace session', async () => {
    const threadId = 'agent_1';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [],
    });

    const request = new Request(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const response = await GET(createLoaderArgs(request, { threadId }));

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code?: string }>(response);
    expect(data).toEqual({ error: 'Agent not found', code: 'RESOURCE_NOT_FOUND' });
  });

  it('should return 400 for invalid thread ID', async () => {
    const threadId = 'bad..id';
    const request = new Request(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const response = await GET(createLoaderArgs(request, { threadId }));
    expect(response.status).toBe(400);
  });

  it('should return 500 when pending approval query fails', async () => {
    const threadId = 'agent_1';

    mockGetSupervisor.mockReturnValue({
      listWorkspaceSessions: () => [
        { workspaceSessionId: 'ws_1', agents: [{ sessionId: threadId }] },
      ],
    });

    mockListPendingPermissions.mockImplementation(() => {
      throw new Error('boom');
    });

    const request = new Request(`http://localhost:3000/api/threads/${threadId}/approvals/pending`);
    const response = await GET(createLoaderArgs(request, { threadId }));

    expect(response.status).toBe(500);
  });
});
