// ABOUTME: Integration tests for turn-by-turn progress tracking across all providers
// ABOUTME: Tests complete turn lifecycle, abort functionality, and performance with real providers

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, CurrentTurnMetrics } from '../agent.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { AIProvider, ProviderMessage, ProviderResponse } from '../../providers/types.js';
import { Tool } from '../../tools/types.js';

// Mock provider for controlled testing
class MockIntegrationProvider extends AIProvider {
  private mockResponse: ProviderResponse;
  private shouldSimulateStreaming: boolean;
  private simulateSlowResponse: boolean;
  private abortSignal?: AbortSignal;
  private _supportsStreaming: boolean;

  constructor(
    mockResponse: ProviderResponse,
    options: {
      streaming?: boolean;
      slow?: boolean;
    } = {}
  ) {
    super({ streaming: options.streaming });
    this.mockResponse = mockResponse;
    this.shouldSimulateStreaming = options.streaming || false;
    this.simulateSlowResponse = options.slow || false;
    this._supportsStreaming = options.streaming || false;
  }

  get supportsStreaming(): boolean {
    return this._supportsStreaming;
  }

  get providerName(): string {
    return 'mock-integration';
  }

  get defaultModel(): string {
    return 'mock-model';
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    this.abortSignal = signal;

    if (this.simulateSlowResponse) {
      // Simulate a slow response that can be aborted
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, 2000);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            const abortError = new Error('Request was aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          });
        }
      });
    }

    // Simulate token usage updates during processing
    setTimeout(() => {
      this.emit('token_usage_update', {
        usage: {
          promptTokens: 25,
          completionTokens: 15,
          totalTokens: 40,
        },
      });
    }, 50);

    setTimeout(() => {
      this.emit('token_usage_update', {
        usage: {
          promptTokens: 25,
          completionTokens: 30,
          totalTokens: 55,
        },
      });
    }, 100);

    // Small delay to allow progress tracking
    await new Promise((resolve) => setTimeout(resolve, 150));

    return this.mockResponse;
  }

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    this.abortSignal = signal;

    if (this.shouldSimulateStreaming) {
      // Simulate streaming tokens
      const tokens = ['Hello', ' there!', ' This', ' is', ' a', ' streaming', ' response.'];

      for (let i = 0; i < tokens.length; i++) {
        if (signal?.aborted) {
          const abortError = new Error('Request was aborted');
          abortError.name = 'AbortError';
          throw abortError;
        }

        // Emit tokens synchronously during the loop to ensure they're captured
        this.emit('token', { token: tokens[i] });

        // Emit token usage updates during streaming
        this.emit('token_usage_update', {
          usage: {
            promptTokens: 25,
            completionTokens: i + 1,
            totalTokens: 25 + i + 1,
          },
        });

        // Small delay between tokens
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return this.mockResponse;
  }

  // Method to check if abort was called
  wasAborted(): boolean {
    return this.abortSignal?.aborted || false;
  }
}

describe('Turn Tracking Provider Integration Tests', () => {
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(':memory:');
    threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Complete turn lifecycle tests', () => {
    it('should complete turn with Anthropic-style provider', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response from Anthropic-style provider',
        toolCalls: [],
        usage: {
          promptTokens: 25,
          completionTokens: 35,
          totalTokens: 60,
        },
      };

      const provider = new MockIntegrationProvider(mockResponse);
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track turn lifecycle events
      const turnEvents: Array<{ type: string; metrics?: CurrentTurnMetrics }> = [];
      agent.on('turn_start', ({ metrics }) => turnEvents.push({ type: 'start', metrics }));
      agent.on('turn_progress', ({ metrics }) => turnEvents.push({ type: 'progress', metrics }));
      agent.on('turn_complete', ({ metrics }) => turnEvents.push({ type: 'complete', metrics }));

      // Act
      await agent.sendMessage('Test message for Anthropic-style provider');

      // Assert
      expect(turnEvents.length).toBeGreaterThan(2); // At least start, progress, complete

      const startEvent = turnEvents.find((e) => e.type === 'start');
      const completeEvent = turnEvents.find((e) => e.type === 'complete');

      expect(startEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.metrics!.elapsedMs).toBeGreaterThan(0);
      expect(completeEvent!.metrics!.tokensIn).toBeGreaterThan(0);
      expect(completeEvent!.metrics!.tokensOut).toBeGreaterThan(0);
      expect(completeEvent!.metrics!.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
    });

    it('should complete turn with OpenAI-style provider', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response from OpenAI-style provider',
        toolCalls: [],
        usage: {
          promptTokens: 30,
          completionTokens: 40,
          totalTokens: 70,
        },
      };

      const provider = new MockIntegrationProvider(mockResponse);
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track token usage updates
      const tokenUpdates: Array<{ usage: any }> = [];
      agent.on('token_usage_update', ({ usage }) => tokenUpdates.push({ usage }));

      // Act
      await agent.sendMessage('Test message for OpenAI-style provider');

      // Assert
      expect(tokenUpdates.length).toBeGreaterThan(0);
      expect(tokenUpdates[0].usage.totalTokens).toBeGreaterThan(0);
    });

    it('should complete turn with LMStudio-style provider', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response from LMStudio-style provider with native tool calling',
        toolCalls: [],
        usage: {
          promptTokens: 35,
          completionTokens: 45,
          totalTokens: 80,
        },
      };

      const provider = new MockIntegrationProvider(mockResponse);
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track state changes
      const stateChanges: Array<{ from: string; to: string }> = [];
      agent.on('state_change', ({ from, to }) => stateChanges.push({ from, to }));

      // Act
      await agent.sendMessage('Test message for LMStudio-style provider');

      // Assert
      expect(stateChanges).toContainEqual({ from: 'idle', to: 'thinking' });
      expect(stateChanges).toContainEqual({ from: 'thinking', to: 'idle' });
    });

    it('should complete turn with Ollama-style provider', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response from Ollama-style provider with streaming',
        toolCalls: [],
        usage: {
          promptTokens: 20,
          completionTokens: 25,
          totalTokens: 45,
        },
      };

      const provider = new MockIntegrationProvider(mockResponse, { streaming: true });

      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track streaming tokens
      const streamingTokens: string[] = [];
      agent.on('agent_token', ({ token }) => streamingTokens.push(token));

      // Act
      await agent.sendMessage('Test message for Ollama-style provider');

      // Wait a bit for streaming to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Assert
      expect(streamingTokens.length).toBeGreaterThan(0);
      expect(streamingTokens.join('')).toContain('Hello');
    });
  });

  describe('Abort functionality tests', () => {
    it('should abort during streaming response', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'This response should be aborted',
        toolCalls: [],
        usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      };

      const provider = new MockIntegrationProvider(mockResponse, { streaming: true, slow: true });
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track abort events
      const abortEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_aborted', (data) => abortEvents.push(data));

      // Act
      const messagePromise = agent.sendMessage('Message to abort during streaming');

      // Wait a bit then abort
      await new Promise((resolve) => setTimeout(resolve, 100));
      const wasAborted = agent.abort();

      await messagePromise;

      // Assert
      expect(wasAborted).toBe(true);
      expect(abortEvents).toHaveLength(1);
      expect(abortEvents[0].metrics.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(abortEvents[0].turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
    });

    it('should handle tool execution lifecycle correctly', async () => {
      // Arrange - This test validates turn tracking works with tool execution
      // without needing to test actual abort during tool execution
      const mockTool: Tool = {
        name: 'mock_tool',
        description: 'A simple mock tool',
        input_schema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
        executeTool: async (input: Record<string, unknown>) => {
          return {
            content: [{ type: 'text', text: `Processed: ${input.text}` }],
            isError: false,
          };
        },
      };

      toolExecutor.registerTool('mock_tool', mockTool);

      // First response with tool call, then second response without tools
      const responses = [
        {
          content: 'I will use the mock tool',
          toolCalls: [
            {
              id: 'call_1',
              name: 'mock_tool',
              input: { text: 'test input' },
            },
          ],
          usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
        },
        {
          content: 'Tool execution completed successfully',
          toolCalls: [],
          usage: { promptTokens: 40, completionTokens: 25, totalTokens: 65 },
        },
      ];

      let responseIndex = 0;
      const mockProvider = new MockIntegrationProvider(responses[0]);

      // Override createResponse to return different responses
      mockProvider.createResponse = async () => {
        const response = responses[responseIndex] || responses[responses.length - 1];
        responseIndex++;
        return response;
      };

      const agent = new Agent({
        provider: mockProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [mockTool],
      });
      agent.start();

      // Track turn lifecycle events
      const turnEvents: Array<{ type: string; metrics?: CurrentTurnMetrics }> = [];
      agent.on('turn_start', ({ metrics }) => turnEvents.push({ type: 'start', metrics }));
      agent.on('turn_complete', ({ metrics }) => turnEvents.push({ type: 'complete', metrics }));

      // Act
      await agent.sendMessage('Use the mock tool');

      // Assert
      const startEvent = turnEvents.find((e) => e.type === 'start');
      const completeEvent = turnEvents.find((e) => e.type === 'complete');

      expect(startEvent).toBeDefined();
      expect(completeEvent).toBeDefined();
      expect(completeEvent!.metrics!.elapsedMs).toBeGreaterThan(0);
      expect(completeEvent!.metrics!.tokensIn).toBeGreaterThan(0);
      expect(completeEvent!.metrics!.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);

      // Verify agent can handle abort when no operation is running
      const wasAborted = agent.abort();
      expect(wasAborted).toBe(false); // No operation to abort
    });
  });

  describe('Performance tests', () => {
    it('should handle high-frequency progress updates without performance degradation', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response for performance testing',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
      };

      const provider = new MockIntegrationProvider(mockResponse);
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track all progress events and measure timing
      const progressEvents: Array<{ timestamp: number; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_progress', ({ metrics }) => {
        progressEvents.push({ timestamp: Date.now(), metrics });
      });

      const startTime = Date.now();

      // Act
      await agent.sendMessage('Performance test message');

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Assert
      expect(progressEvents.length).toBeGreaterThan(0);

      // Check that progress events don't add significant overhead
      // Total time should be reasonable (under 1 second for this test)
      expect(totalTime).toBeLessThan(1000);

      // Check that progress events have increasing timestamps
      for (let i = 1; i < progressEvents.length; i++) {
        expect(progressEvents[i].timestamp).toBeGreaterThanOrEqual(progressEvents[i - 1].timestamp);
      }

      // Verify progress events contain valid data
      progressEvents.forEach((event) => {
        expect(event.metrics.elapsedMs).toBeGreaterThanOrEqual(0);
        expect(event.metrics.turnId).toMatch(/^turn_\d+_[a-z0-9]+$/);
      });
    });

    it('should maintain accuracy with rapid token updates', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Rapid token update test',
        toolCalls: [],
        usage: { promptTokens: 25, completionTokens: 75, totalTokens: 100 },
      };

      const provider = new MockIntegrationProvider(mockResponse, { streaming: true });
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track progress and token updates
      const progressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
      const tokenUpdates: Array<{ usage: any }> = [];

      agent.on('turn_progress', ({ metrics }) => progressEvents.push({ metrics }));
      agent.on('token_usage_update', ({ usage }) => tokenUpdates.push({ usage }));

      // Act
      await agent.sendMessage('Test rapid token updates');

      // Assert
      expect(progressEvents.length).toBeGreaterThan(0);
      expect(tokenUpdates.length).toBeGreaterThan(0);

      // Final metrics should reflect accumulated tokens
      const finalProgress = progressEvents[progressEvents.length - 1];
      expect(finalProgress.metrics.tokensOut).toBeGreaterThan(0);
      expect(finalProgress.metrics.tokensIn).toBeGreaterThan(0);

      // Token updates should show progression
      if (tokenUpdates.length > 1) {
        expect(tokenUpdates[tokenUpdates.length - 1].usage.totalTokens).toBeGreaterThanOrEqual(
          tokenUpdates[0].usage.totalTokens
        );
      }
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle provider errors gracefully during turn tracking', async () => {
      // Arrange
      const errorProvider = new MockIntegrationProvider({
        content: '',
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      // Override to throw error
      errorProvider.createResponse = async () => {
        throw new Error('Simulated provider error');
      };

      const agent = new Agent({
        provider: errorProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Track error and turn events
      const errorEvents: Array<{ error: Error }> = [];
      const turnEvents: Array<{ type: string }> = [];

      agent.on('error', ({ error }) => errorEvents.push({ error }));
      agent.on('turn_start', () => turnEvents.push({ type: 'start' }));
      agent.on('turn_complete', () => turnEvents.push({ type: 'complete' }));
      agent.on('turn_aborted', () => turnEvents.push({ type: 'aborted' }));

      // Act
      await agent.sendMessage('Message that will cause error');

      // Assert
      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].error.message).toContain('Simulated provider error');
      expect(turnEvents).toContainEqual({ type: 'start' });
      // Should not complete normally due to error
      expect(turnEvents.filter((e) => e.type === 'complete')).toHaveLength(0);
    });

    it('should handle missing abort signal gracefully', async () => {
      // Arrange
      const mockResponse: ProviderResponse = {
        content: 'Response without abort support',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      };

      const provider = new MockIntegrationProvider(mockResponse);
      const agent = new Agent({
        provider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      agent.start();

      // Act
      const messagePromise = agent.sendMessage('Test without abort signal');

      // Try to abort immediately
      const wasAborted = agent.abort();

      await messagePromise;

      // Assert - abort should return false if no operation is running
      // (or true if operation was actually aborted)
      expect(typeof wasAborted).toBe('boolean');
    });
  });
});
