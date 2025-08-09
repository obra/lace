// ABOUTME: Tests for automatic compaction when approaching token limits
// ABOUTME: Validates auto-compaction triggers and cooldown behavior

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { AIProvider } from '~/providers/base-provider';
import { ToolExecutor } from '~/tools/executor';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import type { ProviderResponse, ProviderMessage } from '~/providers/types';

// Mock provider with configurable responses
class MockAutoCompactProvider extends AIProvider {
  private responses: ProviderResponse[];
  private responseIndex = 0;

  constructor(config: { responses: ProviderResponse[] }) {
    super({
      model: 'test-model',
      maxTokens: 4096,
      systemPrompt: '',
      streaming: false,
    });
    this.responses = config.responses;
  }

  createResponse(
    _messages: ProviderMessage[],
    _tools: unknown[],
    _model: string
  ): Promise<ProviderResponse> {
    if (this.responseIndex < this.responses.length) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const response = this.responses[this.responseIndex];
      this.responseIndex++;
      return Promise.resolve(response);
    }
    return Promise.resolve({
      content: 'Default response',
      toolCalls: [],
    });
  }

  getProviderInfo() {
    return {
      name: 'MockProvider',
      version: '1.0.0',
      capabilities: { streaming: false, functions: true },
    };
  }

  getAvailableModels() {
    return ['test-model'];
  }

  isConfigured() {
    return true;
  }
}

describe('Agent auto-compaction', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockProvider: MockAutoCompactProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
  });

  it('should auto-compact when approaching token limit', async () => {
    // Create provider with high token usage
    mockProvider = new MockAutoCompactProvider({
      responses: [
        {
          content: 'First response that uses lots of tokens',
          usage: {
            promptTokens: 8000,
            completionTokens: 2000,
            totalTokens: 10000, // This will trigger compaction at 80%
          },
        },
      ],
    });

    const threadId = threadManager.createThread();
    agent = new Agent({
      provider: mockProvider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 12000, // Will trigger at 80% = 9600 tokens
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    });

    // Set model metadata
    agent.updateThreadMetadata({
      modelId: 'test-model',
    });

    const compactSpy = vi.spyOn(agent, 'compact');

    // Send message that will use 10k tokens, triggering auto-compaction
    await agent.sendMessage('Test message');

    // Should have triggered compaction
    expect(compactSpy).toHaveBeenCalledWith(agent.threadId);
  });

  it('should not auto-compact when below threshold', async () => {
    mockProvider = new MockAutoCompactProvider({
      responses: [
        {
          content: 'Small response',
          usage: {
            promptTokens: 1000,
            completionTokens: 500,
            totalTokens: 1500, // Well below threshold
          },
        },
      ],
    });

    const threadId = threadManager.createThread();
    agent = new Agent({
      provider: mockProvider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    });

    // Set model metadata
    agent.updateThreadMetadata({
      modelId: 'test-model',
    });

    const compactSpy = vi.spyOn(agent, 'compact');

    await agent.sendMessage('Test message');

    // Should NOT trigger compaction
    expect(compactSpy).not.toHaveBeenCalled();
  });

  it('should respect compaction cooldown period', async () => {
    // Provider that always reports high usage
    mockProvider = new MockAutoCompactProvider({
      responses: [
        {
          content: 'Response 1',
          usage: { promptTokens: 8000, completionTokens: 2000, totalTokens: 10000 },
        },
        {
          content: 'Response 2',
          usage: { promptTokens: 8000, completionTokens: 2000, totalTokens: 10000 },
        },
      ],
    });

    const threadId = threadManager.createThread();
    agent = new Agent({
      provider: mockProvider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    });

    // Set model metadata
    agent.updateThreadMetadata({
      modelId: 'test-model',
    });

    const compactSpy = vi.spyOn(agent, 'compact').mockResolvedValue();

    // First message triggers compaction
    await agent.sendMessage('First message');
    expect(compactSpy).toHaveBeenCalledTimes(1);

    // Second message within cooldown should NOT trigger compaction
    await agent.sendMessage('Second message');
    expect(compactSpy).toHaveBeenCalledTimes(1); // Still just once
  });

  it('should continue conversation even if auto-compaction fails', async () => {
    mockProvider = new MockAutoCompactProvider({
      responses: [
        {
          content: 'Response despite compaction failure',
          usage: { promptTokens: 8000, completionTokens: 2000, totalTokens: 10000 },
        },
      ],
    });

    const threadId = threadManager.createThread();
    agent = new Agent({
      provider: mockProvider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
      tokenBudget: {
        maxTokens: 12000,
        reserveTokens: 1000,
        warningThreshold: 0.7,
      },
    });

    // Set model metadata
    agent.updateThreadMetadata({
      modelId: 'test-model',
    });

    // Make compact throw an error
    vi.spyOn(agent, 'compact').mockRejectedValue(new Error('Compaction failed'));

    // Should not throw - conversation continues
    await expect(agent.sendMessage('Test')).resolves.not.toThrow();

    // Response should still be recorded
    const events = threadManager.getEvents(agent.threadId);
    const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');
    expect(agentMessage).toBeDefined();
    expect(agentMessage?.data).toHaveProperty('content', 'Response despite compaction failure');
  });
});
