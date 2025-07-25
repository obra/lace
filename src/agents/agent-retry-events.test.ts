// ABOUTME: Tests for retry event forwarding in Agent class
// ABOUTME: Verifies that retry events from providers are properly forwarded to Agent listeners

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { Tool } from '~/tools/tool';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { createMockThreadManager } from '~/test-utils/thread-manager-mock';

// Mock provider that can emit retry events
class MockRetryProvider extends BaseMockProvider {
  get providerName(): string {
    return 'mock-retry';
  }

  get defaultModel(): string {
    return 'mock-model';
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
    _tools: Tool[] = [],
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
    _tools: Tool[] = [],
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

describe('Agent retry event forwarding', () => {
  let agent: Agent;
  let mockProvider: MockRetryProvider;
  let mockToolExecutor: ToolExecutor;
  let mockThreadManager: ThreadManager;

  beforeEach(async () => {
    setupTestPersistence();
    mockProvider = new MockRetryProvider({});

    // Mock ToolExecutor

    mockToolExecutor = {
      executeTool: vi.fn(),
      getApprovalDecision: vi.fn(),
    } as unknown as ToolExecutor;

    // Mock ThreadManager
    mockThreadManager = createMockThreadManager();

    const testThreadId = 'lace_20250723_abc123';

    agent = new Agent({
      provider: mockProvider,
      toolExecutor: mockToolExecutor,
      threadManager: mockThreadManager,
      threadId: testThreadId,
      tools: [],
    });

    await agent.start();
  });

  afterEach(() => {
    agent.stop();
    teardownTestPersistence();
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
      // Disable streaming for this test
      mockProvider.config.streaming = false;

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
      // Disable streaming for this test
      mockProvider.config.streaming = false;

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
      // Disable streaming for this test
      mockProvider.config.streaming = false;

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
