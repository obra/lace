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
      provider: mockProvider,
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

  it('should call loadPromptConfig on initialization and message processing', async () => {
    // Create agent
    agent = createAgent();

    // Mock prompt config responses
    mockLoadPromptConfig.mockResolvedValue({
      systemPrompt: 'Test system prompt',
      userInstructions: 'User instructions',
      filesCreated: [],
    });

    // Spy on setSystemPrompt to track calls
    const setSystemPromptSpy = vi.spyOn(mockProvider, 'setSystemPrompt');

    // Initialize agent - should call loadPromptConfig once
    await agent.initialize();
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(1);
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

    // Send a message - should call loadPromptConfig again (refresh)
    await agent.sendMessage('Test message');

    // Should have called loadPromptConfig again for refresh
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(1);
    expect(setSystemPromptSpy).toHaveBeenCalledWith('Test system prompt');
  });

  it('should handle system prompt refresh errors gracefully', async () => {
    // Create agent
    agent = createAgent();

    // Mock successful initialization
    mockLoadPromptConfig.mockResolvedValueOnce({
      systemPrompt: 'Initial system prompt',
      userInstructions: 'User instructions',
      filesCreated: [],
    });

    // Initialize agent successfully
    await agent.initialize();
    expect(mockProvider.systemPrompt).toBe('Initial system prompt');

    // Mock loadPromptConfig to fail on refresh
    mockLoadPromptConfig.mockRejectedValueOnce(new Error('Failed to load prompt config'));

    // Mock createResponse for message processing
    vi.spyOn(mockProvider, 'createResponse').mockResolvedValue({
      content: 'Test response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    // Send message - should handle refresh error gracefully
    await agent.sendMessage('Test message');

    // Should still have the original system prompt (fallback)
    expect(mockProvider.systemPrompt).toBe('Initial system prompt');
  });

  it('should regenerate system prompt with fresh context on each message', async () => {
    // Create agent
    agent = createAgent();

    // Track how many times loadPromptConfig is called with different contexts
    let callCount = 0;
    mockLoadPromptConfig.mockImplementation(({ session, project }) => {
      callCount++;
      return Promise.resolve({
        systemPrompt: `System prompt call ${callCount} - session: ${session ? 'yes' : 'no'}, project: ${project ? 'yes' : 'no'}`,
        userInstructions: 'User instructions',
        filesCreated: [],
      });
    });

    // Initialize agent
    await agent.initialize();
    expect(mockProvider.systemPrompt).toContain('System prompt call 1');

    // Mock createResponse
    vi.spyOn(mockProvider, 'createResponse').mockResolvedValue({
      content: 'Mock response',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    // Send first message - should refresh system prompt
    await agent.sendMessage('First message');
    expect(mockProvider.systemPrompt).toContain('System prompt call 2');

    // Send second message - should refresh system prompt again
    await agent.sendMessage('Second message');
    expect(mockProvider.systemPrompt).toContain('System prompt call 3');

    // Should have called loadPromptConfig 3 times total (1 init + 2 refreshes)
    expect(mockLoadPromptConfig).toHaveBeenCalledTimes(3);
  });
});
