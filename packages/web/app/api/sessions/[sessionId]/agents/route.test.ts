// ABOUTME: E2E tests for agent spawning API endpoints using real services
// ABOUTME: Tests full agent spawning workflow from API calls to real session management

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { setupTestProviderInstances, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import { parseResponse } from '@/lib/serialization';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock only external dependencies, not core functionality
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Import the real API route handlers after mocks
import { POST, GET } from '@/app/api/sessions/[sessionId]/agents/route';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { Project } from '@/lib/server/lace-imports';
import type { AgentInfo } from '@/types/core';
import type { ThreadId } from '@/types/core';

// Response types
interface AgentResponse {
  agent: AgentInfo;
}

interface AgentsListResponse {
  agents: AgentInfo[];
}

interface ErrorResponse {
  error: string;
}

// Note: parseResponse is imported from @/lib/serialization

describe('Agent Spawning API E2E Tests', () => {
  let sessionService: SessionService;
  let testProject: Project;
  let sessionId: string;
  let anthropicInstanceId: string;
  let openaiInstanceId: string;
  let createdInstanceIds: string[] = [];

  beforeEach(async () => {
    setupTestPersistence();

    // Set up environment for session service
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      OPENAI_API_KEY: 'test-openai-key',
      LACE_DB_PATH: ':memory:',
    };

    // Create test provider instances
    const instances = await setupTestProviderInstances();
    anthropicInstanceId = instances.anthropicInstanceId;
    openaiInstanceId = instances.openaiInstanceId;
    createdInstanceIds = [anthropicInstanceId, openaiInstanceId];

    // Create real project and session using the session service
    testProject = Project.create(
      'Agent Spawning E2E Test Project',
      '/test/path',
      'Test project for agent spawning E2E testing',
      {}
    );

    sessionService = getSessionService();
    const session = await sessionService.createSession(
      'Agent Test Session',
      anthropicInstanceId,
      'claude-3-5-sonnet-20241022',
      testProject.getId()
    );
    sessionId = session.id as string;
  });

  afterEach(async () => {
    // Clean up agents before tearing down persistence
    if (sessionService) {
      await sessionService.stopAllAgents();
      sessionService.clearActiveSessions();
    }
    
    // Cleanup test provider instances
    if (createdInstanceIds.length > 0) {
      await cleanupTestProviderInstances(createdInstanceIds);
    }
    
    teardownTestPersistence();
  });

  describe('POST /api/sessions/{sessionId}/agents', () => {
    it('should spawn agent with real session service using provider instances', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'architect',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-sonnet-20241022',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const data = await parseResponse<AgentResponse>(response);

      // Verify agent was created with correct properties
      expect(data.agent).toMatchObject({
        name: 'architect',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        status: 'idle',
      });

      // ThreadId should follow sessionId.N pattern
      expect(data.agent.threadId).toMatch(new RegExp(`^${sessionId}\\.\\d+$`));
    });

    it('should support different provider instances and models', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'openai-agent',
          providerInstanceId: openaiInstanceId,
          modelId: 'gpt-4o',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const data = await parseResponse<AgentResponse>(response);
      expect(data.agent.provider).toBe('openai');
      expect(data.agent.model).toBe('gpt-4o');
      expect(data.agent.name).toBe('openai-agent');
    });

    it('should auto-generate agent name when missing', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const data = await parseResponse<AgentResponse>(response);
      expect(data.agent.name).toBe('Lace'); // Default name
    });

    it('should auto-generate agent name when empty', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(201);

      const data = await parseResponse<AgentResponse>(response);
      expect(data.agent.name).toBe('Lace'); // Default name for empty string
    });

    it('should increment agent threadIds sequentially', async () => {
      // First agent
      const request1 = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent1',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response1 = await POST(request1, { params: Promise.resolve({ sessionId }) });
      const data1 = await parseResponse<AgentResponse>(response1);

      // Should be .1 since session already has a coordinator at .0
      expect(data1.agent.threadId).toBe(`${sessionId}.1`);

      // Second agent
      const request2 = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'agent2',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response2 = await POST(request2, { params: Promise.resolve({ sessionId }) });
      const data2 = await parseResponse<AgentResponse>(response2);
      expect(data2.agent.threadId).toBe(`${sessionId}.2`);
    });

    it('should return 400 for invalid sessionId format', async () => {
      const request = new NextRequest('http://localhost/api/sessions/invalid-id/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(request, {
        params: Promise.resolve({ sessionId: 'invalid-id' }),
      });
      expect(response.status).toBe(400);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 for non-existent session', async () => {
      // Use valid ThreadId format but non-existent session
      const nonExistentSessionId = 'lace_20250101_abc999';
      const request = new NextRequest(
        `http://localhost/api/sessions/${nonExistentSessionId}/agents`,
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

      const response = await POST(request, {
        params: Promise.resolve({ sessionId: nonExistentSessionId }),
      });
      expect(response.status).toBe(404);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Session not found');
    });

    it('should return 400 for missing required fields', async () => {
      // Test missing providerInstanceId
      const request1 = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Provider Instance',
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response1 = await POST(request1, { params: Promise.resolve({ sessionId }) });
      expect(response1.status).toBe(400);

      const data1 = await parseResponse<ErrorResponse>(response1);
      expect(data1.error).toBe('Invalid request body');

      // Test missing modelId
      const request2 = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Missing Model ID',
          providerInstanceId: anthropicInstanceId,
        }),
      });

      const response2 = await POST(request2, { params: Promise.resolve({ sessionId }) });
      expect(response2.status).toBe(400);

      const data2 = await parseResponse<ErrorResponse>(response2);
      expect(data2.error).toBe('Invalid request body');
    });

    it('should return 400 for non-existent provider instance', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Non-existent Instance Agent',
          providerInstanceId: 'non-existent-instance',
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      const response = await POST(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(400);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe("Provider instance 'non-existent-instance' not found");
    });
  });

  describe('GET /api/sessions/{sessionId}/agents', () => {
    it('should list all agents in session', async () => {
      // First spawn an agent
      const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-agent',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-haiku-20241022',
        }),
      });

      await POST(spawnRequest, { params: Promise.resolve({ sessionId }) });

      // Then list agents
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'GET',
      });

      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(200);

      const data = await parseResponse<AgentsListResponse>(response);

      // Should have coordinator (id .0) + spawned agent (id .1)
      expect(data.agents).toHaveLength(2);

      const spawnedAgent = data.agents.find((a) => a.name === 'test-agent');
      expect(spawnedAgent).toBeDefined();
      expect(spawnedAgent?.threadId).toBe(`${sessionId}.1`);
    });

    it('should include agent threadIds and metadata', async () => {
      const request = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'GET',
      });

      const response = await GET(request, { params: Promise.resolve({ sessionId }) });
      expect(response.status).toBe(200);

      const data = await parseResponse<AgentsListResponse>(response);

      // Should have at least the coordinator agent
      expect(data.agents.length).toBeGreaterThanOrEqual(1);

      // Each agent should have required fields
      data.agents.forEach((agent) => {
        expect(agent.threadId).toBeDefined();
        expect(agent.name).toBeDefined();
        expect(agent.provider).toBeDefined();
        expect(agent.model).toBeDefined();
        expect(agent.status).toBeDefined();
      });
    });

    it('should return 400 for invalid session ID format', async () => {
      const request = new NextRequest('http://localhost/api/sessions/invalid-id/agents', {
        method: 'GET',
      });

      const response = await GET(request, { params: Promise.resolve({ sessionId: 'invalid-id' }) });
      expect(response.status).toBe(400);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Invalid session ID');
    });

    it('should return 404 for non-existent session', async () => {
      // Use valid ThreadId format but non-existent session
      const nonExistentSessionId = 'lace_20250101_abc999';
      const request = new NextRequest(
        `http://localhost/api/sessions/${nonExistentSessionId}/agents`,
        {
          method: 'GET',
        }
      );

      const response = await GET(request, {
        params: Promise.resolve({ sessionId: nonExistentSessionId }),
      });
      expect(response.status).toBe(404);

      const data = await parseResponse<ErrorResponse>(response);
      expect(data.error).toBe('Session not found');
    });
  });

  describe('Integration: Real Session and Agent Management', () => {
    it('should properly integrate with session service', async () => {
      // Spawn agent via API
      const spawnRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'integration-agent',
          providerInstanceId: anthropicInstanceId,
          modelId: 'claude-3-5-sonnet-20241022',
        }),
      });

      const spawnResponse = await POST(spawnRequest, { params: Promise.resolve({ sessionId }) });
      expect(spawnResponse.status).toBe(201);

      const spawnData = await parseResponse<AgentResponse>(spawnResponse);
      const agentThreadId = spawnData.agent.threadId;

      // Verify agent exists in session service
      const session = await sessionService.getSession(sessionId as ThreadId);
      expect(session).toBeDefined();

      const agents = session!.getAgents();
      const createdAgent = agents.find((a) => a.threadId === agentThreadId);
      expect(createdAgent).toBeDefined();
      expect(createdAgent!.name).toBe('integration-agent');

      // Verify via API as well
      const listRequest = new NextRequest(`http://localhost/api/sessions/${sessionId}/agents`, {
        method: 'GET',
      });

      const listResponse = await GET(listRequest, { params: Promise.resolve({ sessionId }) });
      const listData = await parseResponse<AgentsListResponse>(listResponse);

      const apiAgent = listData.agents.find((a) => a.threadId === agentThreadId);
      expect(apiAgent).toBeDefined();
      expect(apiAgent!.name).toBe('integration-agent');
    });
  });
});