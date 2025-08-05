// ABOUTME: Tests for tool batch completion behavior - tool failures vs user denials
// ABOUTME: Verifies tool execution errors continue conversation while user denials pause it

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { ApprovalDecision } from '~/tools/approval-types';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ProviderMessage, ProviderResponse } from '~/providers/base-provider';
import { Tool } from '~/tools/tool';
import { ToolResult, ToolContext } from '~/tools/types';
import { Session } from '~/sessions/session';
import { Project } from '~/projects/project';
import { useTempLaceDir } from '~/test-utils/temp-lace-dir';
import {
  setupTestProviderInstances,
  cleanupTestProviderInstances,
} from '~/test-utils/provider-instances';
import {
  setupTestProviderDefaults,
  cleanupTestProviderDefaults,
} from '~/test-utils/provider-defaults';
import { z } from 'zod';

// Test tool that can be configured to fail or succeed
class ConfigurableTool extends Tool {
  name = 'test_tool';
  description = 'Test tool for batch completion scenarios';
  schema = z.object({
    action: z.string(),
  });

  private shouldFail = false;

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  protected executeValidated(
    args: z.infer<typeof this.schema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    if (this.shouldFail) {
      return Promise.resolve(this.createError('Simulated tool execution failure'));
    }
    return Promise.resolve(this.createResult(`Tool executed: ${args.action}`));
  }
}

class MockProviderWithToolCalls extends TestProvider {
  private configuredResponse?: ProviderResponse;
  private hasReturnedToolCalls = false;

  setResponse(response: Partial<ProviderResponse>): void {
    this.configuredResponse = {
      content: response.content || 'I will execute the tool.',
      toolCalls: response.toolCalls || [],
      usage: response.usage || { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      stopReason: response.stopReason || 'end_turn',
    };
    this.hasReturnedToolCalls = false;
  }

  async createResponse(
    _messages: ProviderMessage[] = [],
    _tools: Tool[] = [],
    signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this.configuredResponse) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (signal?.aborted) {
        throw new Error('Request was aborted');
      }

      if (this.configuredResponse.toolCalls.length > 0 && !this.hasReturnedToolCalls) {
        this.hasReturnedToolCalls = true;
        return this.configuredResponse;
      } else {
        return {
          content: this.configuredResponse.content,
          toolCalls: [],
          usage: this.configuredResponse.usage,
          stopReason: this.configuredResponse.stopReason,
        };
      }
    }
    return super.createResponse(_messages, _tools, signal);
  }
}

describe('Tool Batch Completion Behavior', () => {
  const tempDirContext = useTempLaceDir();
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockProvider: MockProviderWithToolCalls;
  let configurableTool: ConfigurableTool;
  let session: Session;
  let project: Project;

  beforeEach(async () => {
    setupTestPersistence();
    setupTestProviderDefaults();
    await setupTestProviderInstances();

    // Create real project and session for proper context
    project = Project.create(
      'Batch Completion Test Project',
      'Project for batch completion testing',
      tempDirContext.tempDir,
      {}
    );

    session = Session.create({
      name: 'Batch Completion Test Session',
      projectId: project.getId(),
    });

    threadManager = new ThreadManager();
    mockProvider = new MockProviderWithToolCalls();
    const toolExecutor = new ToolExecutor();

    configurableTool = new ConfigurableTool();
    toolExecutor.registerTool('test_tool', configurableTool);

    const threadId = threadManager.generateThreadId();
    // Create thread WITH session ID so getFullSession() can find it
    threadManager.createThread(threadId, session.getId());

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [configurableTool],
    });

    const approvalCallback = new EventApprovalCallback(agent);
    agent.toolExecutor.setApprovalCallback(approvalCallback);
  });

  afterEach(async () => {
    teardownTestPersistence();
    cleanupTestProviderDefaults();
    await cleanupTestProviderInstances(['test-anthropic', 'test-openai']);
  });

  it('should continue conversation when tool execution fails', async () => {
    // Configure tool to fail
    configurableTool.setShouldFail(true);

    // Configure provider to return tool call, then continue response
    mockProvider.setResponse({
      content: 'I will run the test tool.',
      toolCalls: [
        {
          id: 'call_fail',
          name: 'test_tool',
          input: { action: 'fail_test' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run the test tool');

    // Wait for approval request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Approve the tool
    const responseEvent = expectEventAdded(
      threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'call_fail',
        decision: ApprovalDecision.ALLOW_ONCE,
      })
    );

    agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Add delay for async execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = threadManager.getEvents(agent.threadId);

    // Should have tool result with error
    const toolResultEvent = events.find((e) => e.type === 'TOOL_RESULT');
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent?.data as ToolResult).isError).toBe(true);

    // Conversation should have continued (agent should have made another request to provider)
    const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
    expect(agentMessages.length).toBeGreaterThan(1); // Should have continued after tool failure
  });

  it('should pause conversation when user denies tool execution', async () => {
    // Configure tool to succeed (but user will deny it)
    configurableTool.setShouldFail(false);

    mockProvider.setResponse({
      content: 'I will run the test tool.',
      toolCalls: [
        {
          id: 'call_deny',
          name: 'test_tool',
          input: { action: 'deny_test' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run the test tool');

    // Wait for approval request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Deny the tool
    const responseEvent = expectEventAdded(
      threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'call_deny',
        decision: ApprovalDecision.DENY,
      })
    );

    agent.emit('thread_event_added', { event: responseEvent, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Add delay for processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = threadManager.getEvents(agent.threadId);

    // Should have tool result with error (from denial)
    const toolResultEvent = events.find((e) => e.type === 'TOOL_RESULT');
    expect(toolResultEvent).toBeDefined();
    expect((toolResultEvent?.data as ToolResult).isError).toBe(true);
    expect((toolResultEvent?.data as ToolResult).content).toEqual([
      { type: 'text', text: 'Tool execution denied by user' },
    ]);

    // Conversation should have paused (only one agent message)
    const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
    expect(agentMessages.length).toBe(1); // Should NOT have continued after user denial
  });

  it('should handle mixed tool failures and successes correctly', async () => {
    // Configure provider to return multiple tool calls
    mockProvider.setResponse({
      content: 'I will run both tools.',
      toolCalls: [
        {
          id: 'call_success',
          name: 'test_tool',
          input: { action: 'success_test' },
        },
        {
          id: 'call_fail',
          name: 'test_tool',
          input: { action: 'fail_test' },
        },
      ],
    });

    const conversationPromise = agent.sendMessage('Please run the test tools');

    // Wait for first approval request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Approve first tool (will succeed)
    configurableTool.setShouldFail(false);
    const response1Event = expectEventAdded(
      threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'call_success',
        decision: ApprovalDecision.ALLOW_ONCE,
      })
    );
    agent.emit('thread_event_added', { event: response1Event, threadId: agent.threadId });

    // Wait for second approval request
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Approve second tool (will fail)
    configurableTool.setShouldFail(true);
    const response2Event = expectEventAdded(
      threadManager.addEvent(agent.threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'call_fail',
        decision: ApprovalDecision.ALLOW_ONCE,
      })
    );
    agent.emit('thread_event_added', { event: response2Event, threadId: agent.threadId });

    // Wait for conversation to complete
    await conversationPromise;

    // Add delay for async execution
    await new Promise((resolve) => setTimeout(resolve, 100));

    const events = threadManager.getEvents(agent.threadId);
    const toolResults = events.filter((e) => e.type === 'TOOL_RESULT');

    expect(toolResults).toHaveLength(2);

    // One success, one failure
    const successResult = toolResults.find((e) => !e.data.isError);
    const failureResult = toolResults.find((e) => e.data.isError);

    expect(successResult).toBeDefined();
    expect(failureResult).toBeDefined();

    // Even with a tool failure, conversation should continue
    const agentMessages = events.filter((e) => e.type === 'AGENT_MESSAGE');
    expect(agentMessages.length).toBeGreaterThan(1); // Should continue despite tool failure
  });
});
