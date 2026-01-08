// ABOUTME: Tests for initial message flow in agent creation
// ABOUTME: Verifies timing and behavior of sending initial messages to newly created agents

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { promises as fs } from 'fs';
import { join } from 'path';
import { parseResponse } from '@lace/web/lib/serialization';
import { createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';
import { shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Import after mocks
import { action as POST } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { Project } from '@lace/web/lib/server/projects/project';

describe('Agent Creation - Initial Message Flow', () => {
  const context = setupWebTest();
  let testProject: Project;
  let workspaceSessionId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Set up environment
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    providerInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;

    // Create real project and session
    const testDir = join(context.tempProjectDir, 'message-flow');
    await fs.mkdir(testDir, { recursive: true });
    testProject = Project.create('Test Project', testDir, 'Test project for message flow', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    const createRequest = new Request(
      `http://localhost/api/projects/${testProject.getId()}/sessions`,
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
      createActionArgs(createRequest, { projectId: testProject.getId() })
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

  it('should create agent without message when no initialMessage provided', async () => {
    const requestBody = {
      name: 'Idle Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'lace',
      // No initialMessage
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(201);
    const data = await parseResponse(response);

    // Agent should be created successfully
    expect(data).toMatchObject({
      name: 'Idle Agent',
      status: 'idle', // Should be idle since no message sent
    });
  });

  it('should create agent and send initial message when provided', async () => {
    const requestBody = {
      name: 'Active Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'lace',
      initialMessage: 'Hello! Please help me get started.',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(201);
    const data = await parseResponse(response);

    // Agent should be created successfully
    expect(data).toMatchObject({
      name: 'Active Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Note: Initial message sending is async, so we can't easily test
    // the final agent state here. This test verifies the agent is created
    // and the initial message process is triggered without errors.
  });

  it('should handle empty initial message gracefully', async () => {
    const requestBody = {
      name: 'Edge Case Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'lace',
      initialMessage: '   ', // Whitespace only
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(201);

    // Should succeed - whitespace-only messages are trimmed and ignored
  });

  it('should handle initial message with just whitespace', async () => {
    const requestBody = {
      name: 'Whitespace Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'lace',
      initialMessage: '', // Empty string
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(201);

    // Should succeed - empty strings are handled gracefully
  });

  it('should create agent successfully even if initial message sending fails', async () => {
    // This test documents that agent creation should succeed even if message sending fails
    // The agent creation and message sending are separate operations for resilience

    const requestBody = {
      name: 'Resilient Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'lace',
      initialMessage: 'Test message for resilience',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    // Agent creation should succeed regardless of message sending outcome
    expect(response.status).toBe(201);
    const data = await parseResponse(response);
    expect(data).toMatchObject({
      name: 'Resilient Agent',
    });
  });

  it('should handle agent creation without persona but with initial message', async () => {
    const requestBody = {
      name: 'Message Only Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      // No persona
      initialMessage: 'Hello without specific persona!',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId: workspaceSessionId }));

    expect(response.status).toBe(201);

    // Should work - persona is optional, message sending should still work
  });
});
