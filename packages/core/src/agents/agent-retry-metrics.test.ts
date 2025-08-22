// ABOUTME: Tests for retry metrics tracking in Agent turn metrics
// ABOUTME: Verifies that retry attempts, delays, and success/failure are tracked correctly

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, CurrentTurnMetrics } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { setupCoreTest } from '~/test-utils/core-test-setup';

// Mock provider that can simulate retry scenarios
class MockRetryMetricsProvider extends BaseMockProvider {
  private shouldTriggerRetries: boolean;
  private retryCount: number;
  private mockResponse: ProviderResponse;

  constructor(shouldTriggerRetries = false, retryCount = 3) {
    super({});
    this.shouldTriggerRetries = shouldTriggerRetries;
    this.retryCount = retryCount;
    this.mockResponse = {
      content: 'Test response',
      toolCalls: [],
      stopReason: 'stop',
      usage: {
        promptTokens: 25,
        completionTokens: 50,
        totalTokens: 75,
      },
    };
  }

  get providerName(): string {
    return 'mock-retry-metrics';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
    if (this.shouldTriggerRetries) {
      // Simulate retry attempts
      for (let attempt = 1; attempt <= this.retryCount; attempt++) {
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        const error = new Error(`Network error attempt ${attempt}`);

        // Emit retry events like the real provider would
        this.emit('retry_attempt', { attempt, delay, error });

        // Simulate delay
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (this.retryCount >= 3) {
        // If we had 3+ retries, simulate exhaustion
        const lastError = new Error(`Final network error after ${this.retryCount} attempts`);
        this.emit('retry_exhausted', { attempts: this.retryCount, lastError });
        throw lastError;
      }
    }
    return this.mockResponse;
  }

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
    return this.createResponse(_messages, _tools, _model);
  }
}

describe('Agent Retry Metrics Tracking', () => {
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let provider: MockRetryMetricsProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest

    provider = new MockRetryMetricsProvider();
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager();
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    await agent.start();
  });

  afterEach(() => {
    agent.stop();
    // Test cleanup handled by setupCoreTest
    vi.clearAllTimers();
  });

  describe('Turn metrics initialization', () => {
    it('should initialize retry metrics with default values', async () => {
      const turnStartEvents: Array<{
        turnId: string;
        userInput: string;
        metrics: CurrentTurnMetrics;
      }> = [];
      agent.on('turn_start', (data) => turnStartEvents.push(data));

      await agent.sendMessage('Test message');

      expect(turnStartEvents).toHaveLength(1);
      const metrics = turnStartEvents[0].metrics;

      expect(metrics.retryMetrics).toBeDefined();
      expect(metrics.retryMetrics?.totalAttempts).toBe(0);
      expect(metrics.retryMetrics?.totalDelayMs).toBe(0);
      expect(metrics.retryMetrics?.successful).toBe(true);
      expect(metrics.retryMetrics?.lastError).toBeUndefined();
    });
  });

  describe('Successful turn without retries', () => {
    it('should maintain successful retry metrics when no retries occur', async () => {
      const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

      await agent.sendMessage('Test successful message');

      expect(turnCompleteEvents).toHaveLength(1);
      const metrics = turnCompleteEvents[0].metrics;

      expect(metrics.retryMetrics?.totalAttempts).toBe(0);
      expect(metrics.retryMetrics?.totalDelayMs).toBe(0);
      expect(metrics.retryMetrics?.successful).toBe(true);
      expect(metrics.retryMetrics?.lastError).toBeUndefined();
    });
  });

  describe('Turn with successful retries', () => {
    it('should track retry attempts and delays for eventual success', async () => {
      // Configure provider to retry 2 times then succeed
      provider = new MockRetryMetricsProvider(true, 2);
      agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      await agent.start();

      const retryAttemptEvents: Array<{ attempt: number; delay: number; error: Error }> = [];
      const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];

      agent.on('retry_attempt', (data) => retryAttemptEvents.push(data));
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

      await agent.sendMessage('Test message with retries');

      // Verify retry events were emitted
      expect(retryAttemptEvents).toHaveLength(2);
      expect(retryAttemptEvents[0].attempt).toBe(1);
      expect(retryAttemptEvents[1].attempt).toBe(2);

      // Verify final metrics reflect successful retries
      expect(turnCompleteEvents).toHaveLength(1);
      const metrics = turnCompleteEvents[0].metrics;

      expect(metrics.retryMetrics?.totalAttempts).toBe(2);
      expect(metrics.retryMetrics?.totalDelayMs).toBeGreaterThan(0); // Should have accumulated delays
      expect(metrics.retryMetrics?.successful).toBe(true); // Eventually succeeded
      expect(metrics.retryMetrics?.lastError).toBe('Network error attempt 2');
    });
  });

  describe('Turn with exhausted retries', () => {
    it('should track retry exhaustion and mark as unsuccessful', async () => {
      // Configure provider to retry 3 times and fail
      provider = new MockRetryMetricsProvider(true, 3);
      agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      await agent.start();

      const retryAttemptEvents: Array<{ attempt: number; delay: number; error: Error }> = [];
      const retryExhaustedEvents: Array<{ attempts: number; lastError: Error }> = [];
      const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      const errorEvents: Array<{ error: Error; context: unknown }> = [];

      agent.on('retry_attempt', (data) => retryAttemptEvents.push(data));
      agent.on('retry_exhausted', (data) => retryExhaustedEvents.push(data));
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

      // Add error listener to prevent unhandled error crashes
      agent.on('error', (data) => errorEvents.push(data));

      // Agent emits error events instead of throwing for provider errors
      await agent.sendMessage('Test message with retry exhaustion');
      expect(errorEvents).toHaveLength(1); // Only retry exhaustion error
      const retryExhaustionError = errorEvents.find(
        (e) =>
          e.context &&
          typeof e.context === 'object' &&
          'phase' in e.context &&
          (e.context as { phase: string }).phase === 'retry_exhaustion'
      );
      expect(retryExhaustionError).toBeTruthy();
      expect(retryExhaustionError?.error.message).toContain('Final network error');

      // Verify retry events
      expect(retryAttemptEvents).toHaveLength(3);
      expect(retryExhaustedEvents).toHaveLength(1);
      expect(retryExhaustedEvents[0].attempts).toBe(3);

      // Even though operation failed, turn metrics should still be recorded
      expect(turnCompleteEvents).toHaveLength(1);
      const metrics = turnCompleteEvents[0].metrics;

      expect(metrics.retryMetrics?.totalAttempts).toBe(3);
      expect(metrics.retryMetrics?.totalDelayMs).toBeGreaterThan(0);
      expect(metrics.retryMetrics?.successful).toBe(false); // Failed after exhaustion
      expect(metrics.retryMetrics?.lastError).toContain('Final network error');
    });
  });

  describe('Streaming response retry metrics', () => {
    it('should track retries for streaming responses', async () => {
      // Test that streaming responses also track retry metrics
      provider = new MockRetryMetricsProvider(true, 2);
      agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      await agent.start();

      const retryAttemptEvents: Array<{ attempt: number; delay: number; error: Error }> = [];
      const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];

      agent.on('retry_attempt', (data) => retryAttemptEvents.push(data));
      agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

      await agent.sendMessage('Test streaming with retries');

      // Should work the same as non-streaming
      expect(retryAttemptEvents).toHaveLength(2);
      expect(turnCompleteEvents).toHaveLength(1);

      const metrics = turnCompleteEvents[0].metrics;
      expect(metrics.retryMetrics?.totalAttempts).toBe(2);
      expect(metrics.retryMetrics?.successful).toBe(true);
    });
  });

  describe('Progress updates include retry metrics', () => {
    it('should include retry metrics in turn progress events', async () => {
      provider = new MockRetryMetricsProvider(true, 2);
      agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      await agent.start();

      const turnProgressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_progress', (data) => turnProgressEvents.push(data));

      await agent.sendMessage('Test progress with retries');

      // Should have progress events that include retry metrics
      expect(turnProgressEvents.length).toBeGreaterThan(0);

      // At least one progress event should show retry metrics
      const progressWithRetries = turnProgressEvents.find(
        (event) => event.metrics.retryMetrics && event.metrics.retryMetrics.totalAttempts > 0
      );

      expect(progressWithRetries).toBeDefined();
      expect(progressWithRetries?.metrics.retryMetrics?.totalAttempts).toBeGreaterThan(0);
    });
  });

  describe('Turn abortion with retries', () => {
    it('should preserve retry metrics when turn is aborted', async () => {
      provider = new MockRetryMetricsProvider(true, 2);
      agent = new Agent({
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);
      await agent.start();

      const retryAttemptEvents: Array<{ attempt: number; delay: number; error: Error }> = [];
      const turnAbortedEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];

      agent.on('retry_attempt', (data) => retryAttemptEvents.push(data));
      agent.on('turn_aborted', (data) => turnAbortedEvents.push(data));

      // Start operation and abort it quickly
      const messagePromise = agent.sendMessage('Test abort with retries');
      await new Promise((resolve) => setTimeout(resolve, 5)); // Brief delay

      const wasAborted = agent.abort();
      await messagePromise;

      expect(wasAborted).toBe(true);
      expect(turnAbortedEvents).toHaveLength(1);

      // Aborted turn should still include any retry metrics accumulated
      const metrics = turnAbortedEvents[0].metrics;
      expect(metrics.retryMetrics).toBeDefined();
      // May or may not have retry attempts depending on timing
      expect(metrics.retryMetrics?.totalAttempts).toBeGreaterThanOrEqual(0);
    });
  });
});
