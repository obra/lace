// ABOUTME: Integration tests for web/supervisor backend behavior around token usage & compaction
// ABOUTME: Supervisor-backed agents do not expose token usage or context breakdown yet

/**
 * @vitest-environment node
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { loader as getAgent } from '@lace/web/app/routes/api.agents.$agentId';
import { loader as getContext } from '@lace/web/app/routes/api.agents.$agentId.context';
import { createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';

vi.mock('server-only', () => ({}));

describe('Supervisor-backed agent token usage (not supported)', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET /api/agents/:agentId returns tokenUsage as undefined', async () => {
    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(`http://localhost:3000/api/agents/${created.sessionId}`);
    const response = await getAgent(createLoaderArgs(request, { agentId: created.sessionId }));
    const data = await parseResponse<{ tokenUsage?: unknown }>(response);

    expect(response.status).toBe(200);
    expect(data.tokenUsage).toBeUndefined();
  });

  it('GET /api/agents/:agentId/context returns 501 NOT_SUPPORTED', async () => {
    const supervisor = getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(`http://localhost:3000/api/agents/${created.sessionId}/context`);
    const response = await getContext(createLoaderArgs(request, { agentId: created.sessionId }));
    const data = await parseResponse<{ error: string }>(response);

    expect(response.status).toBe(501);
    expect(data.error).toBe('Context breakdown is not supported for supervisor-backed agents');
  });
});
