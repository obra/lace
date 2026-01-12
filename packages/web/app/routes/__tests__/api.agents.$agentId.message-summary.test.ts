// ABOUTME: Integration tests for supervisor-backed agent message endpoint
// ABOUTME: Verifies prompt is forwarded to lace-agent (using built-in test provider)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { action } from '@lace/web/app/routes/api.agents.$agentId.message';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// ✅ ESSENTIAL MOCK - Server-side module compatibility in test environment
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

type DurableEvent = { type: string; data: Record<string, unknown> };

type TextBlock = { type: 'text'; text: string };

function isTextBlock(block: unknown): block is TextBlock {
  if (!block || typeof block !== 'object') return false;
  const record = block as Record<string, unknown>;
  return record.type === 'text' && typeof record.text === 'string';
}

async function waitForEvent(params: {
  getEvents: () => Promise<DurableEvent[]>;
  predicate: (e: DurableEvent) => boolean;
  timeoutMs: number;
}): Promise<DurableEvent> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    const events = await params.getEvents();
    const found = events.find(params.predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('Timed out waiting for durable event');
}

describe('Agent Message Endpoint (supervisor-backed)', () => {
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

  it('records a prompt durable event when user sends message', async () => {
    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    const request = new Request(`http://localhost:3000/api/agents/${created.sessionId}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello from test' }),
    });

    const response = await action({
      request,
      params: { agentId: created.sessionId },
    } as unknown as {
      request: Request;
      params: { agentId: string };
      context: Record<string, unknown>;
    });

    expect(response.status).toBe(200);

    const getEvents = async (): Promise<DurableEvent[]> => {
      const result = (await supervisor.agentRequest({
        workspaceSessionId: created.workspaceSessionId,
        sessionId: created.sessionId,
        method: 'ent/session/events',
        requestParams: { limit: 200 },
      })) as { events: DurableEvent[] };
      return result.events;
    };

    const promptEvent = await waitForEvent({
      getEvents,
      predicate: (e) => e.type === 'prompt',
      timeoutMs: 3000,
    });

    const content = Array.isArray(promptEvent.data?.content)
      ? (promptEvent.data.content as unknown[])
      : [];
    const text = content
      .filter(isTextBlock)
      .map((b) => b.text)
      .join('\n');

    expect(text).toContain('Hello from test');
  });

  it('surfaces supervisor prompt rejections (no ghost send)', async () => {
    // Regression test for the original "ghost send" bug:
    // the route used to return 202 even if promptSession failed.

    const { SupervisorHttpError } = await import('@lace/supervisor');

    const supervisor = await getSupervisor();
    const created = await supervisor.createWorkspaceSession(context.tempProjectDir);

    vi.spyOn(supervisor, 'promptSession').mockRejectedValue(
      new SupervisorHttpError({
        status: 400,
        code: -32602,
        message: 'Invalid params',
        data: { field: 'content' },
      })
    );

    const request = new Request(`http://localhost:3000/api/agents/${created.sessionId}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Hello from test' }),
    });

    const response = await action({
      request,
      params: { agentId: created.sessionId },
    } as unknown as {
      request: Request;
      params: { agentId: string };
      context: Record<string, unknown>;
    });

    expect(response.status).toBe(400);

    const { parseResponse } = await import('@lace/web/lib/serialization');

    const payload = await parseResponse<{
      error: { code?: number; message: string; data?: unknown };
      message?: string;
    }>(response);

    expect(payload).toMatchObject({
      error: {
        code: -32602,
        message: 'Invalid params',
        data: { field: 'content' },
      },
    });
  });

});
