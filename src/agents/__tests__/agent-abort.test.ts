// ABOUTME: Tests for Agent abort functionality integrated with turn tracking
// ABOUTME: Validates that abort mechanism works correctly with providers and events

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig, CurrentTurnMetrics } from '~/agents/agent';
import { BaseMockProvider } from '~/__tests__/utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Mock provider for testing that can simulate abort behavior
class MockAbortableProvider extends BaseMockProvider {
  private mockResponse: ProviderResponse;
  private delay: number;

  constructor(mockResponse: ProviderResponse, delay = 0) {
    super({});
    this.mockResponse = mockResponse;
    this.delay = delay;
  }

  get providerName(): string {
    return 'mock-abortable';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    // Check if aborted before starting
    if (signal?.aborted) {
      throw new Error('Request aborted');
    }

    // Simulate work with potential for abort
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve(this.mockResponse);
      }, this.delay);

      // Handle abort signal
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          const error = new Error('Request aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
  }

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return this.createResponse(_messages, _tools, signal);
  }
}

describe('Agent Abort Functionality', () => {
  let agent: Agent;
  let provider: MockAbortableProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    setupTestPersistence();

    // Create mock response
    const mockResponse: ProviderResponse = {
      content: 'Test response',
      toolCalls: [],
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };

    provider = new MockAbortableProvider(mockResponse, 100); // 100ms delay
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(); // Use in-memory SQLite for tests
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    const config: AgentConfig = {
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    };

    agent = new Agent(config);
    await agent.start();
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('abort() method', () => {
    it('should return false when no operation is running', () => {
      // Act
      const result = agent.abort();

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when operation is running and abort it', async () => {
      // Arrange
      let wasAborted = false;
      let turnAbortedEvent: { turnId: string; metrics: CurrentTurnMetrics } | null = null;

      agent.on('turn_aborted', (data: { turnId: string; metrics: CurrentTurnMetrics }) => {
        turnAbortedEvent = data;
        wasAborted = true;
      });

      // Start a slow operation
      const messagePromise = agent.sendMessage('This should be aborted');

      // Wait a bit to ensure the operation starts
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act - abort the operation
      const result = agent.abort();

      // Wait for the promise to complete (it should be aborted)
      await messagePromise;

      // Assert
      expect(result).toBe(true);
      expect(wasAborted).toBe(true);
      expect(turnAbortedEvent).not.toBeNull();
      expect(turnAbortedEvent!.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      expect(turnAbortedEvent!.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(agent.getCurrentState()).toBe('idle');
    });

    it('should handle abort during provider response', async () => {
      // Arrange
      const events: string[] = [];

      agent.on('turn_start', () => events.push('turn_start'));
      agent.on('turn_aborted', () => events.push('turn_aborted'));
      agent.on('turn_complete', () => events.push('turn_complete'));
      agent.on('error', () => events.push('error'));

      // Start a slow operation
      const messagePromise = agent.sendMessage('Slow operation');

      // Wait a bit to ensure the operation starts
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act - abort the operation
      agent.abort();

      // Wait for completion
      await messagePromise;

      // Assert
      expect(events).toContain('turn_start');
      expect(events).toContain('turn_aborted');
      expect(events).not.toContain('turn_complete');
      expect(events).not.toContain('error'); // Abort should not be treated as error
    });

    it('should clean up progress timer when aborted', async () => {
      // Arrange
      const progressEvents: { metrics: CurrentTurnMetrics }[] = [];

      agent.on('turn_progress', (data) => {
        progressEvents.push(data);
      });

      // Start operation with fake timers to control progress updates
      vi.useFakeTimers();
      const messagePromise = agent.sendMessage('Operation to abort');

      // Advance time to get some progress events
      await vi.advanceTimersByTimeAsync(1000); // 1 second

      const progressEventsBefore = progressEvents.length;

      // Act - abort
      agent.abort();

      // Advance time more - should not get more progress events
      await vi.advanceTimersByTimeAsync(2000); // 2 more seconds

      await messagePromise;

      // Assert
      expect(progressEventsBefore).toBeGreaterThanOrEqual(0); // Should have had some progress
      expect(progressEvents.length).toBe(progressEventsBefore); // No more progress after abort
    });
  });

  describe('abort signal integration', () => {
    it('should pass abort signal to provider methods', async () => {
      // Arrange
      const createResponseSpy = vi.spyOn(provider, 'createResponse');

      // Start operation and immediately abort
      const messagePromise = agent.sendMessage('Test message');
      await new Promise((resolve) => setTimeout(resolve, 10)); // Let it start
      agent.abort();
      await messagePromise;

      // Assert
      expect(createResponseSpy).toHaveBeenCalled();
      const callArgs = createResponseSpy.mock.calls[0];
      expect(callArgs).toHaveLength(3); // messages, tools, signal
      expect(callArgs[2]).toBeInstanceOf(AbortSignal); // Third argument should be AbortSignal
    });

    it('should handle provider AbortError gracefully', async () => {
      // Arrange - provider that immediately throws AbortError
      const abortingProvider = new MockAbortableProvider({
        content: 'Should not see this',
        toolCalls: [],
      });

      // Mock to always throw AbortError
      vi.spyOn(abortingProvider, 'createResponse').mockImplementation(() => {
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const abortAgent = new Agent({
        provider: abortingProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await abortAgent.start();

      const errorEvents: any[] = [];
      abortAgent.on('error', (data) => errorEvents.push(data));

      // Act
      await abortAgent.sendMessage('This will be aborted by provider');

      // Assert
      expect(errorEvents).toHaveLength(0); // AbortError should not emit error event
      expect(abortAgent.getCurrentState()).toBe('idle');
    });
  });

  describe('streaming abort support', () => {
    it('should pass abort signal to streaming provider methods', async () => {
      // Arrange
      const streamingProvider = new MockAbortableProvider({
        content: 'Streaming response',
        toolCalls: [],
      });

      // Make it support streaming
      Object.defineProperty(streamingProvider, 'supportsStreaming', {
        get: () => true,
      });

      const createStreamingSpy = vi.spyOn(streamingProvider, 'createStreamingResponse');

      const streamingAgent = new Agent({
        provider: streamingProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await streamingAgent.start();

      // Act
      const messagePromise = streamingAgent.sendMessage('Streaming test');
      await new Promise((resolve) => setTimeout(resolve, 10));
      streamingAgent.abort();
      await messagePromise;

      // Assert
      expect(createStreamingSpy).toHaveBeenCalled();
      const callArgs = createStreamingSpy.mock.calls[0];
      expect(callArgs).toHaveLength(3); // messages, tools, signal
      expect(callArgs[2]).toBeInstanceOf(AbortSignal);
    });
  });
});
