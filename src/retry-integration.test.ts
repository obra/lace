// ABOUTME: Integration tests for complete retry system functionality
// ABOUTME: Validates that retry components work together correctly

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { AIProvider } from '~/providers/base-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('Retry System Integration Tests', () => {
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager();
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);
  });

  afterEach(() => {
    if (agent) {
      agent.stop();
    }
    // Test cleanup handled by setupCoreTest
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Component integration validation', () => {
    it('should verify retry metrics are properly initialized in turn tracking', async () => {
      // This test verifies that all the retry components are properly wired together
      // by checking that turn metrics include retry tracking structure

      // Use a mock provider to avoid external dependencies
      const mockProvider = {
        providerName: 'mock-integration',
        supportsStreaming: true,
        config: {},
        contextWindow: 100000,
        maxCompletionTokens: 4000,
        setSystemPrompt: vi.fn(),
        countTokens: vi.fn().mockResolvedValue(null),
        cleanup: vi.fn(),

        // Mock successful response without retries
        createResponse: vi.fn((_messages, _tools, _model) =>
          Promise.resolve({
            content: 'Mock response for integration test',
            toolCalls: [],
            stopReason: 'stop',
            usage: {
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
            },
          })
        ),

        createStreamingResponse: vi.fn((_messages, _tools, _model) =>
          Promise.resolve({
            content: 'Mock streaming response',
            toolCalls: [],
            stopReason: 'stop',
            usage: {
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
            },
          })
        ),

        // Mock event emitter methods
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        emit: vi.fn(),
      };

      agent = new Agent({
        provider: mockProvider as unknown as AIProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await agent.start();

      // Set model metadata for the agent (required for model-agnostic providers)
      agent.updateThreadMetadata({
        modelId: 'mock-model',
        providerInstanceId: 'test-instance',
      });

      const turnStartEvents: unknown[] = [];
      const turnCompleteEvents: unknown[] = [];

      agent.on('turn_start', (data) => turnStartEvents.push(data));
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

      await agent.sendMessage('Test retry integration setup');

      // Verify turn events were emitted with retry metrics structure
      expect(turnStartEvents).toHaveLength(1);
      expect(turnCompleteEvents).toHaveLength(1);

      // Check that retry metrics are properly initialized
      const startMetrics = (
        turnStartEvents[0] as {
          metrics: {
            retryMetrics: {
              totalAttempts: number;
              totalDelayMs: number;
              successful: boolean;
              lastError?: unknown;
            };
          };
        }
      ).metrics;
      expect(startMetrics.retryMetrics).toBeDefined();
      expect(startMetrics.retryMetrics.totalAttempts).toBe(0);
      expect(startMetrics.retryMetrics.totalDelayMs).toBe(0);
      expect(startMetrics.retryMetrics.successful).toBe(true);
      expect(startMetrics.retryMetrics.lastError).toBeUndefined();

      // Check that final metrics maintain retry structure
      const finalMetrics = (
        turnCompleteEvents[0] as {
          metrics: { retryMetrics: { totalAttempts: number; successful: boolean } };
        }
      ).metrics;
      expect(finalMetrics.retryMetrics).toBeDefined();
      expect(finalMetrics.retryMetrics.totalAttempts).toBe(0); // No retries occurred
      expect(finalMetrics.retryMetrics.successful).toBe(true);
    });

    it('should verify Agent forwards retry events from providers', async () => {
      // This test verifies that the Agent properly sets up retry event forwarding

      const mockProvider = {
        providerName: 'mock-retry-events',
        supportsStreaming: true,
        config: {},
        contextWindow: 100000,
        maxCompletionTokens: 4000,
        setSystemPrompt: vi.fn(),
        countTokens: vi.fn().mockResolvedValue(null),
        cleanup: vi.fn(),

        createResponse: vi.fn((_messages, _tools, _model) =>
          Promise.resolve({
            content: 'Mock response',
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          })
        ),

        createStreamingResponse: vi.fn((_messages, _tools, _model) =>
          Promise.resolve({
            content: 'Mock response',
            toolCalls: [],
            stopReason: 'stop',
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          })
        ),

        // Track event listener setup
        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        emit: vi.fn(),
      };

      agent = new Agent({
        provider: mockProvider as unknown as AIProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await agent.start();

      // Set model metadata for the agent (required for model-agnostic providers)
      agent.updateThreadMetadata({
        modelId: 'mock-model',
        providerInstanceId: 'test-instance',
      });

      await agent.sendMessage('Test retry event forwarding setup');

      // Verify that the Agent sets up retry event listeners on the provider
      expect(mockProvider.on).toHaveBeenCalledWith('retry_attempt', expect.any(Function));
      expect(mockProvider.on).toHaveBeenCalledWith('retry_exhausted', expect.any(Function));

      // Verify cleanup removes the listeners
      expect(mockProvider.removeListener).toHaveBeenCalledWith(
        'retry_attempt',
        expect.any(Function)
      );
      expect(mockProvider.removeListener).toHaveBeenCalledWith(
        'retry_exhausted',
        expect.any(Function)
      );
    });

    // Terminal interface tests removed - UI no longer exists

    it('should verify all provider tests include retry functionality', async () => {
      // This test validates that all providers have retry test files
      const { promises: fs } = await import('fs');
      const path = await import('path');

      const testDir = path.join(process.cwd(), 'src/providers');
      const files = await fs.readdir(testDir);

      const retryTestFiles = files.filter((file) => file.includes('retry-'));

      // Verify we have retry tests for each major provider
      const expectedProviders = ['anthropic', 'openai', 'lmstudio', 'ollama'];
      expectedProviders.forEach((provider) => {
        const hasRetryTests = retryTestFiles.some((file) => file.includes(provider));
        expect(hasRetryTests).toBe(true);
      });
    });
  });

  describe('Error handling integration', () => {
    it('should verify turn completion occurs even with provider errors', async () => {
      // Test that turn tracking completes properly even when providers fail

      const mockProvider = {
        providerName: 'mock-error',
        supportsStreaming: true,
        config: {},
        contextWindow: 100000,
        maxCompletionTokens: 4000,
        setSystemPrompt: vi.fn(),
        countTokens: vi.fn().mockResolvedValue(null),
        cleanup: vi.fn(),

        // Mock provider that throws an error
        createResponse: vi.fn().mockRejectedValue(new Error('Mock provider error')),
        createStreamingResponse: vi.fn().mockRejectedValue(new Error('Mock provider error')),

        on: vi.fn(),
        off: vi.fn(),
        removeListener: vi.fn(),
        emit: vi.fn(),
      };

      agent = new Agent({
        provider: mockProvider as unknown as AIProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await agent.start();

      const turnStartEvents: unknown[] = [];
      const turnCompleteEvents: unknown[] = [];
      const errorEvents: unknown[] = [];

      agent.on('turn_start', (data) => turnStartEvents.push(data));
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));
      agent.on('error', (data) => errorEvents.push(data));

      await agent.sendMessage('Test error handling');

      // Verify turn tracking works even with errors
      expect(turnStartEvents).toHaveLength(1);
      expect(turnCompleteEvents).toHaveLength(1);
      expect(errorEvents.length).toBeGreaterThan(0);

      // Verify retry metrics are still present
      const finalMetrics = (turnCompleteEvents[0] as { metrics: { retryMetrics: unknown } })
        .metrics;
      expect(finalMetrics.retryMetrics).toBeDefined();
    });
  });
});
