// ABOUTME: Integration tests for supervisor-backed session detail API endpoint
// ABOUTME: Sessions are workspace sessions (ws_<uuid>) stored in supervisor workspace session store

import { describe, it, expect, afterEach } from 'vitest';
import { loader as GET, action as PATCH } from '@lace/web/app/routes/api.sessions.$sessionId';
import { parseResponse } from '@lace/web/lib/serialization';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

describe('Session Detail API Route', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET /api/sessions/:sessionId returns session details with agents', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, { name: 'Test Session' });

    const spawned = await supervisor.createAgentSession(created.workspaceSessionId);
    await supervisor.upsertAgentSessionMeta(created.workspaceSessionId, {
      sessionId: spawned.sessionId,
      name: 'Agent-1',
    });

    const request = new Request(`http://localhost/api/sessions/${created.workspaceSessionId}`);
    const response = await GET(
      createLoaderArgs(request, { sessionId: created.workspaceSessionId })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<{
      id: string;
      name: string;
      createdAt: Date;
      agents: Array<{ threadId: string; name: string }>;
    }>(response);

    expect(data.id).toBe(created.workspaceSessionId);
    expect(data.name).toBe('Test Session');
    expect(data.createdAt).toBeInstanceOf(Date);
    expect(data.agents.map((a) => a.threadId)).toEqual(
      expect.arrayContaining([created.sessionId, spawned.sessionId])
    );
  });

  it('GET /api/sessions/:sessionId returns 400 for invalid session id', async () => {
    const request = new Request('http://localhost/api/sessions/invalid-session');
    const response = await GET(createLoaderArgs(request, { sessionId: 'invalid-session' }));

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('VALIDATION_FAILED');
  });

  it('GET /api/sessions/:sessionId returns 404 for unknown workspace session id', async () => {
    const id = 'ws_00000000-0000-0000-0000-000000000000';
    const request = new Request(`http://localhost/api/sessions/${id}`);
    const response = await GET(createLoaderArgs(request, { sessionId: id }));

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('PATCH /api/sessions/:sessionId updates session name', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    await supervisor.updateWorkspaceSession(created.workspaceSessionId, { name: 'Before' });

    const request = new Request(`http://localhost/api/sessions/${created.workspaceSessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'After' }),
    });

    const response = await PATCH(
      createActionArgs(request, { sessionId: created.workspaceSessionId })
    );

    expect(response.status).toBe(200);
    const data = await parseResponse<{ id: string; name: string }>(response);
    expect(data.id).toBe(created.workspaceSessionId);
    expect(data.name).toBe('After');

    const reloaded = await supervisor.getWorkspaceSession(created.workspaceSessionId);
    expect(reloaded?.name).toBe('After');
  });
});
