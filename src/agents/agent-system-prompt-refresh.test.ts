// ABOUTME: Test for system prompt refresh functionality to prevent stale project data
// ABOUTME: Ensures agents regenerate system prompts with correct project context when provider instances are shared

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { TestProvider } from '~/test-utils/test-provider';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import * as promptsModule from '~/config/prompts';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';

describe('Agent System Prompt Refresh', () => {
  const tempLaceDirContext = setupCoreTest(); // Handles temp LACE_DIR + persistence automatically
  let providerInstanceId: string;
  let mockProvider: TestProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let agent: Agent;
  let session: Session;
  let project: Project;
  let mockLoadPromptConfig: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache(); // Important for test isolation
    vi.clearAllMocks();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create real project and session for proper context
    project = Project.create(
      'System Prompt Test Project',
      'Project for system prompt testing',
      tempLaceDirContext.tempDir,
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    session = Session.create({
      name: 'System Prompt Test Session',
      projectId: project.getId(),
    });

    // Mock the loadPromptConfig function to track calls and return different prompts
    mockLoadPromptConfig = vi.fn();
    vi.spyOn(promptsModule, 'loadPromptConfig').mockImplementation(mockLoadPromptConfig);

    mockProvider = new TestProvider({
      mockResponse: 'Test response',
      shouldError: false,
      delay: 10,
    });

    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager();
  });

  afterEach(async () => {
    // Clean up in correct order
    if (agent) {
      agent.removeAllListeners(); // Prevent EventEmitter memory leaks
      agent.stop();
    }
    if (threadManager) {
      threadManager.close();
    }
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
    vi.clearAllMocks();
  });

  function createAgent(): Agent {
    const threadId = threadManager.generateThreadId();
    // Create thread WITH session ID so getFullSession() can find it
    threadManager.createThread(threadId, session.getId());

    return new Agent({
      // Remove provider: mockProvider - now uses lazy creation
      toolExecutor,
      threadManager,
      threadId: threadId,
      tools: [],
      metadata: {
        name: 'Test Agent',
        providerInstanceId: providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
  }

  it('should call loadPromptConfig during initialization with correct context', async () => {
    // Create agent
    agent = createAgent();

    // Mock provider creation BEFORE initialize()
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Mock prompt config responses
    mockLoadPromptConfig.mockResolvedValue({
      systemPrompt: 'Test system prompt',
      userInstructions: 'User instructions',
      filesCreated: [],
    });

    // Spy on setSystemPrompt to track calls
    const setSystemPromptSpy = vi.spyOn(mockProvider, 'setSystemPrompt');

    // Initialize agent - should call loadPromptConfig once with proper session/project context
    await agent.initialize();
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(1);
    expect(mockLoadPromptConfig).toHaveBeenCalledWith({
      tools: [],
      session: expect.anything() as unknown, // Should have session context
      project: expect.anything() as unknown, // Should have project context
    });
    expect(setSystemPromptSpy).toHaveBeenCalledWith('Test system prompt');

    // Clear the spy
    mockLoadPromptConfig.mockClear();
    setSystemPromptSpy.mockClear();

    // Mock createResponse to avoid processing conversation
    vi.spyOn(mockProvider, 'createResponse').mockResolvedValue({
      content: 'Mock response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    // Send a message - should NOT call loadPromptConfig again (no refresh on every message)
    await agent.sendMessage('Test message');

    // Should NOT have called loadPromptConfig again
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(0);
    expect(setSystemPromptSpy).toHaveBeenCalledTimes(0);
  });

  it('should handle system prompt generation errors gracefully during initialization', async () => {
    // Create agent
    agent = createAgent();

    // Mock provider creation BEFORE initialize()
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Mock loadPromptConfig to fail during initialization
    mockLoadPromptConfig.mockRejectedValueOnce(new Error('Failed to load prompt config'));

    // Initialize agent - should handle error gracefully
    await agent.initialize();

    // Should have attempted to load prompt config
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(1);

    // System prompt should still be usable (fallback behavior)
    // Mock createResponse for message processing
    vi.spyOn(mockProvider, 'createResponse').mockResolvedValue({
      content: 'Test response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    // Should be able to send messages even after prompt generation error
    await agent.sendMessage('Test message');
    // Test passes if no exception is thrown
    expect(true).toBe(true);
  });

  it('should generate different system prompts for different project contexts', async () => {
    // Create first agent with first project context
    agent = createAgent();

    // Mock provider creation BEFORE initialize()
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Track project context being passed to loadPromptConfig
    const projectCalls: Array<{ session: string; project: string }> = [];
    mockLoadPromptConfig.mockImplementation(
      (params: { project?: { getId(): string }; session?: { getWorkingDirectory(): string } }) => {
        const projectId = params.project?.getId() || 'none';
        const sessionWorkingDir = params.session?.getWorkingDirectory() || 'none';
        projectCalls.push({ session: sessionWorkingDir, project: projectId });

        return Promise.resolve({
          systemPrompt: `System prompt for project: ${projectId}`,
          userInstructions: 'User instructions',
          filesCreated: [],
        });
      }
    );

    // Initialize first agent
    await agent.initialize();

    expect(mockProvider.systemPrompt).toContain(`System prompt for project: ${project.getId()}`);

    // Verify that loadPromptConfig was called with the correct project context
    expect(projectCalls).toHaveLength(1);
    expect(projectCalls[0]?.project).toBe(project.getId());
    expect(projectCalls[0]?.session).toBe(project.getWorkingDirectory()); // Session working dir matches project working dir

    // Create a second project and session to simulate multi-project scenario
    const project2 = Project.create(
      'Second Test Project',
      'Second project for testing',
      tempLaceDirContext.tempDir + '/project2',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    const session2 = Session.create({
      name: 'Second Test Session',
      projectId: project2.getId(),
    });

    // Create second agent with second project context
    const threadId2 = threadManager.generateThreadId();
    threadManager.createThread(threadId2, session2.getId());

    const agent2 = new Agent({
      // Remove provider: mockProvider - now uses lazy creation
      toolExecutor,
      threadManager,
      threadId: threadId2,
      tools: [],
      metadata: {
        name: 'Second Test Agent',
        providerInstanceId: providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });

    // Mock provider creation for second agent BEFORE initialize()
    vi.spyOn(agent2, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Initialize second agent - should get different system prompt
    await agent2.initialize();
    expect(mockProvider.systemPrompt).toContain(`System prompt for project: ${project2.getId()}`);

    // Verify that loadPromptConfig was called again with different project context
    expect(projectCalls).toHaveLength(2);
    expect(projectCalls[1]?.project).toBe(project2.getId());
    expect(projectCalls[1]?.session).toBe(project2.getWorkingDirectory()); // Session working dir matches project working dir

    // Clean up second agent
    agent2.removeAllListeners();
    agent2.stop();
  });
});
