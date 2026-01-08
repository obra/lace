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
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { Project } from '@lace/web/lib/server/projects/project';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';

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
  let originalTestProviderEnv: string | undefined;

  beforeEach(async () => {
    originalTestProviderEnv = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
      LACE_AGENT_TEST_PROVIDER: '1',
    };

    providerInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;

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
    await shutdownSupervisorForTests();
    await deleteEntTestConnection(providerInstanceId);
    if (originalTestProviderEnv === undefined) {
      delete process.env.LACE_AGENT_TEST_PROVIDER;
    } else {
      process.env.LACE_AGENT_TEST_PROVIDER = originalTestProviderEnv;
    }
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

  it('returns assistant replies as AGENT_MESSAGE (not LOCAL_SYSTEM_MESSAGE)', async () => {
    const supervisor = await getSupervisor();

    await supervisor.promptSession(workspaceSessionId, agentId, [
      { type: 'text', text: 'tell me a story' },
    ]);

    const start = Date.now();
    let assistantDurable: { eventSeq: number; data: Record<string, unknown> } | undefined;
    while (Date.now() - start < 5000) {
      const result = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentId,
        method: 'ent/session/events',
        requestParams: { limit: 5000 },
      })) as { events: Array<{ eventSeq: number; type: string; data: Record<string, unknown> }> };

      assistantDurable = result.events.find((e) => e.type === 'message');
      if (assistantDurable) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(assistantDurable).toBeTruthy();

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));
    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ id?: string; type?: string; data?: unknown }>>(res);

    const assistantId = `ent_${assistantDurable!.eventSeq}_assistant`;
    const assistantEvent = events.find((e) => e.id === assistantId);
    expect(assistantEvent?.type).toBe('AGENT_MESSAGE');
    expect((assistantEvent?.data as { content?: unknown } | undefined)?.content).toBeTypeOf(
      'string'
    );
  }, 15000);

  it('extracts assistant message text from array content blocks', async () => {
    const supervisor = await getSupervisor();

    await supervisor.promptSession(workspaceSessionId, agentId, [
      { type: 'text', text: 'job: echo hi' },
    ]);

    const start = Date.now();
    let assistantDurable: { eventSeq: number; data: Record<string, unknown> } | undefined;
    while (Date.now() - start < 5000) {
      const result = (await supervisor.agentRequest({
        workspaceSessionId,
        sessionId: agentId,
        method: 'ent/session/events',
        requestParams: { limit: 5000 },
      })) as { events: Array<{ eventSeq: number; type: string; data: Record<string, unknown> }> };

      assistantDurable = result.events.find((e) => {
        if (e.type !== 'message') return false;
        const content = e.data?.content;
        return Array.isArray(content);
      });
      if (assistantDurable) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(assistantDurable).toBeTruthy();

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));
    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ id?: string; type?: string; data?: unknown }>>(res);

    const assistantId = `ent_${assistantDurable!.eventSeq}_assistant`;
    const assistantEvent = events.find((e) => e.id === assistantId);
    expect(assistantEvent?.type).toBe('AGENT_MESSAGE');
    expect((assistantEvent?.data as { content?: unknown } | undefined)?.content).toBe('hello');
  }, 15000);
});
