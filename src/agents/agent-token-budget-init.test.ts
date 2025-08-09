// ABOUTME: Tests for Agent auto-initializing token budget from model context window
// ABOUTME: Verifies that Agent properly sets up TokenBudgetManager based on provider's model info

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider, ProviderResponse, ModelInfo, ProviderInfo } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import type { ProviderMessage } from '~/providers/base-provider';

class TestProviderWithModels extends AIProvider {
  get providerName(): string {
    return 'test-provider';
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'test-provider',
      displayName: 'Test Provider',
      requiresApiKey: false,
    };
  }

  getAvailableModels(): ModelInfo[] {
    return [
      {
        id: 'test-model-small',
        displayName: 'Test Model Small',
        contextWindow: 8192,
        maxOutputTokens: 2048,
      },
      {
        id: 'test-model-large',
        displayName: 'Test Model Large',
        contextWindow: 128000,
        maxOutputTokens: 4096,
      },
      {
        id: 'test-model-huge',
        displayName: 'Test Model Huge',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
    ];
  }

  isConfigured(): boolean {
    return true;
  }

  createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'Test response',
      toolCalls: [],
    });
  }
}

describe('Agent Token Budget Auto-Initialization', () => {
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let provider: TestProviderWithModels;
  let cleanupCallbacks: (() => void)[] = [];

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    provider = new TestProviderWithModels({});
  });

  afterEach(() => {
    // Clean up threads properly
    for (const cleanup of cleanupCallbacks) {
      try {
        cleanup();
      } catch (_e) {
        // Ignore cleanup errors
      }
    }
    cleanupCallbacks = [];
  });

  it('should auto-initialize token budget based on model context window', async () => {
    // Create thread with model metadata
    const threadId = threadManager.createThread('test-thread-id');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'test-model-large',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    // Create agent without explicit token budget
    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    // Token budget should not be initialized yet
    expect(agent.tokenBudgetManager).toBeNull();

    // Start the agent - this should trigger auto-initialization
    await agent.start();

    // Token budget should now be initialized
    const tokenBudgetManager = agent.tokenBudgetManager;
    expect(tokenBudgetManager).toBeDefined();
    expect(tokenBudgetManager).not.toBeNull();

    // Check that it was configured with the correct model's context window
    const config = tokenBudgetManager!.config;
    expect(config.maxTokens).toBe(128000); // test-model-large context window
    expect(config.reserveTokens).toBe(2000); // Min of 2000 or 5% (6400)
    expect(config.warningThreshold).toBe(0.8);
  });

  it('should use smaller model context window correctly', async () => {
    // Create thread with small model
    const threadId = threadManager.createThread('test-thread-small');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'test-model-small',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();

    const tokenBudgetManager = agent.tokenBudgetManager;
    expect(tokenBudgetManager).toBeDefined();

    const config = tokenBudgetManager!.config;
    expect(config.maxTokens).toBe(8192); // test-model-small context window
    expect(config.reserveTokens).toBe(Math.floor(8192 * 0.05)); // 5% since it's less than 2000
    expect(config.warningThreshold).toBe(0.8);
  });

  it('should handle huge model context window with proper reserve calculation', async () => {
    // Create thread with huge model
    const threadId = threadManager.createThread('test-thread-huge');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'test-model-huge',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();

    const tokenBudgetManager = agent.tokenBudgetManager;
    expect(tokenBudgetManager).toBeDefined();

    const config = tokenBudgetManager!.config;
    expect(config.maxTokens).toBe(200000); // test-model-huge context window
    expect(config.reserveTokens).toBe(2000); // Capped at 2000 even though 5% would be 10000
    expect(config.warningThreshold).toBe(0.8);
  });

  it('should not initialize token budget if model is unknown', async () => {
    // Create thread without model metadata
    const threadId = threadManager.createThread('test-thread-unknown');
    threadManager.updateThreadMetadata(threadId, {
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();

    // Token budget should remain uninitialized
    expect(agent.tokenBudgetManager).toBeNull();
  });

  it('should not initialize token budget if model not found in provider', async () => {
    // Create thread with non-existent model
    const threadId = threadManager.createThread('test-thread-nonexistent');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'non-existent-model',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    await agent.start();

    // Token budget should remain uninitialized
    expect(agent.tokenBudgetManager).toBeNull();
  });

  it('should respect explicitly provided token budget over auto-initialization', async () => {
    // Create thread with model metadata
    const threadId = threadManager.createThread('test-thread-explicit');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'test-model-large',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    // Create agent WITH explicit token budget
    const customBudget = {
      maxTokens: 50000,
      reserveTokens: 1000,
      warningThreshold: 0.9,
    };

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      tokenBudget: customBudget,
    });

    // Token budget should already be initialized with custom values
    let tokenBudgetManager = agent.tokenBudgetManager;
    expect(tokenBudgetManager).toBeDefined();
    expect(tokenBudgetManager!.config).toEqual(customBudget);

    await agent.start();

    // Should not have changed after start
    tokenBudgetManager = agent.tokenBudgetManager;
    expect(tokenBudgetManager!.config).toEqual(customBudget);
  });

  it('should only initialize token budget once', async () => {
    // Create thread with model metadata
    const threadId = threadManager.createThread('test-thread-once');
    threadManager.updateThreadMetadata(threadId, {
      modelId: 'test-model-large',
      providerInstanceId: 'test-provider-1',
    });
    cleanupCallbacks.push(() => threadManager.deleteThread(threadId));

    const agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    // Start multiple times
    await agent.start();
    const firstManager = agent.tokenBudgetManager;

    // Send a message which might also call start internally
    vi.spyOn(provider, 'createResponse').mockResolvedValueOnce({
      content: 'Response',
      toolCalls: [],
    });

    await agent.sendMessage('test');
    const secondManager = agent.tokenBudgetManager;

    // Should be the same instance
    expect(firstManager).toBe(secondManager);
  });
});
