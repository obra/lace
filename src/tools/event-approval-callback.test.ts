// ABOUTME: Integration tests for event-based approval callback with real Agent
// ABOUTME: Tests actual approval flow behavior through Agent conversations

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApprovalDecision } from '~/tools/approval-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { BashTool } from '~/tools/implementations/bash';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { type ToolResult } from '~/tools/types';

// Enhanced test provider that can return tool calls
class MockProviderWithToolCalls extends TestProvider {
  private configuredResponse?: ProviderResponse;

  setResponse(response: Partial<ProviderResponse>): void {
    this.configuredResponse = {
      content: response.content || 'I will execute the tool.',
      toolCalls: response.toolCalls || [],
      usage: response.usage || { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: response.stopReason || 'end_turn',
    };
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this.configuredResponse) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (signal?.aborted) {
        throw new Error('Request was aborted');
      }
      return this.configuredResponse;
    }
    return super.createResponse(_messages, _tools, signal);
  }
}

describe('EventApprovalCallback Integration Tests', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockProvider: MockProviderWithToolCalls;

  beforeEach(() => {
    setupTestPersistence();

    // Create real components for integration testing
    threadManager = new ThreadManager();
    mockProvider = new MockProviderWithToolCalls();
    const toolExecutor = new ToolExecutor();

    // Register the bash tool so it can be executed
    toolExecutor.registerTool('bash', new BashTool());

    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: ['bash'], // Enable bash tool
    });

    // Set up the EventApprovalCallback
    const approvalCallback = new EventApprovalCallback(agent, threadManager, threadId);
    agent.toolExecutor.setApprovalCallback(approvalCallback);
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should create TOOL_APPROVAL_REQUEST when Agent executes tool requiring approval', async () => {
    // Configure provider to return a tool call
    mockProvider.setResponse({
      content: 'I will run the ls command.',
      toolCalls: [
        {
          id: 'call_test',
          name: 'bash',
          input: { command: 'ls' },
        },
      ],
    });

    // Start agent conversation - this creates TOOL_CALL events and triggers approval
    const conversationPromise = agent.sendMessage('Please run ls command');

    // Wait for tool call and approval request to be created
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check that both TOOL_CALL and TOOL_APPROVAL_REQUEST events were created
    const events = threadManager.getEvents(agent.threadId);
    const toolCallEvent = events.find((e) => e.type === 'TOOL_CALL');
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');

    expect(toolCallEvent).toBeDefined();
    expect(toolCallEvent?.data).toMatchObject({
      id: 'call_test',
      name: 'bash',
      arguments: { command: 'ls' },
    });

    expect(approvalRequestEvent).toBeDefined();
    expect(approvalRequestEvent?.data).toEqual({ toolCallId: 'call_test' });

    // Simulate user approval
    const responseEvent = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_test',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Verify tool was executed (TOOL_RESULT event exists)
    const finalEvents = threadManager.getEvents(agent.threadId);
    const toolResultEvent = finalEvents.find((e) => e.type === 'TOOL_RESULT');
    expect(toolResultEvent).toBeDefined();
  });

  it('should handle tool execution denial through Agent flow', async () => {
    mockProvider.setResponse({
      content: 'I will run the dangerous command.',
      toolCalls: [
        {
          id: 'call_deny',
          name: 'bash',
          input: { command: 'rm -rf /' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run rm -rf /');

    // Wait for approval request
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = threadManager.getEvents(agent.threadId);
    const approvalRequestEvent = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequestEvent).toBeDefined();

    // Simulate user denial
    const responseEvent = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_deny',
      decision: ApprovalDecision.DENY,
    });

    agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Verify tool execution was denied
    const finalEvents = threadManager.getEvents(agent.threadId);
    const toolResultEvent = finalEvents.find((e) => e.type === 'TOOL_RESULT');
    expect(toolResultEvent).toBeDefined();

    const toolResult = toolResultEvent?.data as ToolResult;
    expect(toolResult.isError).toBe(true);
  });

  it('should handle multiple concurrent tool calls', async () => {
    mockProvider.setResponse({
      content: 'I will run both commands.',
      toolCalls: [
        {
          id: 'call_multi_1',
          name: 'bash',
          input: { command: 'ls' },
        },
        {
          id: 'call_multi_2',
          name: 'bash',
          input: { command: 'pwd' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run ls and pwd');

    // Wait for both approval requests
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = threadManager.getEvents(agent.threadId);
    const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequests).toHaveLength(2);

    // Approve both
    const response1Event = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_multi_1',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    const response2Event = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_multi_2',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    agent.emit('thread_event_added', { event: response1Event, threadId: agent.threadId });
    agent.emit('thread_event_added', { event: response2Event, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Both tools should have executed
    const finalEvents = threadManager.getEvents(agent.threadId);
    const toolResults = finalEvents.filter((e) => e.type === 'TOOL_RESULT');
    expect(toolResults).toHaveLength(2);
  });

  it('should recover from existing approvals in the thread', async () => {
    // Pre-populate thread with existing approval (simulating recovery scenario)
    threadManager.addEvent(agent.threadId, 'TOOL_CALL', {
      id: 'call_recovery',
      name: 'bash',
      arguments: { command: 'echo "recovery test"' },
    });

    threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_REQUEST', {
      toolCallId: 'call_recovery',
    });

    threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_recovery',
      decision: ApprovalDecision.ALLOW_SESSION,
    });

    // Configure provider to return the same tool call
    mockProvider.setResponse({
      content: 'I will run the recovery command.',
      toolCalls: [
        {
          id: 'call_recovery',
          name: 'bash',
          input: { command: 'echo "recovery test"' },
        },
      ],
    });

    // Execute through agent - should find existing approval
    await agent.sendMessage('Please run the recovery command');

    // Should not create duplicate approval request
    const events = threadManager.getEvents(agent.threadId);
    const approvalRequests = events.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    expect(approvalRequests).toHaveLength(1); // Only the pre-existing one
  });

  it('should emit agent events when creating approval requests', async () => {
    const eventSpy = vi.fn();
    agent.on('thread_event_added', eventSpy);

    mockProvider.setResponse({
      content: 'I will run the command.',
      toolCalls: [
        {
          id: 'call_emit_test',
          name: 'bash',
          input: { command: 'echo "test"' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run echo test');

    // Wait for event emission
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have emitted the TOOL_APPROVAL_REQUEST event
    const approvalRequestCalls = eventSpy.mock.calls.filter(
      (call) => call[0].event.type === 'TOOL_APPROVAL_REQUEST'
    );
    expect(approvalRequestCalls).toHaveLength(1);
    expect(approvalRequestCalls[0][0].event.data).toEqual({ toolCallId: 'call_emit_test' });

    // Complete the test
    const responseEvent = threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
      toolCallId: 'call_emit_test',
      decision: ApprovalDecision.ALLOW_ONCE,
    });

    agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });
    await conversationPromise;
  });
});
