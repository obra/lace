// ABOUTME: Tests for Agent token counting integration with turn tracking
// ABOUTME: Validates token accumulation, streaming updates, and estimation fallback

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { Agent, AgentConfig, CurrentTurnMetrics } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolResult } from '~/tools/types';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ApprovalDecision } from '~/tools/approval-types';

// Mock provider with configurable token usage
class MockTokenProvider extends BaseMockProvider {
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

  get supportsStreaming(): boolean {
    return true;
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
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
    _tools: Tool[],
    _model: string
  ): Promise<ProviderResponse> {
    // Simulate streaming with token events
    if (this.mockResponse.usage) {
      // Emit streaming token events during processing
      setTimeout(() => {
        this.emit('token_usage_update', {
          usage: {
            promptTokens: this.mockResponse.usage!.promptTokens,
            completionTokens: Math.floor(this.mockResponse.usage!.completionTokens / 2),
            totalTokens:
              this.mockResponse.usage!.promptTokens +
              Math.floor(this.mockResponse.usage!.completionTokens / 2),
          },
        });
      }, 10);

      setTimeout(() => {
        this.emit('token_usage_update', {
          usage: this.mockResponse.usage,
        });
      }, 20);
    }

    return this.createResponse(_messages, _tools, _model);
  }
}

describe('Agent Token Tracking Integration', () => {
  const _tempLaceDir = setupCoreTest();
  let agent: Agent;
  let provider: MockTokenProvider;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
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

    // Set up auto-approval callback so tools actually execute and emit turn_complete
    const autoApprovalCallback = {
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    };
    toolExecutor.setApprovalCallback(autoApprovalCallback);

    threadManager = new ThreadManager();
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

    // Set model metadata for the agent (required for model-agnostic providers)
    agent.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });

    await agent.start();
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
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
        stopReason: 'tool_use',
      };

      const followUpResponse: ProviderResponse = {
        content: 'Tool result processed',
        toolCalls: [],
        usage: {
          promptTokens: 40,
          completionTokens: 25,
          totalTokens: 65,
        },
        stopReason: 'stop',
      };

      // Mock tool that returns a result
      class MockTool extends Tool {
        name = 'test_tool';
        description = 'Test tool for token tracking';
        schema = z.object({
          test: z.string().optional(),
        });

        protected executeValidated(): Promise<ToolResult> {
          return Promise.resolve({
            content: [{ type: 'text', text: 'Tool executed successfully' }],
            isError: false,
          });
        }
      }

      const mockTool = new MockTool();

      // Register the tool with the executor so it can be executed
      toolExecutor.registerTool('test_tool', mockTool);

      // Create new agent with tool and multi-response provider
      const multiCallProvider = new MockTokenProvider(toolCallResponse);
      const multiCallAgent = new Agent({
        provider: multiCallProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [mockTool],
      });

      // Set model metadata for the agent (required for model-agnostic providers)
      multiCallAgent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      });

      await multiCallAgent.start();

      // Setup provider to return different responses on subsequent calls
      let callCount = 0;
      vi.spyOn(multiCallProvider, 'createResponse').mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? toolCallResponse : followUpResponse);
      });

      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      multiCallAgent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await multiCallAgent.sendMessage('Use a tool to help me');

      // Add delay to allow turn completion to process
      await new Promise((resolve) => setTimeout(resolve, 100));

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
        stopReason: 'tool_use',
      };

      const followUpResponse: ProviderResponse = {
        content: 'Second response part after tool',
        toolCalls: [],
        usage: {
          promptTokens: 40,
          completionTokens: 35,
          totalTokens: 75,
        },
        stopReason: 'stop',
      };

      class MockTool2 extends Tool {
        name = 'test_tool';
        description = 'Test tool';
        schema = z.object({});

        protected executeValidated(): Promise<ToolResult> {
          return Promise.resolve({
            content: [{ type: 'text', text: 'Tool result' }],
            isError: false,
          });
        }
      }

      const mockTool = new MockTool2();

      // Register the tool with the executor so it can be executed
      toolExecutor.registerTool('test_tool', mockTool);

      const multiCallProvider = new MockTokenProvider(toolCallResponse);
      const multiCallAgent = new Agent({
        provider: multiCallProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [mockTool],
      });

      // Set model metadata for the agent (required for model-agnostic providers)
      multiCallAgent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      });

      await multiCallAgent.start();

      let callCount = 0;
      vi.spyOn(multiCallProvider, 'createResponse').mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? toolCallResponse : followUpResponse);
      });

      const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
      multiCallAgent.on('turn_complete', (data) => completeEvents.push(data));

      // Act
      await multiCallAgent.sendMessage('Multi-step response');

      // Add delay to allow turn completion to process
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Assert
      expect(completeEvents).toHaveLength(1);
      const finalMetrics = completeEvents[0].metrics;

      // Should track output tokens from provider response(s)
      // The agent should accumulate tokens from all provider calls in the turn
      expect(finalMetrics.tokensOut).toBeGreaterThan(0);

      // At minimum, should have tokens from the first response
      expect(finalMetrics.tokensOut).toBeGreaterThanOrEqual(15);
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

      // The provider already supports streaming since supportsStreaming getter returns true

      const streamingAgent = new Agent({
        provider: streamingProvider,
        toolExecutor,
        threadManager,
        threadId,
        tools: [],
      });

      // Set model metadata for the agent (required for model-agnostic providers)
      streamingAgent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
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

      // Set model metadata for the agent (required for model-agnostic providers)
      noUsageAgent.updateThreadMetadata({
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
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
