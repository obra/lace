// ABOUTME: E2E tests for agent spawning API endpoints using real services
// ABOUTME: Tests full agent spawning workflow from API calls to real session management

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@lace/web/test-utils/web-test-setup';
import { promises as fs } from 'fs';
import { join } from 'path';
import { parseResponse } from '@lace/web/lib/serialization';
import { createLoaderArgs, createActionArgs } from '@lace/web/test-utils/route-test-helpers';
import {
  createEntTestConnection,
  deleteEntTestConnection,
} from '@lace/web/test-utils/ent-test-helpers';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Import the real API route handlers after mocks
import { action as POST, loader as GET } from '@lace/web/app/routes/api.sessions.$sessionId.agents';
import { action as createWorkspaceSession } from '@lace/web/app/routes/api.projects.$projectId.sessions';
import { Project } from '@lace/web/lib/server/projects/project';
import { getSupervisor, shutdownSupervisorForTests } from '@lace/web/lib/server/supervisor-service';

interface ErrorResponse {
  error: string;
}

// Note: parseResponse is imported from @/lib/serialization

type ApiAgent = {
  threadId: string;
  name: string;
  providerInstanceId: string;
  modelId: string;
  status: string;
};

describe('Agent Spawning API E2E Tests', () => {
  const context = setupWebTest();
  let testProject: Project;
  let workspaceSessionId: string;
  let anthropicInstanceId: string;
  let openaiInstanceId: string;

  beforeEach(async () => {
    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      OPENAI_API_KEY: 'test-openai-key',
      LACE_DB_PATH: ':memory:',
    };

    // Create test provider instances
    anthropicInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;
    openaiInstanceId = (await createEntTestConnection({ providerId: 'openai' })).connectionId;

    // Create real project and session using the session service
    const testDir = join(context.tempProjectDir, 'agent-spawning');
    await fs.mkdir(testDir, { recursive: true });
    testProject = Project.create(
      'Agent Spawning E2E Test Project',
      testDir,
      'Test project for agent spawning E2E testing',
      {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    const createRequest = new Request(
      `http://localhost/api/projects/${testProject.getId()}/sessions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Agent Test Session',
          providerInstanceId: anthropicInstanceId,
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
    await deleteEntTestConnection(anthropicInstanceId);
    await deleteEntTestConnection(openaiInstanceId);

    vi.clearAllMocks();
  });

  describe('POST /api/sessions/{sessionId}/agents', () => {
    it('should spawn agent with real session service using provider instances', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'architect',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-sonnet-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(201);

      const data = await parseResponse<ApiAgent>(response);

      // Verify agent was created with correct properties
      expect(data).toMatchObject({
        name: 'architect',
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-sonnet-20241022',
        status: 'idle',
      });

      expect(data.threadId).toBeTruthy();
    });

    it('should support different provider instances and models', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'openai-agent',
          providerInstanceId: openaiInstanceId,
          modelId: 'gpt-4o',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(201);

      const data = await parseResponse<ApiAgent>(response);
      expect(data.providerInstanceId).toBe(openaiInstanceId);
      expect(data.modelId).toBe('gpt-4o');
      expect(data.name).toBe('openai-agent');
    });

    it('should auto-generate agent name when missing', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(201);

      const data = await parseResponse<ApiAgent>(response);
      expect(data.name).toMatch(/^Agent-\d+$/);
    });

    it('should auto-generate agent name when empty', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(201);

      const data = await parseResponse<ApiAgent>(response);
      expect(data.name).toMatch(/^Agent-\d+$/);
    });

    it('should create unique agent threadIds', async () => {
      // First agent
      const request1 = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent1',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response1 = await POST(createActionArgs(request1, { sessionId: workspaceSessionId }));
      const data1 = await parseResponse<ApiAgent>(response1);

      // Second agent
      const request2 = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent2',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response2 = await POST(createActionArgs(request2, { sessionId: workspaceSessionId }));
      const data2 = await parseResponse<ApiAgent>(response2);
      expect(data2.threadId).not.toBe(data1.threadId);
    });

    it('should return 400 for invalid sessionId format', async () => {
      const request = new Request('http://localhost/api/sessions/invalid-id/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: 'invalid-id' }));
      expect(response.status).toBe(400);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentWorkspaceSessionId = 'ws_00000000-0000-0000-0000-000000000000';
      const request = new Request(
        `http://localhost/api/sessions/${nonExistentWorkspaceSessionId}/agents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'test',
            providerInstanceId: anthropicInstanceId,
            modelId: 'claude-3-5-haiku-20241022',
          }),
        }
      );

      const response = await POST(
        createActionArgs(request, { sessionId: nonExistentWorkspaceSessionId })
      );
      expect(response.status).toBe(404);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Session not found');
    });

    it('should return 400 for missing required fields', async () => {
      // Test missing providerInstanceId
      const request1 = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Provider Instance',
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response1 = await POST(createActionArgs(request1, { sessionId: workspaceSessionId }));
      expect(response1.status).toBe(400);

      const data1 = await parseResponse<ErrorResponse>(response1);
      expect(data1.error).toBe('Invalid request body');

      // Test missing modelId
      const request2 = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Model ID',
          providerInstanceId: anthropicInstanceId,
        }),
      });

      const response2 = await POST(createActionArgs(request2, { sessionId: workspaceSessionId }));
      expect(response2.status).toBe(400);

      const data2 = await parseResponse<ErrorResponse>(response2);
      expect(data2.error).toBe('Invalid request body');
    });

    it('should create agent with non-existent provider instance (validation deferred to runtime)', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Non-existent Instance Agent',
          providerInstanceId: 'non-existent-instance',
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(createActionArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(201);

      const data = await parseResponse<ApiAgent>(response);
      expect(data.name).toBe('Non-existent Instance Agent');
      expect(data.providerInstanceId).toBe('non-existent-instance');
      // Provider validation happens during agent initialization/operation, not at creation time
    });
  });

  describe('GET /api/sessions/{sessionId}/agents', () => {
    it('should list all agents in session', async () => {
      // First spawn an agent
      const spawnRequest = new Request(
        `http://localhost/api/sessions/${workspaceSessionId}/agents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'test-agent',
            providerInstanceId: anthropicInstanceId,
            modelId: 'claude-3-5-haiku-20241022',
          }),
        }
      );

      const spawnResponse = await POST(
        createActionArgs(spawnRequest, { sessionId: workspaceSessionId })
      );
      expect(spawnResponse.status).toBe(201);
      const spawned = await parseResponse<ApiAgent>(spawnResponse);

      // Then list agents
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'GET',
      });

      const response = await GET(createLoaderArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(200);

      const data = await parseResponse<ApiAgent[]>(response);

      // Should have coordinator + spawned agent
      expect(data).toHaveLength(2);

      const spawnedAgent = data.find((a) => a.name === 'test-agent');
      expect(spawnedAgent).toBeDefined();
      expect(spawnedAgent?.threadId).toBe(spawned.threadId);
    });

    it('should include agent threadIds and metadata', async () => {
      const request = new Request(`http://localhost/api/sessions/${workspaceSessionId}/agents`, {
        method: 'GET',
      });

      const response = await GET(createLoaderArgs(request, { sessionId: workspaceSessionId }));
      expect(response.status).toBe(200);

      const data = await parseResponse<ApiAgent[]>(response);

      // Should have at least the coordinator agent
      expect(data.length).toBeGreaterThanOrEqual(1);

      // Each agent should have required fields
      data.forEach((agent) => {
        expect(agent.threadId).toBeDefined();
        expect(agent.name).toBeDefined();
        expect(agent.providerInstanceId).toBeDefined();
        expect(agent.modelId).toBeDefined();
        expect(agent.status).toBeDefined();
      });
    });

    it('should return 400 for invalid session ID format', async () => {
      const request = new Request('http://localhost/api/sessions/invalid-id/agents', {
        method: 'GET',
      });

      const response = await GET(createLoaderArgs(request, { sessionId: 'invalid-id' }));
      expect(response.status).toBe(400);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 for non-existent session', async () => {
      const nonExistentWorkspaceSessionId = 'ws_00000000-0000-0000-0000-000000000000';
      const request = new Request(
        `http://localhost/api/sessions/${nonExistentWorkspaceSessionId}/agents`,
        {
          method: 'GET',
        }
      );

      const response = await GET(
        createLoaderArgs(request, { sessionId: nonExistentWorkspaceSessionId })
      );
      expect(response.status).toBe(404);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Session not found');
    });
  });

  describe('Integration: Workspace session record', () => {
    it('should record spawned agent in supervisor workspace session', async () => {
      const spawnRequest = new Request(
        `http://localhost/api/sessions/${workspaceSessionId}/agents`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'integration-agent',
            providerInstanceId: anthropicInstanceId,
            modelId: 'claude-3-5-sonnet-20241022',
          }),
        }
      );

      const spawnResponse = await POST(
        createActionArgs(spawnRequest, { sessionId: workspaceSessionId })
      );
      expect(spawnResponse.status).toBe(201);

      const spawned = await parseResponse<ApiAgent>(spawnResponse);
      const supervisor = await getSupervisor();
      const record = await supervisor.getWorkspaceSession(workspaceSessionId);
      expect(record).toBeDefined();
      expect(record!.agents.some((a) => a.sessionId === spawned.threadId)).toBe(true);
    });
  });
});
