// ABOUTME: Tests for Agent.getTokenUsage() public API
// ABOUTME: Ensures agents properly expose their token usage information

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  let threadId: string;

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

    // Create thread properly like the working tests
    threadId = threadManager.createThread();

    agent = new Agent({
      threadManager,
      toolExecutor: new ToolExecutor(),
      threadId,
      tools: [],
      metadata: {
        name: 'Test Agent',
        modelId: 'test-model',
        providerInstanceId: 'test-provider-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    await agent.start();

    // Set model metadata for the agent
    agent.updateThreadMetadata({
      modelId: 'test-model',
    });
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
    // Create another thread for the direct agent
    const directThreadId = threadManager.createThread();

    // Create agent that uses direct token tracking
    const mockProvider = new MockProvider({ responses: [] });
    const directAgent = new Agent({
      threadManager,
      toolExecutor: new ToolExecutor(),
      threadId: directThreadId,
      tools: [],
      metadata: {
        name: 'Direct Agent',
        modelId: 'test-model',
        providerInstanceId: 'test-provider-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(directAgent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

    // Set model metadata for the direct agent
    directAgent.updateThreadMetadata({
      modelId: 'test-model',
    });

    const usage = directAgent.getTokenUsage();

    // Should return calculated values from thread events
    expect(usage.totalTokens).toBe(0);
    expect(usage.contextLimit).toBeGreaterThan(0); // From provider model info
    expect(usage.percentUsed).toBe(0);
    expect(usage.nearLimit).toBe(false);
  });
});
