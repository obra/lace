// ABOUTME: Tests for Agent integration with TokenBudgetManager
// ABOUTME: Verifies token budget tracking, warnings, and request blocking work correctly

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { BudgetStatus, BudgetRecommendations } from '~/token-management/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';

describe('Agent Token Budget Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let session: Session;
  let agent: Agent;
  let project: Project;
  let providerInstanceId: string;
  let mockCreateResponse: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    setupTestProviderDefaults();
    Session.clearProviderCache();

    // Create provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create project with provider configuration and token budget
    project = Project.create('Test Project', '/test/path', 'Test project for token budget', {
      providerInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
      tokenBudget: {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      },
    });

    // Create session
    session = Session.create({
      name: 'Test Session',
      projectId: project.getId(),
    });

    // Get the session's coordinator agent
    // Note: Session doesn't currently pass token budget to agents, so we need to
    // create our own agent with token budget for this test
    const threadManager = new (await import('~/threads/thread-manager')).ThreadManager();
    const toolExecutor = new (await import('~/tools/executor')).ToolExecutor();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId, session.getId());

    const AgentClass = (await import('~/agents/agent')).Agent;
    agent = new AgentClass({
      provider: Session.resolveProviderInstance(providerInstanceId),
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      },
    });

    // Set model metadata
    agent.updateThreadMetadata({
      modelId: 'claude-3-5-haiku-20241022',
      providerInstanceId,
    });

    // Mock the provider's createResponse and createStreamingResponse to control responses for testing
    mockCreateResponse = vi.fn().mockResolvedValue({
      content: 'Default response',
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
    });

    vi.spyOn(agent.providerInstance, 'createResponse').mockImplementation(mockCreateResponse);
    vi.spyOn(agent.providerInstance, 'createStreamingResponse').mockImplementation(
      mockCreateResponse
    );

    await agent.start();
  });

  afterEach(async () => {
    session.destroy();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances([providerInstanceId]);
    vi.clearAllMocks();
  });

  it('should track token usage from provider responses', async () => {
    // Already mocked in beforeEach with default response

    await agent.sendMessage('Hello');

    const budgetStatus = agent.getTokenBudgetStatus();
    expect(budgetStatus).toBeDefined();
    expect(budgetStatus!.totalUsed).toBe(80);
    expect(budgetStatus!.promptTokens).toBe(50);
    expect(budgetStatus!.completionTokens).toBe(30);
  });

  it('should emit warnings when approaching token limits', async () => {
    const warningEvents: {
      message: string;
      usage: BudgetStatus;
      recommendations: BudgetRecommendations;
    }[] = [];
    agent.on('token_budget_warning', (data) => {
      warningEvents.push(data);
    });

    // Set up response that will trigger warning (85% of budget)
    mockCreateResponse.mockResolvedValueOnce({
      content: 'Large response',
      toolCalls: [],
      usage: {
        promptTokens: 500,
        completionTokens: 350,
        totalTokens: 850,
      },
    });

    await agent.sendMessage('Test message');

    expect(warningEvents).toHaveLength(1);
    expect(warningEvents[0].message).toContain('approaching token limit');
    expect(warningEvents[0].usage.totalUsed).toBe(850);
    expect(warningEvents[0].recommendations.shouldSummarize).toBe(true);
  });

  it('should block requests that would exceed token budget', async () => {
    // First, use up most of the budget
    mockCreateResponse.mockResolvedValueOnce({
      content: 'Response using most budget',
      toolCalls: [],
      usage: {
        promptTokens: 600,
        completionTokens: 200,
        totalTokens: 800,
      },
    });

    await agent.sendMessage('First message');

    // Reset mock for second call that should be blocked
    mockCreateResponse.mockResolvedValueOnce({
      content: 'This should not be called',
      toolCalls: [],
      usage: {
        promptTokens: 100,
        completionTokens: 100,
        totalTokens: 200,
      },
    });

    const warningEvents: {
      message: string;
      usage: BudgetStatus;
      recommendations: BudgetRecommendations;
    }[] = [];
    agent.on('token_budget_warning', (data) => {
      warningEvents.push(data);
    });

    // This should be blocked due to budget constraints
    await agent.sendMessage('Second message that would exceed budget');

    // Should have a warning about blocked request
    expect(warningEvents).toHaveLength(1);
    expect(warningEvents[0].message).toContain('Cannot make request: would exceed token budget');

    // Budget should still be at 800, not 1000+ (request was blocked)
    const budgetStatus = agent.getTokenBudgetStatus();
    expect(budgetStatus!.totalUsed).toBe(800);
  });

  it('should provide budget status and recommendations', async () => {
    mockCreateResponse.mockResolvedValueOnce({
      content: 'Response',
      toolCalls: [],
      usage: {
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
      },
    });

    await agent.sendMessage('Test');

    const budgetStatus = agent.getTokenBudgetStatus();
    expect(budgetStatus).toEqual({
      totalUsed: 500,
      maxTokens: 1000,
      availableTokens: 400, // 900 effective - 500 used
      usagePercentage: 0.5,
      warningTriggered: false,
      effectiveLimit: 900,
      promptTokens: 300,
      completionTokens: 200,
    });

    const recommendations = agent.getTokenBudgetRecommendations();
    expect(recommendations).toBeDefined();
    expect(recommendations!.shouldSummarize).toBe(false);
    expect(recommendations!.shouldPrune).toBe(false);
  });

  it('should reset token budget when requested', async () => {
    mockCreateResponse.mockResolvedValueOnce({
      content: 'Response',
      toolCalls: [],
      usage: {
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
      },
    });

    await agent.sendMessage('Test');

    expect(agent.getTokenBudgetStatus()!.totalUsed).toBe(500);

    agent.resetTokenBudget();

    expect(agent.getTokenBudgetStatus()!.totalUsed).toBe(0);
  });

  it('should auto-initialize token budget based on model context window', async () => {
    // Create a new session without explicit token budget config
    const noBudgetProject = Project.create(
      'No Budget Project',
      '/test/no-budget',
      'Project without token budget',
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
        // No tokenBudget config - should auto-initialize
      }
    );

    const noBudgetSession = Session.create({
      name: 'No Budget Session',
      projectId: noBudgetProject.getId(),
    });

    const agentNoBudget = noBudgetSession.getAgent(noBudgetSession.getId())!;

    // Mock the provider's createResponse and createStreamingResponse for this agent
    const mockResponse = {
      content: 'Response',
      toolCalls: [],
      usage: {
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
      },
    };
    vi.spyOn(agentNoBudget.providerInstance, 'createResponse').mockResolvedValueOnce(mockResponse);
    vi.spyOn(agentNoBudget.providerInstance, 'createStreamingResponse').mockResolvedValueOnce(
      mockResponse
    );

    await agentNoBudget.start();

    await agentNoBudget.sendMessage('Test');

    // Agent should have auto-initialized token budget based on model's context window
    const status = agentNoBudget.getTokenBudgetStatus();
    expect(status).toBeDefined();
    expect(status?.maxTokens).toBe(200000); // claude-3-5-haiku-20241022 context window
    expect(status?.totalUsed).toBe(500);

    // Clean up
    noBudgetSession.destroy();
  });

  it('should handle responses without usage data gracefully', async () => {
    mockCreateResponse.mockResolvedValueOnce({
      content: 'Response without usage',
      toolCalls: [],
      // No usage field
    });

    await agent.sendMessage('Test');

    const budgetStatus = agent.getTokenBudgetStatus();
    expect(budgetStatus!.totalUsed).toBe(0);
  });
});
