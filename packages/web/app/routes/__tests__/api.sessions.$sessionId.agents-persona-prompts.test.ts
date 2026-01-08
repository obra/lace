// ABOUTME: Gold-standard test for persona system prompt generation via API
// ABOUTME: Verifies different personas result in different injected system prompts

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { parseResponse } from '@lace/web/lib/serialization';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';
import { Project } from '@lace/web/lib/server/projects/project';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Import after mocks
import { action as POST } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';

describe('Agent Creation API - Persona System Prompt Generation', () => {
  const context = setupWebTest();
  let workspaceSessionId: string = '';
  let providerInstanceId: string = '';
  let projectId: string = '';

  beforeEach(async () => {
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    providerInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;

    const testDir = join(context.tempProjectDir, 'persona-prompts');
    await fs.mkdir(testDir, { recursive: true });
    const testProject = Project.create(
      'Test Project',
      testDir,
      'Test project for persona prompts',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );
    projectId = testProject.getId();

    const createSessionRequest = new Request(
      `http://localhost/api/projects/${projectId}/sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      }
    );

    const createResponse = await createWorkspaceSession(
      createActionArgs(createSessionRequest, { projectId })
    );
    expect(createResponse.status).toBe(201);
    const created = await parseResponse<{ id: string }>(createResponse);
    workspaceSessionId = created.id;
  });

  afterEach(async () => {
    await shutdownSupervisorForTests();
    await deleteEntTestConnection(providerInstanceId);
    vi.clearAllMocks();
  });

  it('should generate and inject system prompts for each agent persona', async () => {
    const defaultAgentBody = {
      name: 'Default Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      // No persona specified
    };

    const defaultResponse = await POST(
      createActionArgs(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify(defaultAgentBody),
          headers: { 'Content-Type': 'application/json' },
        }),
        { sessionId: workspaceSessionId }
      )
    );
    expect(defaultResponse.status).toBe(201);
    const defaultAgent = await parseResponse<{ threadId: string }>(defaultResponse);

    const summaryAgentBody = {
      name: 'Summary Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'session-summary',
    };

    const summaryResponse = await POST(
      createActionArgs(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify(summaryAgentBody),
          headers: { 'Content-Type': 'application/json' },
        }),
        { sessionId: workspaceSessionId }
      )
    );
    expect(summaryResponse.status).toBe(201);
    const summaryAgent = await parseResponse<{ threadId: string }>(summaryResponse);

    const defaultInjectedPrompt = await getInjectedText(workspaceSessionId, defaultAgent.threadId);
    const summaryInjectedPrompt = await getInjectedText(workspaceSessionId, summaryAgent.threadId);

    expect(defaultInjectedPrompt).toContain(
      'You are Lace, a pragmatic AI coding partner for a human.'
    );
    expect(defaultInjectedPrompt).not.toContain('You are a specialized summary agent');

    expect(summaryInjectedPrompt).toContain('You are a specialized summary agent');
    expect(summaryInjectedPrompt).not.toContain(
      'You are Lace, a pragmatic AI coding partner for a human.'
    );
  });
});

async function getInjectedText(
  workspaceSessionId: string,
  agentSessionId: string
): Promise<string> {
  const supervisor = await getSupervisor();
  const result = (await supervisor.agentRequest({
    workspaceSessionId,
    sessionId: agentSessionId,
    method: 'ent/session/events',
    requestParams: { types: ['context_injected'] },
  })) as { events: Array<{ type: string; data: Record<string, unknown> }>; hasMore: boolean };

  const injected = result.events.find((e) => e.type === 'context_injected');
  if (!injected) {
    throw new Error('No context_injected event found');
  }

  const content = injected.data.content;
  if (!Array.isArray(content)) {
    throw new Error('context_injected event missing content array');
  }

  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error('context_injected event does not include a text payload');
  }

  return first.text;
}
