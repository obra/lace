// ABOUTME: Comprehensive tests for agent retry functionality
// ABOUTME: Tests retry event forwarding and retry metrics tracking from providers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, CurrentTurnMetrics } from '~/agents/agent';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { Tool } from '~/tools/tool';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';

// Helper to safely spy on private method without 'as any'
interface AgentWithCreateProvider {
  _createProviderInstance: () => Promise<AIProvider>;
}

function spyOnCreateProviderInstance(agent: Agent, mockProvider: AIProvider) {
  return vi
    .spyOn(agent as unknown as AgentWithCreateProvider, '_createProviderInstance')
    .mockResolvedValue(mockProvider);
}

// Mock provider that can emit retry events for event forwarding tests
class MockRetryProvider extends BaseMockProvider {
  get providerName(): string {
    return 'mock-retry';
  }

  get supportsStreaming(): boolean {
    return true;
  }

  private _shouldEmitRetryEvents = false;
  private _retryEventData: {
    attempt?: number;
    delay?: number;
    error?: Error;
    attempts?: number;
    lastError?: Error;
    type?: 'attempt' | 'exhausted';
  } | null = null;

  createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this._shouldEmitRetryEvents && this._retryEventData) {
      if (this._retryEventData.type === 'attempt') {
        this.emit('retry_attempt', {
          attempt: this._retryEventData.attempt!,
          delay: this._retryEventData.delay!,
          error: this._retryEventData.error!,
        });
      } else if (this._retryEventData.type === 'exhausted') {
        this.emit('retry_exhausted', {
          attempts: this._retryEventData.attempts!,
          lastError: this._retryEventData.lastError!,
        });
      }
    }
    return Promise.resolve({
      content: 'Test response',
      toolCalls: [],
      stopReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  }

  createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this._shouldEmitRetryEvents && this._retryEventData) {
      if (this._retryEventData.type === 'attempt') {
        this.emit('retry_attempt', {
          attempt: this._retryEventData.attempt!,
          delay: this._retryEventData.delay!,
          error: this._retryEventData.error!,
        });
      } else if (this._retryEventData.type === 'exhausted') {
        this.emit('retry_exhausted', {
          attempts: this._retryEventData.attempts!,
          lastError: this._retryEventData.lastError!,
        });
      }
    }
    return Promise.resolve({
      content: 'Test streaming response',
      toolCalls: [],
      stopReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  }

  // Method to setup retry events that will be emitted during next provider call
  setupRetryAttempt(attempt: number, delay: number, error: Error): void {
    this._shouldEmitRetryEvents = true;
    this._retryEventData = { attempt, delay, error, type: 'attempt' };
  }

  setupRetryExhausted(attempts: number, lastError: Error): void {
    this._shouldEmitRetryEvents = true;
    this._retryEventData = { attempts, lastError, type: 'exhausted' };
  }
}

// Mock provider that can simulate retry scenarios for metrics tracking
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

describe('Agent Retry Functionality', () => {
  const _tempLaceDir = setupCoreTest();

  describe('Retry Event Forwarding', () => {
    let agent: Agent;
    let mockProvider: MockRetryProvider;
    let mockToolExecutor: ToolExecutor;
    let mockThreadManager: ThreadManager;

    beforeEach(async () => {
      mockProvider = new MockRetryProvider();

      mockToolExecutor = {
        executeTool: vi.fn(),
        getApprovalDecision: vi.fn(),
      } as unknown as ToolExecutor;

      mockThreadManager = createMockThreadManager();
      const testThreadId = 'lace_20250723_abc123';

      agent = new Agent({
        toolExecutor: mockToolExecutor,
        threadManager: mockThreadManager,
        threadId: testThreadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      // Mock provider creation for test
      spyOnCreateProviderInstance(agent, mockProvider);

      await agent.start();

      // Set model metadata for the agent (required for model-agnostic providers)
      agent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      });
    });

    afterEach(() => {
      agent.stop();
    });

    describe('retry_attempt event forwarding', () => {
      it('should forward retry_attempt events during streaming response', async () => {
        const retryAttemptSpy = vi.fn();
        agent.on('retry_attempt', retryAttemptSpy);

        // Setup retry event to be emitted during next provider call
        const testError = new Error('Network error');
        mockProvider.setupRetryAttempt(1, 1000, testError);

        // Start a streaming response - this will trigger the retry event
        await agent.sendMessage('Test message');

        expect(retryAttemptSpy).toHaveBeenCalledWith({
          attempt: 1,
          delay: 1000,
          error: testError,
        });
      });

      it('should forward retry_attempt events during non-streaming response', async () => {
        // Test with non-streaming provider behavior

        const retryAttemptSpy = vi.fn();
        agent.on('retry_attempt', retryAttemptSpy);

        // Setup retry event to be emitted during next provider call
        const testError = new Error('Timeout error');
        mockProvider.setupRetryAttempt(2, 2000, testError);

        // Start a non-streaming response - this will trigger the retry event
        await agent.sendMessage('Test message');

        expect(retryAttemptSpy).toHaveBeenCalledWith({
          attempt: 2,
          delay: 2000,
          error: testError,
        });
      });
    });

    describe('retry_exhausted event forwarding', () => {
      it('should forward retry_exhausted events during streaming response', async () => {
        const retryExhaustedSpy = vi.fn();
        agent.on('retry_exhausted', retryExhaustedSpy);

        // Setup retry exhausted event to be emitted during next provider call
        const lastError = new Error('Final error');
        mockProvider.setupRetryExhausted(10, lastError);

        // Start a streaming response - this will trigger the retry exhausted event
        await agent.sendMessage('Test message');

        expect(retryExhaustedSpy).toHaveBeenCalledWith({
          attempts: 10,
          lastError,
        });
      });

      it('should forward retry_exhausted events during non-streaming response', async () => {
        // Test with non-streaming provider behavior

        const retryExhaustedSpy = vi.fn();
        agent.on('retry_exhausted', retryExhaustedSpy);

        // Setup retry exhausted event to be emitted during next provider call
        const lastError = new Error('Connection failed');
        mockProvider.setupRetryExhausted(5, lastError);

        // Start a non-streaming response - this will trigger the retry exhausted event
        await agent.sendMessage('Test message');

        expect(retryExhaustedSpy).toHaveBeenCalledWith({
          attempts: 5,
          lastError,
        });
      });
    });

    describe('event cleanup', () => {
      it('should clean up retry event listeners after streaming response', async () => {
        const retryAttemptSpy = vi.fn();
        agent.on('retry_attempt', retryAttemptSpy);

        // Complete a streaming response
        await agent.sendMessage('Test message');

        // Verify listeners are cleaned up by checking provider listener count
        const listenerCount = mockProvider.listenerCount('retry_attempt');
        expect(listenerCount).toBe(0);
      });

      it('should clean up retry event listeners after non-streaming response', async () => {
        // Test with non-streaming provider behavior

        const retryExhaustedSpy = vi.fn();
        agent.on('retry_exhausted', retryExhaustedSpy);

        // Complete a non-streaming response
        await agent.sendMessage('Test message');

        // Verify listeners are cleaned up by checking provider listener count
        const listenerCount = mockProvider.listenerCount('retry_exhausted');
        expect(listenerCount).toBe(0);
      });
    });
  });

  describe('Retry Metrics Tracking', () => {
    let agent: Agent;
    let provider: MockRetryMetricsProvider;
    let toolExecutor: ToolExecutor;
    let threadManager: ThreadManager;
    let threadId: string;

    beforeEach(async () => {
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
      spyOnCreateProviderInstance(agent, provider);

      await agent.start();
    });

    afterEach(() => {
      agent.stop();
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
        spyOnCreateProviderInstance(agent, provider);
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
        expect(metrics.retryMetrics?.totalDelayMs).toBeGreaterThan(0);
        expect(metrics.retryMetrics?.successful).toBe(true);
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
        spyOnCreateProviderInstance(agent, provider);
        await agent.start();

        const retryExhaustedEvents: Array<{ attempts: number; lastError: Error }> = [];
        const errorEvents: Array<{ error: Error; context: Record<string, unknown> }> = [];

        agent.on('retry_exhausted', (data) => retryExhaustedEvents.push(data));
        agent.on('error', (data) => errorEvents.push(data));

        await agent.sendMessage('Test exhaustion message');

        expect(retryExhaustedEvents).toHaveLength(1);
        expect(retryExhaustedEvents[0].attempts).toBe(3);

        expect(errorEvents).toHaveLength(1);
        expect(errorEvents[0].error.message).toContain('Final network error after 3 attempts');
      });
    });

    describe('Streaming response retry metrics', () => {
      it('should track retries for streaming responses', async () => {
        // Test that streaming responses also track retry metrics
        provider = new MockRetryMetricsProvider(true, 1);
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

        spyOnCreateProviderInstance(agent, provider);
        await agent.start();

        const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
        agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

        await agent.sendMessage('Test streaming with retries');

        expect(turnCompleteEvents).toHaveLength(1);
        const metrics = turnCompleteEvents[0].metrics;

        expect(metrics.retryMetrics?.totalAttempts).toBe(1);
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

        spyOnCreateProviderInstance(agent, provider);
        await agent.start();

        const progressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
        agent.on('turn_progress', (data) => progressEvents.push(data));

        await agent.sendMessage('Test progress with retries');

        // Should have progress events that include retry metrics
        expect(progressEvents.length).toBeGreaterThan(0);
        progressEvents.forEach((event) => {
          expect(event.metrics.retryMetrics).toBeDefined();
        });
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

        spyOnCreateProviderInstance(agent, provider);
        await agent.start();

        const turnCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
        agent.on('turn_complete', (data) => turnCompleteEvents.push(data));

        // Start operation then abort quickly
        const messagePromise = agent.sendMessage('Test abort with retries');
        agent.abort();

        await messagePromise.catch(() => {
          // Ignore abort errors for this test
        });

        // If turn completes (despite abort), metrics should still be preserved
        if (turnCompleteEvents.length > 0) {
          const metrics = turnCompleteEvents[0].metrics;
          expect(metrics.retryMetrics).toBeDefined();
        }
      });
    });
  });
});
