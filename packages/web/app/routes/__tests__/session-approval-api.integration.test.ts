// ABOUTME: Real integration tests for session-wide approval aggregation API
// ABOUTME: Tests actual approval flow with real components - no mocking of business logic

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import {
  Project,
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/web/lib/server/lace-imports';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import { loader as pendingApprovalsLoader } from '@lace/web/app/routes/api.sessions.$sessionId.approvals.pending';
import { action as approvalDecisionAction } from '@lace/web/app/routes/api.sessions.$sessionId.approvals.$toolCallId';
import type { SessionPendingApproval } from '@lace/web/types/api';
import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { action as spawnAgent } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { action as sendMessage } from '@lace/web/app/routes/api.threads.$threadId.message';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Session Approval API Integration (Real Components)', () => {
  const _tempLaceDir = setupWebTest();
  let project: Project;
  let providerInstanceId: string;
  let workspaceSessionId: string;
  let agent1SessionId: string;
  let agent2SessionId: string;

  beforeEach(async () => {
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      apiKey: 'test-anthropic-key',
    });

    // Create project with provider configuration
    project = Project.create(
      'Session Approval Test Project',
      _tempLaceDir.tempDir,
      'Test project',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    const createSessionRequest = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Session Approval Test Session',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      }
    );
    const createSessionResponse = await createWorkspaceSession(
      createActionArgs(createSessionRequest, { projectId: project.getId() })
    );
    expect(createSessionResponse.status).toBe(201);
    const created = await parseResponse<{ id: string }>(createSessionResponse);
    workspaceSessionId = created.id;

    const spawnRequest1 = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent 1',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      }
    );
    const spawnResponse1 = await spawnAgent(
      createActionArgs(spawnRequest1, { sessionId: workspaceSessionId })
    );
    expect(spawnResponse1.status).toBe(201);
    const spawned1 = await parseResponse<{ threadId: string }>(spawnResponse1);
    agent1SessionId = spawned1.threadId;

    const spawnRequest2 = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent 2',
          providerInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      }
    );
    const spawnResponse2 = await spawnAgent(
      createActionArgs(spawnRequest2, { sessionId: workspaceSessionId })
    );
    expect(spawnResponse2.status).toBe(201);
    const spawned2 = await parseResponse<{ threadId: string }>(spawnResponse2);
    agent2SessionId = spawned2.threadId;
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await cleanupTestProviderInstances([providerInstanceId]);
    delete process.env.LACE_AGENT_TEST_PROVIDER;
  });

  it('should aggregate pending approvals from multiple agents', async () => {
    const message1 = new Request('http://localhost/api/threads/a/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'write file approval1.txt' }),
    });
    const message2 = new Request('http://localhost/api/threads/b/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'write file approval2.txt' }),
    });

    await sendMessage(createActionArgs(message1, { threadId: agent1SessionId }));
    await sendMessage(createActionArgs(message2, { threadId: agent2SessionId }));

    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/approvals/pending`
    );

    let approvals: SessionPendingApproval[] = [];
    for (let i = 0; i < 30; i++) {
      const response = await pendingApprovalsLoader(
        createLoaderArgs(request, { sessionId: workspaceSessionId })
      );
      const data = await parseResponse<SessionPendingApproval[] | { error: string }>(response);
      if (Array.isArray(data) && data.length >= 2) {
        approvals = data;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(approvals).toHaveLength(2);
    expect(approvals.map((a) => a.agentId)).toEqual(
      expect.arrayContaining([agent1SessionId, agent2SessionId])
    );
    approvals.forEach((a) => expect(a.requestData.toolName).toBe('file_write'));
  });

  it('should allow approval and clear pending entry', async () => {
    const message = new Request('http://localhost/api/threads/a/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'write file approved.txt' }),
    });

    await sendMessage(createActionArgs(message, { threadId: agent1SessionId }));

    const pendingRequest = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/approvals/pending`
    );

    let toolCallId: string | undefined;
    for (let i = 0; i < 30; i++) {
      const response = await pendingApprovalsLoader(
        createLoaderArgs(pendingRequest, { sessionId: workspaceSessionId })
      );
      const data = await parseResponse<SessionPendingApproval[] | { error: string }>(response);
      if (Array.isArray(data)) {
        const found = data.find((a) => a.agentId === agent1SessionId);
        if (found) {
          toolCallId = found.toolCallId;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(toolCallId).toBeDefined();

    const decisionRequest = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/approvals/${toolCallId}`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );
    const decisionResponse = await approvalDecisionAction(
      createActionArgs(decisionRequest, { sessionId: workspaceSessionId, toolCallId: toolCallId! })
    );
    const decisionResult = await parseResponse<{ success: boolean }>(decisionResponse);
    expect(decisionResult.success).toBe(true);

    for (let i = 0; i < 30; i++) {
      const response = await pendingApprovalsLoader(
        createLoaderArgs(pendingRequest, { sessionId: workspaceSessionId })
      );
      const data = await parseResponse<SessionPendingApproval[] | { error: string }>(response);
      if (Array.isArray(data) && !data.some((a) => a.toolCallId === toolCallId)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error('Expected pending approval to be cleared');
  });

  it('should return empty array when no pending approvals', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/approvals/pending`
    );
    const response = await pendingApprovalsLoader(
      createLoaderArgs(request, { sessionId: workspaceSessionId })
    );
    expect(response.status).toBe(200);
    const data = await parseResponse<SessionPendingApproval[]>(response);
    expect(data).toEqual([]);
  });

  it('should return 404 for non-existent session', async () => {
    const nonExistentWorkspaceSessionId = 'ws_00000000-0000-0000-0000-000000000000';
    const request = new Request(
      `http://localhost/api/sessions/${nonExistentWorkspaceSessionId}/approvals/pending`
    );
    const response = await pendingApprovalsLoader(
      createLoaderArgs(request, { sessionId: nonExistentWorkspaceSessionId })
    );
    expect(response.status).toBe(404);
    const data = await parseResponse<{ code?: string }>(response);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should return 404 when tool call not found', async () => {
    const request = new Request(
      `http://localhost/api/sessions/${workspaceSessionId}/approvals/non-existent-tool-call`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow_once' }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const response = await approvalDecisionAction(
      createActionArgs(request, {
        sessionId: workspaceSessionId,
        toolCallId: 'non-existent-tool-call',
      })
    );
    expect(response.status).toBe(404);
    const data = await parseResponse<{ code?: string }>(response);
    expect(data.code).toBe('RESOURCE_NOT_FOUND');
  });
});
