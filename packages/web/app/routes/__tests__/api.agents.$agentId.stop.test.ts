// ABOUTME: Integration tests for the supervisor-backed agent stop endpoint
// ABOUTME: Verifies $/cancel_request is routed through supervisor

import { describe, it, expect, afterEach } from 'vitest';
import { action } from '@lace/web/app/routes/api.agents.$agentId.stop';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { parseResponse } from '@lace/web/lib/serialization';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { testSessionId } from '@lace/web/test-utils/test-ids';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

describe('/api/agents/[agentId]/stop', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('stops an agent session', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(`http://localhost/api/agents/${created.sessionId}/stop`, {
      method: 'POST',
    });

    const response = await action(createActionArgs(request, { agentId: created.sessionId }));

    expect(response.status).toBe(200);
    const data = await parseResponse<{ success: boolean; stopped: boolean; agentId: string }>(
      response
    );
    expect(data.success).toBe(true);
    expect(data.stopped).toBe(true);
    expect(data.agentId).toBe(created.sessionId);
  });

  it('returns 400 for invalid agent ID format', async () => {
    const request = new Request('http://localhost/api/agents/invalid id/stop', { method: 'POST' });
    const response = await action(createActionArgs(request, { agentId: 'invalid id' }));

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for unknown agent', async () => {
    // Use a valid format but non-existent ID
    const nonExistentId = testSessionId(99999);
    const request = new Request(`http://localhost/api/agents/${nonExistentId}/stop`, {
      method: 'POST',
    });
    const response = await action(createActionArgs(request, { agentId: nonExistentId }));

    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });
});
