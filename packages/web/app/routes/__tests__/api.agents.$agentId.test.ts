// ABOUTME: Integration tests for supervisor-backed agent API endpoints - GET, PUT
// ABOUTME: Agent IDs are Ent protocol sessionIds (not core ThreadIds)

import { describe, it, expect, afterEach } from 'vitest';
import { loader, action } from '@lace/web/app/routes/api.agents.$agentId';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/web/lib/server/lace-imports';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { testSessionId } from '@lace/web/test-utils/test-ids';

interface ErrorResponse {
  error: string;
  details?: unknown;
}

describe('Agent API', () => {
  const context = setupWebTest();

  afterEach(async () => {
    await shutdownSupervisorForTests();
  });

  it('GET /api/agents/:agentId returns agent details when found', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
    const spawned = await supervisor.createAgentSession(created.workspaceSessionId);

    await supervisor.upsertAgentSessionMeta(created.workspaceSessionId, {
      sessionId: spawned.sessionId,
      name: 'Test Agent',
      connectionId: 'conn_test',
      modelId: 'model_test',
    });

    const request = new Request(`http://localhost/api/agents/${spawned.sessionId}`);
    const response = await loader(createLoaderArgs(request, { agentId: spawned.sessionId }));
    const data = await parseResponse<{
      threadId: string;
      name: string;
      providerInstanceId: string;
      modelId: string;
      persona: string;
    }>(response);

    expect(response.status).toBe(200);
    expect(data.threadId).toBe(spawned.sessionId);
    expect(data.name).toBe('Test Agent');
    expect(data.providerInstanceId).toBe('conn_test');
    expect(data.modelId).toBe('model_test');
    expect(data.persona).toBe('');
  });

  it('GET /api/agents/:agentId returns 400 for invalid agent ID format', async () => {
    const request = new Request('http://localhost/api/agents/invalid id');
    const response = await loader(createLoaderArgs(request, { agentId: 'invalid id' }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid agent ID');
  });

  it('GET /api/agents/:agentId returns 404 when agent not found', async () => {
    // Use a valid format but non-existent ID
    const nonExistentId = testSessionId(99999);
    const request = new Request(`http://localhost/api/agents/${nonExistentId}`);
    const response = await loader(createLoaderArgs(request, { agentId: nonExistentId }));
    const data = await parseResponse<ErrorResponse>(response);

    expect(response.status).toBe(404);
    expect(data.error).toBe('Agent not found');
  });

  it('PUT /api/agents/:agentId updates agent metadata and ent config', async () => {
    const originalTestProviderEnv = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    const providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    try {
      const supervisor = await getSupervisor();
      const created = await supervisor.createWorkspaceSession(context.tempProjectDir);
      const spawned = await supervisor.createAgentSession(created.workspaceSessionId);

      const request = new Request(`http://localhost/api/agents/${spawned.sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Updated Agent',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await action(createActionArgs(request, { agentId: spawned.sessionId }));
      const data = await parseResponse<{
        threadId: string;
        name: string;
        providerInstanceId: string;
        modelId: string;
      }>(response);

      expect(response.status).toBe(200);
      expect(data.threadId).toBe(spawned.sessionId);
      expect(data.name).toBe('Updated Agent');
      expect(data.providerInstanceId).toBe(providerInstanceId);
      expect(data.modelId).toBe('claude-3-5-haiku-20241022');

      const status = (await supervisor.agentRequest({
        workspaceSessionId: created.workspaceSessionId,
        sessionId: spawned.sessionId,
        method: 'ent/agent/status',
        requestParams: {},
      })) as {
        currentSession?: { connectionId?: string; modelId?: string };
      };

      expect(status.currentSession?.connectionId).toBe(providerInstanceId);
      expect(status.currentSession?.modelId).toBe('claude-3-5-haiku-20241022');
    } finally {
      await cleanupTestProviderInstances([providerInstanceId]);
      if (originalTestProviderEnv === undefined) delete process.env.LACE_AGENT_TEST_PROVIDER;
      else process.env.LACE_AGENT_TEST_PROVIDER = originalTestProviderEnv;
    }
  });
});
