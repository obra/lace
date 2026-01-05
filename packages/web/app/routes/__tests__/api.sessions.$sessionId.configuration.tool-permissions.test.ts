// ABOUTME: Tests for unsupported tool permission settings in supervisor-backed session configuration
// ABOUTME: Tool policies are not configured via web session configuration in PR9

import { describe, it, expect, afterEach } from 'vitest';
import {
  loader as GET,
  action as PUT,
} from '@lace/web/app/routes/api.sessions.$sessionId.configuration';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

describe('Session Configuration API - Tool Permissions (unsupported)', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET does not include tool policy structures', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(
      `http://localhost/api/sessions/${created.workspaceSessionId}/configuration`
    );
    const response = await GET(
      createLoaderArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<{ configuration: Record<string, unknown> }>(response);

    expect(response.status).toBe(200);
    expect(data.configuration.availableTools).toEqual([]);
    expect('tools' in data.configuration).toBe(false);
    expect('toolPolicies' in data.configuration).toBe(false);
  });

  it('PUT rejects toolPolicies updates', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(
      `http://localhost/api/sessions/${created.workspaceSessionId}/configuration`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolPolicies: { bash: 'deny' } }),
      }
    );

    const response = await PUT(
      createActionArgs(request, { sessionId: created.workspaceSessionId })
    );
    const data = await parseResponse<{ error: string }>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid request data');
  });
});
