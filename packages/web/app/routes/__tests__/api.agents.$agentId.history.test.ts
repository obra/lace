// ABOUTME: Integration tests for agent history endpoint with supervisor-backed sessions
// ABOUTME: Ensures durable events are mapped into correct timeline event types (e.g. SYSTEM_PROMPT)

/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';
import {
  cleanupTestProviderInstances,
  createTestProviderInstance,
  Project,
} from '@lace/web/lib/server/lace-imports';

vi.mock('server-only', () => ({}));

import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { action as createAgent } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { loader as getHistory } from '@lace/web/app/routes/api.agents.$agentId.history';

describe('/api/agents/:agentId/history', () => {
  const context = setupWebTest();
  let providerInstanceId: string;
  let project: Project;
  let workspaceSessionId: string;
  let agentId: string;

  beforeEach(async () => {
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    const projectDir = join(context.tempProjectDir, 'history-test');
    await fs.mkdir(projectDir, { recursive: true });
    project = Project.create('History Test Project', projectDir, 'Project for history tests', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    const createSessionReq = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'History Test Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      }
    );

    const createSessionRes = await createWorkspaceSession(
      createActionArgs(createSessionReq, { projectId: project.getId() })
    );
    expect(createSessionRes.status).toBe(201);
    const session = await parseResponse<{ id: string }>(createSessionRes);
    workspaceSessionId = session.id;

    const createAgentReq = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'History Agent',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
          persona: 'lace',
        }),
      }
    );

    const createAgentRes = await createAgent(
      createActionArgs(createAgentReq, { sessionId: workspaceSessionId })
    );
    expect(createAgentRes.status).toBe(201);
    const created = await parseResponse<{ threadId: string }>(createAgentRes);
    agentId = created.threadId;
  });

  afterEach(async () => {
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('returns persona injection as SYSTEM_PROMPT (not LOCAL_SYSTEM_MESSAGE)', async () => {
    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string; data?: unknown }>>(res);

    const promptEvent = events.find((e) => e.type === 'SYSTEM_PROMPT');
    expect(promptEvent).toBeTruthy();
    expect(typeof promptEvent?.data).toBe('string');
    expect((promptEvent?.data as string).trim().length).toBeGreaterThan(0);
  });
});
