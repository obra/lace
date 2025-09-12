// ABOUTME: Tests for persona and initial message support in agent creation API
// ABOUTME: Verifies CreateAgentRequest extensions for persona and initialMessage parameters

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';
import { createActionArgs } from '@/test-utils/route-test-helpers';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock only external dependencies
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Import after mocks
import { action as POST } from '@/app/routes/api.sessions.$sessionId.agents';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { Project, Session } from '@/lib/server/lace-imports';

describe('Agent Creation API - Persona and Message Support', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: SessionService;
  let testProject: Project;
  let sessionId: string;
  let providerInstanceId: string;

  beforeEach(async () => {
    // Set up environment
    process.env = {
      ...process.env,
      ANTHROPIC_KEY: 'test-key',
      LACE_DB_PATH: ':memory:',
    };

    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create real project and session
    testProject = Project.create('Test Project', '/test/path', 'Test project for persona support', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    sessionService = getSessionService();
    const sessionInstance = Session.create({
      name: 'Test Session',
      projectId: testProject.getId(),
    });
    const session = sessionInstance.getInfo()!;
    sessionId = session.id as string;
  });

  afterEach(async () => {
    // Clean up agents before tearing down persistence
    if (sessionService) {
      sessionService.clearActiveSessions();
    }

    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should create agent with persona parameter', async () => {
    const requestBody = {
      name: 'Code Review Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'code-reviewer',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));
    const data = await parseResponse(response);

    expect(response.status).toBe(201);
    expect(data).toMatchObject({
      name: 'Code Review Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });

  it('should create agent with initial message', async () => {
    const requestBody = {
      name: 'Helper Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'default',
      initialMessage: 'Hello! Please help me with my project.',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));
    const data = await parseResponse(response);

    expect(response.status).toBe(201);
    expect(data).toMatchObject({
      name: 'Helper Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });

    // Initial message should be sent to the agent
    // We can verify this by checking the agent's conversation history
    // This test documents the expected behavior
  });

  it('should create agent with both persona and initial message', async () => {
    const requestBody = {
      name: 'Full Featured Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'code-reviewer',
      initialMessage: 'Please review my TypeScript code.',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);
  });

  it('should validate persona parameter type', async () => {
    const requestBody = {
      name: 'Test Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 123, // Invalid: should be string
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string }>(response);
    expect(data.error).toContain('Invalid request body');
  });

  it('should validate initialMessage parameter type', async () => {
    const requestBody = {
      name: 'Test Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      initialMessage: 123, // Invalid: should be string
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(400);
    const data = await parseResponse<{ error: string }>(response);
    expect(data.error).toContain('Invalid request body');
  });

  it('should create agent without persona and initial message (backward compatibility)', async () => {
    const requestBody = {
      name: 'Simple Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      // No persona or initialMessage
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);
    const data = await parseResponse(response);
    expect(data).toMatchObject({
      name: 'Simple Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
  });
});
