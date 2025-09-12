// ABOUTME: Tests for initial message flow in agent creation
// ABOUTME: Verifies timing and behavior of sending initial messages to newly created agents

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

describe('Agent Creation - Initial Message Flow', () => {
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
    testProject = Project.create('Test Project', '/test/path', 'Test project for message flow', {
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

  it('should create agent without message when no initialMessage provided', async () => {
    const requestBody = {
      name: 'Idle Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'default',
      // No initialMessage
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

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
      persona: 'default',
      initialMessage: 'Hello! Please help me get started.',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

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
      persona: 'default',
      initialMessage: '   ', // Whitespace only
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);

    // Should succeed - whitespace-only messages are trimmed and ignored
  });

  it('should handle initial message with just whitespace', async () => {
    const requestBody = {
      name: 'Whitespace Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'default',
      initialMessage: '', // Empty string
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

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
      persona: 'default',
      initialMessage: 'Test message for resilience',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

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

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);

    // Should work - persona is optional, message sending should still work
  });
});
