// ABOUTME: Tests for Agent.getTokenUsage() public API
// ABOUTME: Ensures agents properly expose their token usage information

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ToolExecutor } from '~/tools/executor';

class MockProvider extends BaseMockProvider {
  private responses: ProviderResponse[];
  private currentIndex = 0;

  constructor(options: { responses: ProviderResponse[] }) {
    super({});
    this.responses = options.responses;
  }

  createResponse(_messages: ProviderMessage[]): Promise<ProviderResponse> {
    if (this.currentIndex < this.responses.length) {
      return Promise.resolve(this.responses[this.currentIndex++]);
    }
    // Default response if we run out
    return Promise.resolve({
      content: 'Default response',
      toolCalls: [],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    });
  }
}

describe('Agent getTokenUsage API', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MockProvider;

  beforeEach(async () => {
    threadManager = new ThreadManager();
    provider = new MockProvider({
      responses: [
        {
          content: 'Test response',
          toolCalls: [],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      ],
    });

    agent = new Agent({
      provider,
      threadManager,
      toolExecutor: new ToolExecutor([]),
      threadId: 'test-thread',
      tools: [],
      tokenBudget: {
        maxTokens: 10000,
        reserveTokens: 1000,
        warningThreshold: 0.8,
      },
      metadata: {
        name: 'Test Agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId: 'test-provider-instance',
      },
    });

    await agent.start();
  });

  it('should return token usage information', () => {
    // Initially should be zero
    let usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBe(0);
    expect(usage.totalPromptTokens).toBe(0);
    expect(usage.totalCompletionTokens).toBe(0);
    expect(usage.contextLimit).toBe(10000);
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);

    // Simulate token usage by directly calling the token budget manager
    expect(agent.tokenBudgetManager).not.toBeNull();
    agent.tokenBudgetManager!.recordUsage({
      content: 'Test response',
      toolCalls: [],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    });

    // Should now have token usage
    usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBe(150);
    expect(usage.totalPromptTokens).toBe(100);
    expect(usage.totalCompletionTokens).toBe(50);
    expect(usage.percentUsed).toBe(1.5); // 150/10000 * 100
    expect(usage.nearLimit).toBe(false);
  });

  it('should handle missing token budget manager', () => {
    // Create agent without token budget
    const agentNoBudget = new Agent({
      provider: new MockProvider({ responses: [] }),
      threadManager,
      toolExecutor: new ToolExecutor([]),
      threadId: 'test-thread-no-budget',
      tools: [],
      // No tokenBudget specified
    });

    const usage = agentNoBudget.getTokenUsage();

    // Should return sensible defaults
    expect(usage.totalTokens).toBe(0);
    expect(usage.contextLimit).toBe(200000); // Default
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);
  });
});
