// ABOUTME: Integration tests for thread messaging API endpoint
// ABOUTME: Tests sending messages to agents with real functionality and mocked network layer

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { action as POST } from '@lace/web/app/routes/api.threads.$threadId.message';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import type { MessageResponse } from '@lace/web/types/api';
import { Project } from '@lace/web/lib/server/lace-imports';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@lace/web/lib/server/lace-imports';
import { parseResponse } from '@lace/web/lib/serialization';
import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { action as spawnAgent } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { getSupervisor } from '@lace/web/lib/server/supervisor-service';
import { testSessionId } from '@lace/web/test-utils/test-ids';

// Console capture for verifying error output
let consoleLogs: string[] = [];
let originalConsoleError: typeof console.error;

describe('Thread Messaging API', () => {
  const _tempLaceDir = setupWebTest();
  let workspaceSessionId: string;
  let agentSessionId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up console capture
    consoleLogs = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      consoleLogs.push(args.map((arg) => String(arg)).join(' '));
    };

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';
    process.env.LACE_AGENT_TEST_PROVIDER = '1';

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create a real test project with provider configuration
    const project = Project.create('Test Project', process.cwd(), 'Project for testing', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    const createSessionRequest = new Request(
      `http://localhost/api/projects/${project.getId()}/sessions`,
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
    const createSessionResponse = await createWorkspaceSession(
      createActionArgs(createSessionRequest, { projectId: project.getId() })
    );
    expect(createSessionResponse.status).toBe(201);
    const createdSession = await parseResponse<{ id: string }>(createSessionResponse);
    workspaceSessionId = createdSession.id;

    const spawnRequest = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Agent',
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }),
    });
    const spawnResponse = await spawnAgent(
      createActionArgs(spawnRequest, { sessionId: workspaceSessionId })
    );
    expect(spawnResponse.status).toBe(201);
    const spawned = await parseResponse<{ threadId: string }>(spawnResponse);
    agentSessionId = spawned.threadId;
  });

  afterEach(async () => {
    console.error = originalConsoleError;
    // Clean up provider instances
    await cleanupTestProviderInstances([providerInstanceId]);
    // Wait a moment for any pending operations to abort
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.clearAllMocks();

    delete process.env.LACE_AGENT_TEST_PROVIDER;
  });

  it('should accept and process messages', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello, agent!' }),
    });

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(202);
    const data = await parseResponse<MessageResponse>(response);
    expect(data.status).toBe('accepted');
    expect(data.messageId).toBeDefined();
    expect(data.threadId).toBe(agentSessionId);
  });

  it('should return 400 for invalid thread ID', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    const response = await POST(createActionArgs(request, { threadId: 'bad..id' }));

    expect(response.status).toBe(400);
  });

  it('should return 404 for non-existent session', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello!' }),
    });

    // Use a valid format but non-existent session ID
    const nonExistentId = testSessionId(99999);
    const response = await POST(createActionArgs(request, { threadId: nonExistentId }));

    expect(response.status).toBe(404);
  });

  it('should return 400 for missing message', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(400);
  });

  it('should return 400 for empty message', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(400);
  });

  it('should not duplicate user messages in the database', async () => {
    const supervisor = await getSupervisor();
    const promptSpy = vi.spyOn(supervisor, 'promptSession');

    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test message' }),
    });

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(202);
    expect(promptSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle malformed JSON gracefully', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    });

    // Clear any previous console logs for this specific test
    consoleLogs = [];

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(400);

    // Verify error message in response
    const responseData = await parseResponse<{ error: string }>(response);
    expect(responseData.error).toBe('Invalid JSON in request body');
  });

  it('should work with delegate agents', async () => {
    const spawnRequest = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Delegate',
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }),
    });

    const spawnResponse = await spawnAgent(
      createActionArgs(spawnRequest, { sessionId: workspaceSessionId })
    );
    expect(spawnResponse.status).toBe(201);
    const spawned = await parseResponse<{ threadId: string }>(spawnResponse);
    const delegateThreadId = spawned.threadId;

    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello delegate!' }),
    });

    const response = await POST(createActionArgs(request, { threadId: delegateThreadId }));

    expect(response.status).toBe(202);
    const data = await parseResponse<MessageResponse>(response);
    expect(data.status).toBe('accepted');
  });

  it('should handle agent startup correctly', async () => {
    const request = new Request('http://localhost/api/threads/test/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Test auto-start' }),
    });

    const response = await POST(createActionArgs(request, { threadId: agentSessionId }));

    expect(response.status).toBe(202);
  });
});
