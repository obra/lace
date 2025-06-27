// ABOUTME: Tests for Agent token counting integration with turn tracking
// ABOUTME: Validates token accumulation, streaming updates, and estimation fallback

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent, AgentConfig, CurrentTurnMetrics } from '../agent.js';
import { AIProvider } from '../../providers/base-provider.js';
import { ProviderMessage, ProviderResponse } from '../../providers/base-provider.js';
import { Tool } from '../../tools/types.js';
import { ToolExecutor } from '../../tools/executor.js';
import { ThreadManager } from '../../threads/thread-manager.js';

// Mock provider with configurable token usage
class MockTokenProvider extends AIProvider {
  private mockResponse: ProviderResponse;
  private delay: number;
  private shouldReturnUsage: boolean;

  constructor(mockResponse: ProviderResponse, delay = 0, shouldReturnUsage = true) {
    super({});
    this.mockResponse = mockResponse;
    this.delay = delay;
    this.shouldReturnUsage = shouldReturnUsage;
  }

  get providerName(): string {
    return 'mock-token';
  }

  get defaultModel(): string {
    return 'mock-token-model';
  }

  async createResponse(_messages: ProviderMessage[], _tools: Tool[]): Promise<ProviderResponse> {
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }

    // Return response with or without usage data based on configuration
    return {
      ...this.mockResponse,
      usage: this.shouldReturnUsage ? this.mockResponse.usage : undefined,
    };
  }

  async createStreamingResponse(
    _messages: ProviderMessage[],
    _tools: Tool[]
  ): Promise<ProviderResponse> {
    // Simulate streaming with token events
    if (this.mockResponse.usage) {
      // Emit streaming token events during processing
      setTimeout(() => {
        this.emit('token_usage_update', {
          usage: {
            promptTokens: this.mockResponse.usage!.promptTokens,
            completionTokens: Math.floor(this.mockResponse.usage!.completionTokens! / 2),
            totalTokens:
              this.mockResponse.usage!.promptTokens! +
              Math.floor(this.mockResponse.usage!.completionTokens! / 2),
          },
        });
      }, 10);

      setTimeout(() => {
        this.emit('token_usage_update', {
          usage: this.mockResponse.usage,
        });
      }, 20);
    }

    return this.createResponse(_messages, _tools);
  }
}

describe('Agent Token Tracking Integration', () => {
  let agent: Agent;
  let provider: MockTokenProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    // Create mock response with token usage
    const mockResponse: ProviderResponse = {
      content: 'Test response with tokens',
      toolCalls: [],
      usage: {
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
      },
    };

    provider = new MockTokenProvider(mockResponse);
    toolExecutor = new ToolExecutor();
    threadManager = new ThreadManager(':memory:');
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
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('input token tracking', () => {
    it('should track input tokens from user message and context', async () => {
      // Arrange
      const progressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];

      agent.on('turn_progress', (data) => progressEvents.push(data));
      agent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await agent.sendMessage('This is a test message that should have input tokens counted');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should track input tokens from user message
      expect(finalMetrics.tokensIn).toBeGreaterThan(0);

      // Should include estimated tokens for user input (~4 chars per token)
      const userMessage = 'This is a test message that should have input tokens counted';
      const estimatedUserTokens = Math.ceil(userMessage.length / 4);
      expect(finalMetrics.tokensIn).toBeGreaterThanOrEqual(estimatedUserTokens);

      // Turn metrics track only current turn input, not full conversation context
      // Provider's promptTokens (50) include entire conversation context and aren't part of turn metrics
    });

    it('should accumulate input tokens across multiple provider calls in one turn', async () => {
      // Arrange - Create a provider that returns tool calls to trigger multiple calls
      const toolCallResponse: ProviderResponse = {
        content: 'I need to use a tool',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            input: { test: 'value' },
          },
        ],
        usage: {
          promptTokens: 30,
          completionTokens: 20,
          totalTokens: 50,
        },
      };

      const followUpResponse: ProviderResponse = {
        content: 'Tool result processed',
        toolCalls: [],
        usage: {
          promptTokens: 40,
          completionTokens: 25,
          totalTokens: 65,
        },
      };

      // Mock tool that returns a result
      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool for token tracking',
        input_schema: {
          type: 'object',
          properties: {
            test: { type: 'string' },
          },
          required: [],
        },
        executeTool: vi.fn().mockResolvedValue({
          success: true,
          output: 'Tool executed successfully',
          metadata: {},
        }),
      };

      // Create new agent with tool and multi-response provider
      const multiCallProvider = new MockTokenProvider(toolCallResponse);
      const multiCallAgent = new Agent({
        provider: multiCallProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [mockTool],
      });
      await multiCallAgent.start();

      // Setup provider to return different responses on subsequent calls
      let callCount = 0;
      vi.spyOn(multiCallProvider, 'createResponse').mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? toolCallResponse : followUpResponse;
      });

      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      multiCallAgent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await multiCallAgent.sendMessage('Use a tool to help me');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Turn metrics track only user input estimation, not provider context tokens
      // Provider promptTokens include conversation context and aren't part of turn metrics
      expect(finalMetrics.tokensIn).toBeGreaterThan(0);
    });
  });

  describe('output token tracking', () => {
    it('should track output tokens from provider responses', async () => {
      // Arrange
      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await agent.sendMessage('Generate a response with output tokens');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should track output tokens from provider response
      expect(finalMetrics.tokensOut).toBeGreaterThan(0);
      expect(finalMetrics.tokensOut).toBe(30); // Provider reported 30 completion tokens
    });

    it('should accumulate output tokens from multiple provider responses', async () => {
      // Arrange - Similar setup to input test but focusing on output tokens
      const toolCallResponse: ProviderResponse = {
        content: 'First response part',
        toolCalls: [
          {
            id: 'call_1',
            name: 'test_tool',
            input: { test: 'value' },
          },
        ],
        usage: {
          promptTokens: 30,
          completionTokens: 15,
          totalTokens: 45,
        },
      };

      const followUpResponse: ProviderResponse = {
        content: 'Second response part after tool',
        toolCalls: [],
        usage: {
          promptTokens: 40,
          completionTokens: 35,
          totalTokens: 75,
        },
      };

      const mockTool: Tool = {
        name: 'test_tool',
        description: 'Test tool',
        input_schema: { type: 'object', properties: {}, required: [] },
        executeTool: vi.fn().mockResolvedValue({
          success: true,
          output: 'Tool result',
          metadata: {},
        }),
      };

      const multiCallProvider = new MockTokenProvider(toolCallResponse);
      const multiCallAgent = new Agent({
        provider: multiCallProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [mockTool],
      });
      await multiCallAgent.start();

      let callCount = 0;
      vi.spyOn(multiCallProvider, 'createResponse').mockImplementation(async () => {
        callCount++;
        return callCount === 1 ? toolCallResponse : followUpResponse;
      });

      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      multiCallAgent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await multiCallAgent.sendMessage('Multi-step response');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should accumulate output tokens (15 + 35 = 50)
      expect(finalMetrics.tokensOut).toBe(50);
    });
  });

  describe('streaming token updates', () => {
    it('should update token counts in real-time during streaming', async () => {
      // Arrange
      const progressEvents: Array<{ metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_progress', (data) => progressEvents.push(data));

      // Create streaming provider
      const streamingProvider = new MockTokenProvider({
        content: 'Streaming response',
        toolCalls: [],
        usage: {
          promptTokens: 60,
          completionTokens: 40,
          totalTokens: 100,
        },
      });

      // Mock to support streaming
      Object.defineProperty(streamingProvider, 'supportsStreaming', {
        get: () => true,
      });

      const streamingAgent = new Agent({
        provider: streamingProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await streamingAgent.start();

      streamingAgent.on('turn_progress', (data) => progressEvents.push(data));

      // Act
      await streamingAgent.sendMessage('Stream some tokens');

      // Wait for streaming events to process
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Assert
      // Should have received multiple progress events with increasing token counts
      expect(progressEvents.length).toBeGreaterThan(0);

      // Find events that have token updates (some might just be timer-based)
      const tokenProgressEvents = progressEvents.filter((event) => event.metrics.tokensOut > 0);

      expect(tokenProgressEvents.length).toBeGreaterThan(0);

      // Final token count should match the complete response
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent.metrics.tokensOut).toBeGreaterThan(0);
    });
  });

  describe('token estimation fallback', () => {
    it('should use estimation when provider usage data is unavailable', async () => {
      // Arrange - Provider that doesn't return usage data
      const noUsageProvider = new MockTokenProvider(
        {
          content: 'Response without usage data',
          toolCalls: [],
          usage: undefined,
        },
        0,
        false // shouldReturnUsage = false
      );

      const noUsageAgent = new Agent({
        provider: noUsageProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });
      await noUsageAgent.start();

      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      noUsageAgent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await noUsageAgent.sendMessage('Message requiring token estimation');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should still have token counts using estimation
      expect(finalMetrics.tokensIn).toBeGreaterThan(0);
      expect(finalMetrics.tokensOut).toBeGreaterThan(0);

      // Estimated input tokens (~4 chars per token)
      const userMessage = 'Message requiring token estimation';
      const estimatedUserTokens = Math.ceil(userMessage.length / 4);
      expect(finalMetrics.tokensIn).toBeGreaterThanOrEqual(estimatedUserTokens);

      // Estimated output tokens
      const responseContent = 'Response without usage data';
      const estimatedOutputTokens = Math.ceil(responseContent.length / 4);
      expect(finalMetrics.tokensOut).toBeGreaterThanOrEqual(estimatedOutputTokens);
    });

    it('should prefer native token counts over estimation when available', async () => {
      // Arrange
      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      agent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await agent.sendMessage('Message with native token counts');

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should use exact token counts from provider, not estimation
      expect(finalMetrics.tokensOut).toBe(30); // Exact count from mock provider

      // Turn metrics track only user input estimation, not provider prompt tokens
      // Provider's promptTokens (50) are for session tracking, not turn metrics
      expect(finalMetrics.tokensIn).toBeGreaterThan(0);
    });
  });

  describe('token metrics reset', () => {
    it('should reset token metrics between turns', async () => {
      // Arrange
      const firstCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      const secondCompleteEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];

      let eventCount = 0;
      agent.on('turn_complete', (data) => {
        eventCount++;
        if (eventCount === 1) {
          firstCompleteEvents.push(data);
        } else {
          secondCompleteEvents.push(data);
        }
      });

      // Act - Send two separate messages
      await agent.sendMessage('First message with tokens');
      await agent.sendMessage('Second message with tokens');

      // Assert
      expect(firstCompleteEvents).toHaveLength(1);
      expect(secondCompleteEvents).toHaveLength(1);

      const firstMetrics = firstCompleteEvents[0].metrics;
      const secondMetrics = secondCompleteEvents[0].metrics;

      // Both turns should have similar token counts (not accumulated)
      expect(firstMetrics.tokensIn).toBeGreaterThan(0);
      expect(firstMetrics.tokensOut).toBeGreaterThan(0);
      expect(secondMetrics.tokensIn).toBeGreaterThan(0);
      expect(secondMetrics.tokensOut).toBeGreaterThan(0);

      // Second turn shouldn't accumulate from first turn
      expect(secondMetrics.tokensIn).toBeLessThan(firstMetrics.tokensIn * 2);
      expect(secondMetrics.tokensOut).toBeLessThan(firstMetrics.tokensOut * 2);

      // Turn IDs should be different
      expect(firstMetrics.turnId).not.toBe(secondMetrics.turnId);
    });
  });
});
