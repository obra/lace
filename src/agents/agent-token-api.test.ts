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

  get providerName(): string {
    return 'mock-provider';
  }

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
      toolExecutor: new ToolExecutor(),
      threadId: 'test-thread',
      tools: [],
      metadata: {
        name: 'Test Agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId: 'test-provider-instance',
      },
    });

    await agent.start();
  });

  it('should return token usage information', async () => {
    // Initially should be zero
    let usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBe(0);
    expect(usage.totalPromptTokens).toBe(0);
    expect(usage.totalCompletionTokens).toBe(0);
    expect(usage.contextLimit).toBeGreaterThan(0); // Context limit from provider model info
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);

    // Simulate a conversation to generate actual token usage
    await agent.sendMessage('Test message to generate token usage');

    // Should now have token usage calculated from thread events
    usage = agent.getTokenUsage();
    expect(usage.totalTokens).toBeGreaterThan(0);
    expect(usage.totalPromptTokens).toBe(100);
    expect(usage.totalCompletionTokens).toBe(50);
    // Context limit comes from provider model info, percentUsed calculated from that
    expect(usage.contextLimit).toBeGreaterThan(0);
    expect(usage.percentUsed).toBeGreaterThan(0);
    expect(usage.nearLimit).toBe(false);
  });

  it('should calculate token usage directly from thread events', () => {
    // Create agent that uses direct token tracking
    const directAgent = new Agent({
      provider: new MockProvider({ responses: [] }),
      threadManager,
      toolExecutor: new ToolExecutor(),
      threadId: 'test-thread-direct',
      tools: [],
      metadata: {
        name: 'Direct Agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId: 'test-provider-instance',
      },
    });

    const usage = directAgent.getTokenUsage();

    // Should return calculated values from thread events
    expect(usage.totalTokens).toBe(0);
    expect(usage.contextLimit).toBeGreaterThan(0); // From provider model info
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);
  });
});
