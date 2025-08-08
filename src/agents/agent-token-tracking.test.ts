// ABOUTME: Tests for agent token tracking from provider responses
// ABOUTME: Verifies that token usage from providers is stored in AGENT_MESSAGE events

import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
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

  it('should store token usage in AGENT_MESSAGE events', async () => {
    await agent.sendMessage('Hello');

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

  it('should handle responses without token usage', async () => {
    // Create provider that doesn't return usage info
    const providerNoUsage = new MockProvider({
      content: 'Response without usage',
      toolCalls: [],
      // No usage field
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
