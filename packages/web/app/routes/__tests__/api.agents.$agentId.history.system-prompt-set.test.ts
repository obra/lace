// ABOUTME: Unit tests for system_prompt_set durable event mapping in agent history route
// ABOUTME: Verifies Phase 2 cache-control hardening: system prompt fetched via dedicated endpoint

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
  systemPromptText?: string;
  extraEvents?: Array<{ eventSeq: number; timestamp: string; type: string; data: unknown }>;
}) {
  const agentId = testSessionId(1);
  const workspaceSessionId = testWorkspaceSessionId(1);
  const systemPromptText = overrides.systemPromptText ?? SYSTEM_PROMPT_TEXT;
  const extraEvents = overrides.extraEvents ?? [];

  return {
    agentId,
    workspaceSessionId,
    supervisor: {
      listWorkspaceSessions: () => [{ workspaceSessionId, agents: [{ sessionId: agentId }] }],
      agentRequest: ({ method }: { method: string }) => {
        if (method === 'ent/session/events') {
          return Promise.resolve({ events: extraEvents });
        }
        if (method === 'ent/session/system_prompt') {
          return Promise.resolve({ text: systemPromptText });
        }
        return Promise.resolve({});
      },
    },
  };
}

describe('history route: Phase 2 system prompt via ent/session/system_prompt', () => {
  beforeEach(() => {
    mockGetSupervisor.mockReset();
  });

  it('fetches system prompt via dedicated endpoint and emits SYSTEM_PROMPT app event', async () => {
    const { agentId, supervisor } = makeSupervisorMock({});
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string; data?: unknown; id?: string }>>(res);

    const promptEvent = events.find((e) => e.type === 'SYSTEM_PROMPT');
    expect(promptEvent).toBeTruthy();
    expect(promptEvent?.data).toBe(SYSTEM_PROMPT_TEXT);
  });

  it('emits no SYSTEM_PROMPT when system prompt text is empty', async () => {
    const { agentId, supervisor } = makeSupervisorMock({ systemPromptText: '' });
    mockGetSupervisor.mockReturnValue(supervisor);

    const req = new Request(`http://localhost/api/agents/${agentId}/history`, { method: 'GET' });
    const res = await getHistory(createActionArgs(req, { agentId }));

    expect(res.status).toBe(200);
    const events = await parseResponse<Array<{ type?: string }>>(res);
    expect(events.find((e) => e.type === 'SYSTEM_PROMPT')).toBeUndefined();
  });

  it('does not duplicate SYSTEM_PROMPT for legacy sessions that have context_injected events', async () => {
    // Legacy sessions: context_injected event in the stream already produces
    // a SYSTEM_PROMPT event, so the system_prompt_set path should not add a second one.
    const { agentId, supervisor } = makeSupervisorMock({
      extraEvents: [
        {
          eventSeq: 1,
          timestamp: new Date().toISOString(),
          type: 'context_injected',
          data: { content: [{ type: 'text', text: 'Legacy system prompt' }] },
        },
      ],
      // For legacy sessions the dedicated endpoint returns empty text.
      systemPromptText: '',
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
