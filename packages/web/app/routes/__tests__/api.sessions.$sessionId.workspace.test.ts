// ABOUTME: Tests for the supervisor-backed workspace information API endpoint
// ABOUTME: Workspace sessions always report local mode for now

import { describe, it, expect, afterEach } from 'vitest';
import { loader } from '@lace/web/app/routes/api.sessions.$sessionId.workspace';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

describe('GET /api/sessions/:sessionId/workspace', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('returns 400 if session ID is missing', async () => {
    const request = new Request('http://localhost:3005/api/sessions/undefined/workspace');
    const response = await loader(createLoaderArgs(request, {}));
    const data = await parseResponse<{ error: string; code: string }>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Session ID required');
    expect(data.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 if session id is invalid', async () => {
    const request = new Request('http://localhost:3005/api/sessions/nonexistent/workspace');
    const response = await loader(createLoaderArgs(request, { sessionId: 'nonexistent' }));
    const data = await parseResponse<{ error: string; code: string }>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid session ID');
    expect(data.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 if workspace session does not exist', async () => {
    const id = 'ws_00000000-0000-0000-0000-000000000000';
    const request = new Request(`http://localhost:3005/api/sessions/${id}/workspace`);
    const response = await loader(createLoaderArgs(request, { sessionId: id }));
    const data = await parseResponse<{ error: string; code: string }>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Session not found');
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('returns workspace info for a workspace session', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(
      `http://localhost:3005/api/sessions/${created.workspaceSessionId}/workspace`
    );
    const response = await loader(
      createLoaderArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<{
      mode: 'container' | 'worktree' | 'local';
      info: { sessionId: string; state: string; projectDir: string; clonePath: string } | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.mode).toBe('local');
    expect(data.info).toBeDefined();
    expect(data.info?.sessionId).toBe(created.workspaceSessionId);
    expect(data.info?.state).toBe('running');
    expect(data.info?.projectDir).toBe(context.tempProjectDir);
    expect(data.info?.clonePath).toBe(context.tempProjectDir);
  });
});
