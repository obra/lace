// ABOUTME: Tests for Agent integration with TokenBudgetManager
// ABOUTME: Verifies token budget tracking, warnings, and request blocking work correctly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { BudgetStatus, BudgetRecommendations } from '~/token-management/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';

// Mock provider for testing token budget integration
class MockProvider extends BaseMockProvider {
  private mockResponse: ProviderResponse;

  constructor() {
    super({});
    this.mockResponse = {
      content: 'Default response',
      toolCalls: [],
    };
  }

  get providerName(): string {
    return 'mock';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  get supportsStreaming(): boolean {
    return false;
  }

  setNextResponse(response: ProviderResponse): void {
    this.mockResponse = response;
  }

  createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve(this.mockResponse);
  }

  createStreamingResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    return Promise.resolve(this.mockResponse);
  }
}

describe('Agent Token Budget Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let mockProvider: MockProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  const threadId = 'test-thread-budget';

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    mockProvider = new MockProvider();
    toolExecutor = new ToolExecutor();
    toolExecutor.registerAllAvailableTools();
    threadManager = new ThreadManager();
    threadManager.createThread(threadId);

    const config: AgentConfig = {
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 1000,
        warningThreshold: 0.8,
        reserveTokens: 100,
      },
    };

    agent = new Agent(config);
    await agent.start();
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  it('should track token usage from provider responses', async () => {
    mockProvider.setNextResponse({
      content: 'Hello world',
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
    });

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
    mockProvider.setNextResponse({
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
    mockProvider.setNextResponse({
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
    mockProvider.setNextResponse({
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
    mockProvider.setNextResponse({
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
    mockProvider.setNextResponse({
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

  it('should work normally without token budget configuration', async () => {
    // Create thread for this test
    const noBudgetThreadId = 'test-no-budget';
    threadManager.createThread(noBudgetThreadId);

    // Create agent without token budget
    const configWithoutBudget: AgentConfig = {
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: noBudgetThreadId,
      tools: [],
      // No tokenBudget config
    };

    const agentNoBudget = new Agent(configWithoutBudget);
    await agentNoBudget.start();

    mockProvider.setNextResponse({
      content: 'Response',
      toolCalls: [],
      usage: {
        promptTokens: 300,
        completionTokens: 200,
        totalTokens: 500,
      },
    });

    await agentNoBudget.sendMessage('Test');

    // Budget methods should return null when budget tracking is disabled
    expect(agentNoBudget.getTokenBudgetStatus()).toBeNull();
    expect(agentNoBudget.getTokenBudgetRecommendations()).toBeNull();
  });

  it('should handle responses without usage data gracefully', async () => {
    mockProvider.setNextResponse({
      content: 'Response without usage',
      toolCalls: [],
      // No usage field
    });

    await agent.sendMessage('Test');

    const budgetStatus = agent.getTokenBudgetStatus();
    expect(budgetStatus!.totalUsed).toBe(0);
  });
});
