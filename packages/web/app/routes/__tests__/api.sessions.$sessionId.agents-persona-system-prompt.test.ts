// ABOUTME: Tests to verify persona system prompts are applied correctly
// ABOUTME: Debugs the issue where agents get default Lace prompt instead of persona prompt

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { createActionArgs } from '@/test-utils/route-test-helpers';

// Mock server-only module
vi.mock('server-only', () => ({}));

// Mock external dependencies
vi.mock('@/lib/server/approval-manager', () => ({
  getApprovalManager: () => ({
    requestApproval: vi.fn().mockResolvedValue('allow_once'),
  }),
}));

// Import after mocks
import { action as POST } from '@/app/routes/api.sessions.$sessionId.agents';
import { getSessionService, SessionService } from '@/lib/server/session-service';
import { Project, Session, asThreadId } from '@/lib/server/lace-imports';

describe('Agent Creation - Persona System Prompt Integration', () => {
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
    testProject = Project.create('Test Project', '/test/path', 'Test project for persona testing', {
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
    if (sessionService) {
      sessionService.clearActiveSessions();
    }
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should create agent with default persona when none specified', async () => {
    const requestBody = {
      name: 'Default Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      // No persona specified
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);

    // Get the created agent and check its persona
    const session = await sessionService.getSession(asThreadId(sessionId));
    const agents = session!.getAgents();
    const createdAgent = agents.find((a) => a.name === 'Default Agent');

    expect(createdAgent).toBeDefined();
    // Should default to 'lace' persona
    expect(createdAgent!.persona).toBe('lace');
  });

  it('should create agent with specified persona', async () => {
    const requestBody = {
      name: 'Summary Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'session-summary',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    expect(response.status).toBe(201);

    // Get the created agent and check its persona
    const session = await sessionService.getSession(asThreadId(sessionId));
    const agents = session!.getAgents();
    const createdAgent = agents.find((a) => a.name === 'Summary Agent');

    expect(createdAgent).toBeDefined();
    // Should have the specified persona
    expect(createdAgent!.persona).toBe('session-summary');
  });

  it('should generate different system prompts for different personas', async () => {
    // Create two agents with different personas
    const defaultAgentBody = {
      name: 'Default Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      // No persona (should default to 'lace')
    };

    const summaryAgentBody = {
      name: 'Summary Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'session-summary',
    };

    // Create first agent
    const defaultRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(defaultAgentBody),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(createActionArgs(defaultRequest, { sessionId }));

    // Create second agent
    const summaryRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(summaryAgentBody),
      headers: { 'Content-Type': 'application/json' },
    });
    await POST(createActionArgs(summaryRequest, { sessionId }));

    // Get the created agents
    const session = await sessionService.getSession(asThreadId(sessionId));
    const agents = session!.getAgents();
    const defaultAgent = agents.find((a) => a.name === 'Default Agent');
    const summaryAgent = agents.find((a) => a.name === 'Summary Agent');

    expect(defaultAgent).toBeDefined();
    expect(summaryAgent).toBeDefined();

    // Verify personas are different
    expect(defaultAgent!.persona).toBe('lace');
    expect(summaryAgent!.persona).toBe('session-summary');

    // Initialize both agents to generate their system prompts
    await defaultAgent!.initialize();
    await summaryAgent!.initialize();

    // Get their system prompts from the provider
    type AgentWithProvider = { providerInstance?: { getSystemPrompt(): string } };
    const defaultSystemPrompt = (
      defaultAgent as AgentWithProvider
    ).providerInstance?.getSystemPrompt?.();
    const summarySystemPrompt = (
      summaryAgent as AgentWithProvider
    ).providerInstance?.getSystemPrompt?.();

    expect(defaultSystemPrompt).toBeDefined();
    expect(summarySystemPrompt).toBeDefined();
    expect(defaultSystemPrompt).not.toBe(summarySystemPrompt);

    // Verify the summary agent doesn't have the default Lace prompt
    expect(summarySystemPrompt).not.toContain('You are Lace, an AI coding assistant');
  });

  it('should handle invalid persona gracefully', async () => {
    const requestBody = {
      name: 'Invalid Persona Agent',
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      persona: 'nonexistent-persona',
    };

    const mockRequest = new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(createActionArgs(mockRequest, { sessionId }));

    // Should succeed - agent creation should handle invalid personas gracefully
    expect(response.status).toBe(201);

    const session = await sessionService.getSession(asThreadId(sessionId));
    const agents = session!.getAgents();
    const createdAgent = agents.find((a) => a.name === 'Invalid Persona Agent');

    expect(createdAgent).toBeDefined();
    // Should store the invalid persona (validation happens during prompt generation)
    expect(createdAgent!.persona).toBe('nonexistent-persona');
  });
});
