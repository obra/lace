// ABOUTME: Gold-standard test for persona system prompt generation via API
// ABOUTME: Uses mock provider pattern to verify different personas generate different prompts

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
import * as promptsModule from '~/config/prompts';

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
import { Project, Session } from '@/lib/server/lace-imports';
import { asThreadId } from '@/types/core';

describe('Agent Creation API - Persona System Prompt Generation', () => {
  const _tempLaceDir = setupWebTest();
  let sessionService: SessionService;
  let testProject: Project;
  let sessionId: string;
  let providerInstanceId: string;
  let mockLoadPromptConfig: ReturnType<typeof vi.fn>;

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
    testProject = Project.create('Test Project', '/test/path', 'Test project for persona prompts', {
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

    // Mock loadPromptConfig to track persona usage and return different prompts
    mockLoadPromptConfig = vi.fn();
    vi.spyOn(promptsModule, 'loadPromptConfig').mockImplementation(mockLoadPromptConfig);
  });

  afterEach(async () => {
    if (sessionService) {
      sessionService.clearActiveSessions();
    }
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should call loadPromptConfig with correct persona for each agent', async () => {
    // Mock different prompt responses for different personas
    mockLoadPromptConfig
      .mockImplementationOnce(async (options) => {
        expect(options.persona).toBe('lace'); // First agent defaults to lace
        return {
          systemPrompt: 'You are Lace, a pragmatic AI coding partner...',
          userInstructions: '',
          filesCreated: [],
        };
      })
      .mockImplementationOnce(async (options) => {
        expect(options.persona).toBe('session-summary'); // Second agent has specific persona
        return {
          systemPrompt: 'You are a session summarization specialist...',
          userInstructions: '',
          filesCreated: [],
        };
      });

    // Create agent with default persona (should be 'lace')
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
        { sessionId }
      )
    );
    expect(defaultResponse.status).toBe(201);

    // Create agent with session-summary persona
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
        { sessionId }
      )
    );
    expect(summaryResponse.status).toBe(201);

    // Get the session and access the actual Agent instances
    const session = await sessionService.getSession(asThreadId(sessionId));
    const agentInfos = session!.getAgents();
    const defaultAgentInfo = agentInfos.find((a) => a.name === 'Default Agent');
    const summaryAgentInfo = agentInfos.find((a) => a.name === 'Summary Agent');

    expect(defaultAgentInfo).toBeDefined();
    expect(summaryAgentInfo).toBeDefined();
    expect(defaultAgentInfo!.persona).toBe('lace');
    expect(summaryAgentInfo!.persona).toBe('session-summary');

    // Access the actual Agent instances from the session's internal agent map
    // This is the proper way to get Agent instances for testing system prompt generation
    const sessionInternal = session as unknown as {
      _agents: Map<string, { initialize(): Promise<void> }>;
    };
    const defaultAgent = sessionInternal._agents.get(defaultAgentInfo!.threadId);
    const summaryAgent = sessionInternal._agents.get(summaryAgentInfo!.threadId);

    expect(defaultAgent).toBeDefined();
    expect(summaryAgent).toBeDefined();

    // Initialize agents to trigger system prompt generation
    await defaultAgent!.initialize();
    await summaryAgent!.initialize();

    // Verify loadPromptConfig was called with the correct personas
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(2);

    // Verify the personas passed to loadPromptConfig
    expect(mockLoadPromptConfig).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ persona: 'lace' })
    );

    expect(mockLoadPromptConfig).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ persona: 'session-summary' })
    );
  });
});
