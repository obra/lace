// ABOUTME: Unit tests for system_prompt_set durable event mapping in agent history route
// ABOUTME: Verifies system_prompt_set events are converted to SYSTEM_PROMPT app events directly from the event stream

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseResponse } from '@lace/web/lib/serialization';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { testSessionId, testWorkspaceSessionId } from '@lace/web/test-utils/test-ids';

vi.mock('server-only', () => ({}));

const mockGetSupervisor = vi.fn();

vi.mock('@lace/web/lib/server/supervisor-service', async () => {
  const actual = await vi.importActual<typeof import('@lace/web/lib/server/supervisor-service')>(
    '@lace/web/lib/server/supervisor-service'
  );
  return {
    ...actual,
    getSupervisor: () => mockGetSupervisor(),
  };
});

import { loader as getHistory } from '@lace/web/app/routes/api.agents.$agentId.history';

const SYSTEM_PROMPT_TEXT = 'You are a helpful coding assistant.';

function makeSupervisorMock(overrides: {
  events?: Array<{ eventSeq: number; timestamp: string; type: string; data: unknown }>;
}) {
  const agentId = testSessionId(1);
  const workspaceSessionId = testWorkspaceSessionId(1);
  const events = overrides.events ?? [];

  return {
    agentId,
    workspaceSessionId,
    supervisor: {
      listWorkspaceSessions: () => [{ workspaceSessionId, agents: [{ sessionId: agentId }] }],
      agentRequest: ({ method }: { method: string }) => {
        if (method === 'ent/session/events') {
          return Promise.resolve({ events });
        }
        return Promise.resolve({});
      },
    },
  };
}

describe('history route: system_prompt_set event mapping', () => {
  beforeEach(() => {
    mockGetSupervisor.mockReset();
  });

  it('converts system_prompt_set event to SYSTEM_PROMPT app event', async () => {
    const { agentId, supervisor } = makeSupervisorMock({
      events: [
        {
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'system_prompt_set',
          data: { text: SYSTEM_PROMPT_TEXT },
        },
      ],
    });
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string; data?: unknown; id?: string }>>(res);

    const promptEvent = events.find((e) => e.type === 'SYSTEM_PROMPT');
    expect(promptEvent).toBeTruthy();
    expect(promptEvent?.data).toBe(SYSTEM_PROMPT_TEXT);
  });

  it('emits no SYSTEM_PROMPT when system_prompt_set has empty text', async () => {
    const { agentId, supervisor } = makeSupervisorMock({
      events: [
        {
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'system_prompt_set',
          data: { text: '' },
        },
      ],
    });
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string }>>(res);
    expect(events.find((e) => e.type === 'SYSTEM_PROMPT')).toBeUndefined();
  });

  it('emits no SYSTEM_PROMPT when there are no system_prompt_set events', async () => {
    const { agentId, supervisor } = makeSupervisorMock({ events: [] });
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string }>>(res);
    expect(events.find((e) => e.type === 'SYSTEM_PROMPT')).toBeUndefined();
  });

  it('converts legacy context_injected event to SYSTEM_PROMPT app event', async () => {
    const { agentId, supervisor } = makeSupervisorMock({
      events: [
        {
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'context_injected',
          data: { content: [{ type: 'text', text: 'Legacy system prompt' }] },
        },
      ],
    });
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string }>>(res);
    const promptEvents = events.filter((e) => e.type === 'SYSTEM_PROMPT');
    expect(promptEvents).toHaveLength(1);
    expect((promptEvents[0] as { data?: unknown }).data).toBe('Legacy system prompt');
  });
});
