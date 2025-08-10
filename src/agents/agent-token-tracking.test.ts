// ABOUTME: Tests for agent token tracking from provider responses
// ABOUTME: Verifies that token usage from providers is stored in AGENT_MESSAGE events

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolResult, ToolContext } from '~/tools/types';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalDecision } from '~/tools/approval-types';

// Mock provider for testing token usage tracking
class MockProvider extends BaseMockProvider {
  providerName = 'mock-provider';
  private mockResponse: ProviderResponse;

  constructor(response?: Partial<ProviderResponse>) {
    super({});
    this.mockResponse = {
      content: 'Default response',
      toolCalls: [],
      ...response,
    };
  }

  createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model?: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return Promise.resolve(this.mockResponse);
  }

  get supportsStreaming() {
    return false;
  }
}

describe('Agent token tracking', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: MockProvider;
  let toolExecutor: ToolExecutor;

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    provider = new MockProvider({
      content: 'Test response',
      toolCalls: [],
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    });

    const threadId = threadManager.generateThreadId();
    // Create thread without session ID for simplicity
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      threadManager,
      toolExecutor,
      threadId,
      tools: [],
    });

    // Set model metadata for the agent (required for model-agnostic providers)
    agent.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });
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

        protected executeValidated(
          _args: z.infer<typeof this.schema>,
          context?: ToolContext
        ): Promise<ToolResult> {
          if (context?.signal?.aborted) {
            return Promise.resolve({
              content: [{ type: 'text', text: 'Tool execution aborted' }],
              status: 'aborted' as const,
            });
          }
          return Promise.resolve({
            content: [{ type: 'text', text: 'Tool executed successfully' }],
            status: 'completed' as const,
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

    const events = threadManager.getEvents(agent.threadId);
    const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');

    expect(agentMessage).toBeDefined();
    expect(agentMessage?.data).toHaveProperty('tokenUsage');
    expect(agentMessage?.data.tokenUsage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
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

        protected executeValidated(
          _args: z.infer<typeof this.schema>,
          context?: ToolContext
        ): Promise<ToolResult> {
          if (context?.signal?.aborted) {
            return Promise.resolve({
              content: [{ type: 'text', text: 'Tool execution aborted' }],
              status: 'aborted' as const,
            });
          }
          return Promise.resolve({
            content: [{ type: 'text', text: 'Tool result' }],
            status: 'completed' as const,
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

    const threadId2 = threadManager.generateThreadId();
    threadManager.createThread(threadId2);

    const agentNoUsage = new Agent({
      provider: providerNoUsage,
      threadManager,
      toolExecutor,
      threadId: threadId2,
      tools: [],
    });

    // Set model metadata for the agent
    agentNoUsage.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });

    await agentNoUsage.sendMessage('Hello');

    const events = threadManager.getEvents(agentNoUsage.threadId);
    const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');

    expect(agentMessage).toBeDefined();
    expect(agentMessage?.data.tokenUsage).toBeUndefined();
  });
});
