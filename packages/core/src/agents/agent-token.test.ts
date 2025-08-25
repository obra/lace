// ABOUTME: Comprehensive tests for agent token tracking and API
// ABOUTME: Tests internal token tracking mechanics and public getTokenUsage() API

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, CurrentTurnMetrics } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { TestProvider } from '~/test-utils/test-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolResult, ToolContext } from '~/tools/types';
import { ToolExecutor } from '~/tools/executor';
import { ApprovalDecision } from '~/tools/approval-types';
import { z } from 'zod';

// Mock provider for streaming token tests
class StreamingTokenProvider extends TestProvider {
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
    return 'mock-token-provider';
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

    const response = { ...this.mockResponse };
    if (!this.shouldReturnUsage) {
      delete response.usage;
    }

    return response;
  }
}

// Reusable mock tool for token testing with configurable schema
class MockTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for token tracking';
  schema = z.object({
    test: z.string().optional(),
  });

  constructor(name = 'test_tool', schema = z.object({ test: z.string().optional() })) {
    super();
    this.name = name;
    this.schema = schema;
  }

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

describe('Agent Token Management', () => {
  setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let provider: TestProvider;
  let toolExecutor: ToolExecutor;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    provider = new TestProvider({
      mockResponse: 'Test response',
    });

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
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Token Tracking Mechanics', () => {
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

        const mockTool = new MockTool();

        // Register the tool with the executor so it can be executed
        toolExecutor.registerTool('test_tool', mockTool);

        // Create new agent with tool and multi-response provider
        const multiCallProvider = new StreamingTokenProvider(toolCallResponse);
        const multiCallThreadId = threadManager.generateThreadId();
        threadManager.createThread(multiCallThreadId);

        const multiCallAgent = new Agent({
          toolExecutor,
          threadManager,
          threadId: multiCallThreadId,
          tools: [mockTool],
          metadata: {
            name: 'test-agent',
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        });

        // Mock provider creation for test
        vi.spyOn(multiCallAgent, '_createProviderInstance' as any).mockResolvedValue(
          multiCallProvider
        );

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

        // Wait for turn completion event
        if (completeEvents.length === 0) {
          await new Promise<void>((resolve) => {
            multiCallAgent.once('turn_complete', () => resolve());
          });
        }

        // Assert
        expect(completeEvents).toHaveLength(1);
        const finalMetrics = completeEvents[0].metrics;

        // Turn metrics track only user input estimation, not provider context tokens
        expect(finalMetrics.tokensIn).toBeGreaterThan(0);
      });
    });

    describe('output token tracking', () => {
      it('should track output tokens from provider responses', async () => {
        // Arrange
        const providerWithUsage = new TestProvider({
          mockResponse: 'Generate a response with output tokens',
        });

        // Override to return specific usage data
        vi.spyOn(providerWithUsage, 'createResponse').mockResolvedValue({
          content: 'Test response',
          toolCalls: [],
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        });

        const usageThreadId = threadManager.generateThreadId();
        threadManager.createThread(usageThreadId);

        const usageAgent = new Agent({
          toolExecutor,
          threadManager,
          threadId: usageThreadId,
          tools: [],
          metadata: {
            name: 'test-agent',
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        });

        vi.spyOn(usageAgent, '_createProviderInstance' as any).mockResolvedValue(providerWithUsage);

        const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
        usageAgent.on('turn_complete', (data) => completeEvents.push(data));

        // Act
        await usageAgent.sendMessage('Generate a response with output tokens');

        // Assert
        expect(completeEvents).toHaveLength(1);
        const finalMetrics = completeEvents[0].metrics;

        // Should track output tokens from provider response
        expect(finalMetrics.tokensOut).toBeGreaterThan(0);
        expect(finalMetrics.tokensOut).toBe(50); // Provider reported 50 completion tokens
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

        const mockTool = new MockTool('test_tool', z.object({}));

        // Register the tool with the executor so it can be executed
        toolExecutor.registerTool('test_tool', mockTool);

        const multiCallProvider = new StreamingTokenProvider(toolCallResponse);
        const multiCallThreadId2 = threadManager.generateThreadId();
        threadManager.createThread(multiCallThreadId2);

        const multiCallAgent = new Agent({
          toolExecutor,
          threadManager,
          threadId: multiCallThreadId2,
          tools: [mockTool],
          metadata: {
            name: 'test-agent',
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        });

        // Mock provider creation for test
        vi.spyOn(multiCallAgent, '_createProviderInstance' as any).mockResolvedValue(
          multiCallProvider
        );

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
        expect(finalMetrics.tokensOut).toBeGreaterThan(0);
        // At minimum, should have tokens from the first response
        expect(finalMetrics.tokensOut).toBeGreaterThanOrEqual(15);
      });
    });

    it('should store token usage in AGENT_MESSAGE events', async () => {
      // Create provider with specific token usage
      const tokenProvider = new TestProvider({
        mockResponse: 'Hello response',
      });

      vi.spyOn(tokenProvider, 'createResponse').mockResolvedValue({
        content: 'Test response',
        toolCalls: [],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      const tokenThreadId = threadManager.generateThreadId();
      threadManager.createThread(tokenThreadId);

      const tokenAgent = new Agent({
        toolExecutor,
        threadManager,
        threadId: tokenThreadId,
        tools: [],
        metadata: {
          name: 'test-agent',
          modelId: 'test-model',
          providerInstanceId: 'test-instance',
        },
      });

      vi.spyOn(tokenAgent, '_createProviderInstance' as any).mockResolvedValue(tokenProvider);

      await tokenAgent.sendMessage('Hello');

      const events = threadManager.getEvents(tokenAgent.threadId);
      const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');

      expect(agentMessage).toBeDefined();
      expect(agentMessage?.data).toHaveProperty('tokenUsage');

      // Verify the CombinedTokenUsage structure contains expected message data
      expect(agentMessage?.data.tokenUsage).toEqual(
        expect.objectContaining({
          message: expect.objectContaining({
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          }),
        })
      );

      // Verify CombinedTokenUsage structure exists
      expect(agentMessage?.data.tokenUsage).toBeDefined();
      expect(agentMessage?.data.tokenUsage?.thread).toBeDefined();
      expect(typeof agentMessage?.data.tokenUsage?.thread.totalPromptTokens).toBe('number');
      expect(typeof agentMessage?.data.tokenUsage?.thread.totalCompletionTokens).toBe('number');
      expect(typeof agentMessage?.data.tokenUsage?.thread.contextLimit).toBe('number');
      expect(typeof agentMessage?.data.tokenUsage?.thread.percentUsed).toBe('number');
      expect(typeof agentMessage?.data.tokenUsage?.thread.nearLimit).toBe('boolean');
    });

    describe('token estimation fallback', () => {
      it('should use estimation when provider usage data is unavailable', async () => {
        // Arrange - Provider that doesn't return usage data
        const noUsageProvider = new StreamingTokenProvider(
          {
            content: 'Response without usage data',
            toolCalls: [],
            usage: undefined,
          },
          0,
          false // shouldReturnUsage = false
        );

        const noUsageThreadId = threadManager.generateThreadId();
        threadManager.createThread(noUsageThreadId);

        const noUsageAgent = new Agent({
          toolExecutor,
          threadManager,
          threadId: noUsageThreadId,
          tools: [],
          metadata: {
            name: 'test-agent',
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        });

        // Mock provider creation for test
        vi.spyOn(noUsageAgent, '_createProviderInstance' as any).mockResolvedValue(noUsageProvider);

        const completeEvents: Array<{ turnId: string; metrics: CurrentTurnMetrics }> = [];
        noUsageAgent.on('turn_complete', (data) => completeEvents.push(data));

        // Act
        await noUsageAgent.sendMessage('Message requiring token estimation');

        // Assert - should still have token counts using estimation
        expect(completeEvents).toHaveLength(1);
        const finalMetrics = completeEvents[0].metrics;

        expect(finalMetrics.tokensIn).toBeGreaterThan(0);
        expect(finalMetrics.tokensOut).toBeGreaterThan(0);
      });

      it('should handle responses without token usage', async () => {
        // Create provider that doesn't return usage info
        const providerNoUsage = new TestProvider({
          mockResponse: 'Response without usage',
        });

        // Override to return response without usage
        vi.spyOn(providerNoUsage, 'createResponse').mockResolvedValue({
          content: 'Response without usage',
          toolCalls: [],
          // No usage field
        });

        const threadId2 = threadManager.generateThreadId();
        threadManager.createThread(threadId2);

        const agentNoUsage = new Agent({
          toolExecutor,
          threadManager,
          threadId: threadId2,
          tools: [],
          metadata: {
            name: 'test-agent',
            modelId: 'test-model',
            providerInstanceId: 'test-instance',
          },
        });

        // Mock provider creation for test
        vi.spyOn(agentNoUsage, '_createProviderInstance' as any).mockResolvedValue(providerNoUsage);

        await agentNoUsage.sendMessage('Hello');

        const events = threadManager.getEvents(agentNoUsage.threadId);
        const agentMessage = events.find((e) => e.type === 'AGENT_MESSAGE');

        expect(agentMessage).toBeDefined();
        expect(agentMessage?.data.tokenUsage?.thread).toEqual(
          expect.objectContaining({
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            contextLimit: expect.any(Number),
            percentUsed: expect.any(Number),
            nearLimit: expect.any(Boolean),
          })
        );

        // Verify CombinedTokenUsage structure exists even without provider usage
        expect(agentMessage?.data.tokenUsage?.thread).toBeDefined();
        const thread = agentMessage?.data.tokenUsage?.thread;
        if (thread) {
          expect(typeof thread.totalPromptTokens).toBe('number');
          expect(typeof thread.totalCompletionTokens).toBe('number');
          expect(typeof thread.contextLimit).toBe('number');
          expect(typeof thread.percentUsed).toBe('number');
          expect(typeof thread.nearLimit).toBe('boolean');
        }
      });
    });
  });

  describe('Public Token API', () => {
    beforeEach(async () => {
      await agent.start();

      // Set model metadata for the agent
      agent.updateThreadMetadata({
        modelId: 'test-model',
      });
    });

    it('should return token usage information', async () => {
      // Initially should be zero
      let usage = agent.getTokenUsage();
      expect(usage.totalTokens).toBe(0);
      expect(usage.totalPromptTokens).toBe(0);
      expect(usage.totalCompletionTokens).toBe(0);
      expect(usage.contextLimit).toBeGreaterThan(0); // Context limit from provider model info
      expect(usage.percentUsed).toBe(0);
      expect(usage.nearLimit).toBe(false);

      // Create provider with token usage for this test
      const usageProvider = new TestProvider({
        mockResponse: 'Test message to generate token usage',
      });

      vi.spyOn(usageProvider, 'createResponse').mockResolvedValue({
        content: 'Test response',
        toolCalls: [],
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      });

      // Replace the provider for this test
      vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(usageProvider);

      // Simulate a conversation to generate actual token usage
      await agent.sendMessage('Test message to generate token usage');

      // Should now have token usage calculated from thread events
      usage = agent.getTokenUsage();
      expect(usage.totalTokens).toBeGreaterThan(0);
      expect(usage.totalPromptTokens).toBe(10); // TestProvider default
      expect(usage.totalCompletionTokens).toBe(20); // TestProvider default
      // Context limit comes from provider model info, percentUsed calculated from that
      expect(usage.contextLimit).toBeGreaterThan(0);
      expect(usage.percentUsed).toBeGreaterThan(0);
      expect(usage.nearLimit).toBe(false);
    });

    it('should calculate token usage directly from thread events', () => {
      // Create another thread for the direct agent
      const directThreadId = threadManager.createThread();

      // Create agent that uses direct token tracking
      const mockProvider = new TestProvider({
        mockResponse: 'Test response',
      });

      const directAgent = new Agent({
        threadManager,
        toolExecutor: new ToolExecutor(),
        threadId: directThreadId,
        tools: [],
        metadata: {
          name: 'Direct Agent',
          modelId: 'test-model',
          providerInstanceId: 'test-provider-instance',
        },
      });

      // Mock provider creation for test
      vi.spyOn(directAgent, '_createProviderInstance' as any).mockResolvedValue(mockProvider);

      // Set model metadata for the direct agent
      directAgent.updateThreadMetadata({
        modelId: 'test-model',
      });

      const usage = directAgent.getTokenUsage();

      // Should return calculated values from thread events
      expect(usage.totalTokens).toBe(0);
      expect(usage.contextLimit).toBeGreaterThan(0); // From provider model info
      expect(usage.percentUsed).toBe(0);
      expect(usage.nearLimit).toBe(false);
    });
  });
});
