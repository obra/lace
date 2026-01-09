// ABOUTME: Integration tests for compaction/token tracking behavior during supervisor cutover
// ABOUTME: Supervisor-backed agents expose token usage and context breakdown via ENT

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { action as sendMessage } from '@lace/web/app/routes/api.agents.$agentId.message';
import { loader as getAgent } from '@lace/web/app/routes/api.agents.$agentId';
import { loader as getContext } from '@lace/web/app/routes/api.agents.$agentId.context';
import { createActionArgs, createLoaderArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';

vi.mock('server-only', () => ({}));

type DurableEvent = { type: string; data: Record<string, unknown> };

async function waitForEvent(params: {
  getEvents: () => Promise<DurableEvent[]>;
  predicate: (e: DurableEvent) => boolean;
  timeoutMs: number;
}): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    const events = await params.getEvents();
    if (events.some(params.predicate)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for durable event');
}

describe('Supervisor-backed agent compaction/token usage (supported)', () => {
  const context = setupWebTest();
  let originalTestProviderEnv: string | undefined;

  beforeEach(() => {
    originalTestProviderEnv = process.env.LACE_AGENT_TEST_PROVIDER;
    process.env.LACE_AGENT_TEST_PROVIDER = '1';
  });

  afterEach(async () => {
    process.env.LACE_AGENT_TEST_PROVIDER = originalTestProviderEnv;
    await shutdownSupervisorForTests();
  });

  it('exposes tokenUsage and context breakdown after agent activity', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const messageRequest = new Request(
      `http://localhost:3000/api/agents/${created.sessionId}/message`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hello from test' }),
      }
    );
    const messageResponse = await sendMessage(
      createActionArgs(messageRequest, { agentId: created.sessionId })
    );
    expect(messageResponse.status).toBe(202);

    const getEvents = async (): Promise<DurableEvent[]> => {
      const result = (await supervisor.agentRequest({
        workspaceSessionId: created.workspaceSessionId,
        sessionId: created.sessionId,
        method: 'ent/session/events',
        requestParams: { limit: 200 },
      })) as { events: DurableEvent[] };
      return result.events;
    };

    await waitForEvent({
      getEvents,
      predicate: (e) => e.type === 'prompt',
      timeoutMs: 3000,
    });

    const agentRequest = new Request(`http://localhost:3000/api/agents/${created.sessionId}`);
    const agentResponse = await getAgent(
      createLoaderArgs(agentRequest, { agentId: created.sessionId })
    );
    const agentData = await parseResponse<{ tokenUsage?: unknown }>(agentResponse);

    expect(agentResponse.status).toBe(200);
    expect(agentData.tokenUsage).toBeTruthy();

    const contextRequest = new Request(
      `http://localhost:3000/api/agents/${created.sessionId}/context`
    );
    const contextResponse = await getContext(
      createLoaderArgs(contextRequest, { agentId: created.sessionId })
    );
    const breakdown = await parseResponse<Record<string, unknown>>(contextResponse);
    expect(contextResponse.status).toBe(200);
    expect(breakdown.categories).toBeTruthy();
  });
});
