// ABOUTME: Tests for Agent tool abort functionality
// ABOUTME: Validates that tool execution can be cancelled mid-execution

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent, AgentConfig } from '~/agents/agent';
import { BaseMockProvider } from '~/test-utils/base-mock-provider';
import { MockSlowTool } from '~/test-utils/mock-slow-tool';
import { BashTool } from '~/tools/implementations/bash';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolCall } from '~/tools/types';
import { ToolExecutor } from '~/tools/executor';
import { ThreadManager } from '~/threads/thread-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { ApprovalDecision } from '~/tools/approval-types';

class MockProviderWithTools extends BaseMockProvider {
  private mockToolCalls: ToolCall[];

  constructor(mockToolCalls: ToolCall[]) {
    super({});
    this.mockToolCalls = mockToolCalls;
  }

  get providerName(): string {
    return 'mock-with-tools';
  }

  get supportsStreaming(): boolean {
    return false;
  }

  createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return Promise.resolve({
      content: 'I will execute the requested tools.',
      toolCalls: this.mockToolCalls,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    });
  }
}

describe('Agent Tool Abort Functionality', () => {
  const tempLaceDir = setupCoreTest();
  let agent: Agent;
  let toolExecutor: ToolExecutor;
  let threadManager: ThreadManager;
  let threadId: string;
  let slowTool: MockSlowTool;
  let bashTool: BashTool;
  let session: Session;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    setupTestProviderDefaults();

    // Create test provider instance
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Abort Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create project and session for proper context
    project = Project.create(
      'Abort Test Project',
      'Project for abort testing',
      tempLaceDir.tempDir,
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    session = Session.create({
      name: 'Abort Test Session',
      projectId: project.getId(),
    });

    toolExecutor = new ToolExecutor();

    // Set up auto-approval for tests
    toolExecutor.setApprovalCallback({
      requestApproval: () => Promise.resolve(ApprovalDecision.ALLOW_ONCE),
    });

    threadManager = new ThreadManager();
    threadId = threadManager.generateThreadId();

    // Create thread with session ID (required for tool execution)
    threadManager.createThread(threadId, session.getId());

    // Register tools
    slowTool = new MockSlowTool();
    bashTool = new BashTool();
    toolExecutor.registerTool('mock_slow', slowTool);
    toolExecutor.registerTool('bash', bashTool);
  });

  afterEach(async () => {
    if (agent) {
      // Always abort and stop, regardless of state
      agent.abort();
      agent.stop();
    }
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  it('should abort a single slow tool execution', async () => {
    const mockToolCalls = [
      {
        id: 'call_1',
        name: 'mock_slow',
        arguments: { delay: 2000, message: 'Should not see this' },
      },
    ];

    const provider = new MockProviderWithTools(mockToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    let toolCompletedCount = 0;
    const toolResults: ToolResult[] = [];

    agent.on('tool_call_complete', ({ result }) => {
      toolCompletedCount++;
      toolResults.push(result);
    });

    // Remove conversation_complete handler that's causing issues

    // Start the agent
    await agent.start();

    // Send a message that will trigger tool calls
    const messagePromise = agent.sendMessage('Execute the slow tool');

    // Wait a bit for tool execution to start
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Abort the agent (which should cancel tool execution)
    const aborted = agent.abort();
    expect(aborted).toBe(true);

    // Wait for the message processing to complete/abort
    await expect(messagePromise).resolves.not.toThrow();

    // Check that tool was marked as cancelled
    expect(toolCompletedCount).toBe(1);
    expect(toolResults[0].status).toBe('aborted');
    expect(toolResults[0].content[0].text).toContain('cancelled by user');
  });

  it('should abort multiple tools in a batch', async () => {
    const mockToolCalls = [
      {
        id: 'call_1',
        name: 'mock_slow',
        arguments: { delay: 2000, message: 'First tool' },
      },
      {
        id: 'call_2',
        name: 'mock_slow',
        arguments: { delay: 3000, message: 'Second tool' },
      },
      {
        id: 'call_3',
        name: 'mock_slow',
        arguments: { delay: 1000, message: 'Third tool' },
      },
    ];

    const provider = new MockProviderWithTools(mockToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    const toolResults: ToolResult[] = [];
    agent.on('tool_call_complete', ({ result }: { result: ToolResult }) => {
      toolResults.push(result);
    });

    await agent.start();
    const messagePromise = agent.sendMessage('Execute multiple slow tools');

    // Wait for tools to start
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Abort all tools
    const aborted = agent.abort();
    expect(aborted).toBe(true);

    await expect(messagePromise).resolves.not.toThrow();

    // All tools should be cancelled
    expect(toolResults.length).toBe(3);
    toolResults.forEach((result: ToolResult) => {
      expect(result.status).toBe('aborted');
      expect(result.content[0].text).toContain('cancelled by user');
    });
  });

  it('should abort tool with partial output capture', async () => {
    // Use mock slow tool which properly handles abort signals
    const mockToolCalls = [
      {
        id: 'call_slow_partial',
        name: 'mock_slow',
        arguments: { delay: 3000, message: 'This should be interrupted' },
      },
    ];

    const provider = new MockProviderWithTools(mockToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    let toolResult: ToolResult | null = null;
    agent.on('tool_call_complete', ({ result }: { result: ToolResult }) => {
      toolResult = result;
    });

    await agent.start();
    const messagePromise = agent.sendMessage('Run slow tool');

    // Wait for tool to start processing
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Abort the tool
    const aborted = agent.abort();
    expect(aborted).toBe(true);

    await expect(messagePromise).resolves.not.toThrow();

    // Wait for result to be set
    for (let i = 0; i < 50 && !toolResult; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Tool should be cancelled
    expect(toolResult).not.toBeNull();
    expect(toolResult!.status).toBe('aborted');
    expect(toolResult!.content[0].text).toContain('cancelled by user');

    // Should have partial progress info
    const resultText = toolResult!.content[0].text;
    expect(resultText).toContain('interrupted at');
  });

  it('should handle mixed completed and aborted tools', async () => {
    const mockToolCalls = [
      {
        id: 'call_fast',
        name: 'mock_slow',
        arguments: { delay: 100, message: 'Fast tool completed' }, // Completes quickly
      },
      {
        id: 'call_slow',
        name: 'mock_slow',
        arguments: { delay: 5000, message: 'Should be cancelled' }, // Will be aborted
      },
    ];

    const provider = new MockProviderWithTools(mockToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    const toolResults = new Map<string, ToolResult>();
    agent.on('tool_call_complete', ({ callId, result }: { callId: string; result: ToolResult }) => {
      toolResults.set(callId, result);
    });

    await agent.start();
    const messagePromise = agent.sendMessage('Execute mixed speed tools');

    // Wait for fast tool to complete but slow tool still running
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Abort (fast tool should already be done)
    const aborted = agent.abort();
    expect(aborted).toBe(true);

    await expect(messagePromise).resolves.not.toThrow();

    // Check results
    expect(toolResults.size).toBe(2);

    // Fast tool should have completed successfully
    const fastResult = toolResults.get('call_fast');
    expect(fastResult).toBeDefined();
    expect(fastResult!.status).toBe('completed');
    expect(fastResult!.content[0].text).toContain('Fast tool completed');

    // Slow tool should be cancelled
    const slowResult = toolResults.get('call_slow');
    expect(slowResult).toBeDefined();
    expect(slowResult!.status).toBe('aborted');
    expect(slowResult!.content[0].text).toContain('cancelled by user');
  });

  it('should not affect subsequent tool executions after abort', async () => {
    const firstToolCalls = [
      {
        id: 'call_1',
        name: 'mock_slow',
        arguments: { delay: 2000, message: 'First message' },
      },
    ];

    const secondToolCalls = [
      {
        id: 'call_2',
        name: 'mock_slow',
        arguments: { delay: 100, message: 'Second message completed' },
      },
    ];

    // First provider returns first tool call
    let provider = new MockProviderWithTools(firstToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    let firstResult: ToolResult | null = null;
    agent.on('tool_call_complete', ({ result }: { result: ToolResult }) => {
      if (!firstResult) {
        firstResult = result;
      }
    });

    await agent.start();

    // First execution - will be aborted
    const firstMessagePromise = agent.sendMessage('First execution');
    await new Promise((resolve) => setTimeout(resolve, 200));
    agent.abort();
    await expect(firstMessagePromise).resolves.not.toThrow();

    expect(firstResult).not.toBeNull();
    expect(firstResult!.status).toBe('aborted');
    expect(firstResult!.content[0].text).toContain('cancelled');

    // Don't call agent.stop() as it closes the threadManager's database
    // Just abort and clear the agent state
    agent.abort();

    // Create new threadManager for second execution to avoid database issues
    const secondThreadManager = new ThreadManager();
    const secondThreadId = secondThreadManager.generateThreadId();
    secondThreadManager.createThread(secondThreadId, session.getId());

    // Set thread metadata immediately after creation
    secondThreadManager.updateThreadMetadata(secondThreadId, {
      modelId: 'claude-3-5-haiku-20241022',
      providerInstanceId,
    });

    provider = new MockProviderWithTools(secondToolCalls);
    agent = new Agent({
      toolExecutor,
      threadManager: secondThreadManager,
      threadId: secondThreadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    let secondResult: ToolResult | null = null;
    agent.on('tool_call_complete', ({ result }: { result: ToolResult }) => {
      secondResult = result;
    });

    await agent.start();

    // Second execution - should complete normally
    await agent.sendMessage('Second execution');

    // Wait for completion
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(secondResult).not.toBeNull();
    expect(secondResult!.status).toBe('completed');
    expect(secondResult!.content[0].text).toContain('Second message completed');
  });

  it('should properly track pendingToolCount when aborting', async () => {
    const mockToolCalls = [
      {
        id: 'call_1',
        name: 'mock_slow',
        arguments: { delay: 1000, message: 'Tool 1' },
      },
      {
        id: 'call_2',
        name: 'mock_slow',
        arguments: { delay: 1000, message: 'Tool 2' },
      },
      {
        id: 'call_3',
        name: 'mock_slow',
        arguments: { delay: 1000, message: 'Tool 3' },
      },
    ];

    const provider = new MockProviderWithTools(mockToolCalls);

    const config: AgentConfig = {
      toolExecutor,
      threadManager,
      threadId,
      tools: [slowTool],
      metadata: {
        name: 'test-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId,
      },
    };

    agent = new Agent(config);

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    const stateChanges: string[] = [];
    const agentEvents: string[] = [];
    agent.on('state_change', ({ from, to }) => {
      stateChanges.push(to);
      agentEvents.push(`state: ${from} -> ${to}`);
    });
    agent.on('tool_call_complete', ({ callId }) => {
      agentEvents.push(`tool_complete: ${callId}`);
    });
    agent.on('conversation_complete', () => {
      agentEvents.push('conversation_complete');
    });

    await agent.start();
    const messagePromise = agent.sendMessage('Execute tools');

    // Wait for tool execution to start
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify we're in tool_execution state
    expect(stateChanges).toContain('tool_execution');

    // Abort
    agent.abort();

    await expect(messagePromise).resolves.not.toThrow();

    // Wait for state to settle after abort
    await new Promise((resolve) => setTimeout(resolve, 200));

    // State should have changed from tool_execution (either to idle or thinking for followup)
    const finalState = stateChanges[stateChanges.length - 1];
    expect(['idle', 'thinking']).toContain(finalState);

    // Check thread events for proper TOOL_RESULT events
    const events = threadManager.getEvents(threadId);
    const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

    // Should have 3 cancellation results
    expect(toolResults.length).toBe(3);
    toolResults.forEach((event) => {
      expect(event.data.status).toBe('aborted');
      expect(event.data.content[0].text).toContain('cancelled by user');
    });
  });
});
