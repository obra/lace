// ABOUTME: Integration tests for tool approval race condition prevention across all defense layers
// ABOUTME: Tests real agent scenarios with concurrent approvals using actual components

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { BashTool } from '~/tools/implementations/bash';
import { EventApprovalCallback } from '~/tools/event-approval-callback';
import { ApprovalDecision } from '~/tools/approval-types';
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
import type { ProviderResponse, ProviderMessage } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';

// Mock provider that can return tool calls once then regular responses
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
    _messages: ProviderMessage[],
    _tools: Tool[],
    _model: string,
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    if (this.configuredResponse) {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Return tool calls only once, then return regular responses
      if (this.configuredResponse.toolCalls.length > 0 && !this.hasReturnedToolCalls) {
        this.hasReturnedToolCalls = true;
        return this.configuredResponse;
      } else {
        // Return response without tool calls for subsequent requests
        return {
          content: this.configuredResponse.content,
          toolCalls: [],
          usage: this.configuredResponse.usage,
          stopReason: this.configuredResponse.stopReason,
        };
      }
    }
    return super.createResponse(_messages, _tools, _model, _signal);
  }
}

describe('Tool Approval Race Condition Integration Tests', () => {
  const tempLaceDirContext = setupCoreTest();
  let agent: Agent;
  let threadManager: ThreadManager;
  let mockProvider: MockProviderWithToolCalls;
  let toolExecutor: ToolExecutor;
  let bashTool: BashTool;
  let session: Session;
  let project: Project;
  let providerInstanceId: string;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    setupTestProviderDefaults();

    // Create a real provider instance for testing
    providerInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Race Condition Instance',
      apiKey: 'test-anthropic-key',
    });

    // Create real project and session for proper context
    project = Project.create(
      'Race Condition Test Project',
      'Project for race condition testing',
      tempLaceDirContext.tempDir,
      {
        providerInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      }
    );

    session = Session.create({
      name: 'Race Condition Test Session',
      projectId: project.getId(),
    });

    threadManager = new ThreadManager();
    mockProvider = new MockProviderWithToolCalls();
    toolExecutor = new ToolExecutor();
    bashTool = new BashTool();

    // Register bash tool
    toolExecutor.registerTool('bash', bashTool);

    const threadId = threadManager.generateThreadId();
    // Create thread WITH session ID so getFullSession() can find it
    threadManager.createThread(threadId, session.getId());

    agent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [bashTool],
    });

    // Set up EventApprovalCallback for approval workflow
    const approvalCallback = new EventApprovalCallback(agent);
    agent.toolExecutor.setApprovalCallback(approvalCallback);

    await agent.start();

    // Set model metadata for the agent (required for model-agnostic providers)
    agent.updateThreadMetadata({
      modelId: 'claude-3-5-haiku-20241022',
      providerInstanceId,
    });
  });

  afterEach(async () => {
    if (agent) {
      agent.stop();
    }
    // Test cleanup handled by setupCoreTest
    cleanupTestProviderDefaults();
    if (providerInstanceId) {
      await cleanupTestProviderInstances([providerInstanceId]);
    }
  });

  describe('defense-in-depth integration', () => {
    it('should execute tool exactly once despite multiple concurrent approvals', async () => {
      // Track actual tool executions
      let executionCount = 0;
      const executeSpy = vi.spyOn(bashTool, 'execute');
      executeSpy.mockImplementation(async () => {
        executionCount++;
        // Simulate some execution time
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          id: 'tool-counter',
          content: [{ type: 'text', text: `Executed ${executionCount} times` }],
          isError: false,
        };
      });

      // Configure provider to return tool call
      mockProvider.setResponse({
        content: 'I will execute the bash command.',
        toolCalls: [
          {
            id: 'tool-counter',
            name: 'bash',
            input: { command: 'echo "test"' },
          },
        ],
      });

      // Start agent conversation - this creates TOOL_CALL and approval request
      const conversationPromise = agent.sendMessage('Run echo test');

      // Wait for approval request to be created with polling
      let approvalRequest;
      let events;
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        events = threadManager.getEvents(agent.threadId);
        approvalRequest = events.find((e) => e.type === 'TOOL_APPROVAL_REQUEST');
        if (approvalRequest) break;
      }

      // Verify approval request was created
      expect(approvalRequest).toBeDefined();

      // Send multiple concurrent approval responses (simulating rapid clicking)
      const approvalPromises = Array(10)
        .fill(null)
        .map(async (_, index) => {
          // Slight delay to create more realistic race conditions
          await new Promise((resolve) => setTimeout(resolve, index * 2));

          return agent.handleApprovalResponse('tool-counter', ApprovalDecision.ALLOW_ONCE);
        });

      // Execute all approvals concurrently
      await Promise.all(approvalPromises);

      // Wait for conversation to complete
      await conversationPromise;

      // Add delay to allow all async processing to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // ASSERTIONS: Defense-in-depth should work

      // Tool should have been executed exactly once
      expect(executionCount).toBe(1);
      expect(executeSpy).toHaveBeenCalledTimes(1);

      // Verify end state in database/memory
      const finalEvents = threadManager.getEvents(agent.threadId);

      // Should have exactly one TOOL_APPROVAL_RESPONSE event (database layer defense)
      const approvalResponses = finalEvents.filter(
        (e) =>
          e.type === 'TOOL_APPROVAL_RESPONSE' &&
          (e.data as { toolCallId: string }).toolCallId === 'tool-counter'
      );
      expect(approvalResponses).toHaveLength(1);

      // Should have exactly one TOOL_RESULT event (agent layer defense)
      const toolResults = finalEvents.filter((e) => e.type === 'TOOL_RESULT');
      expect(toolResults).toHaveLength(1);
      expect((toolResults[0].data as { id: string }).id).toBe('tool-counter');

      executeSpy.mockRestore();
    });

    it('should handle database constraint violations gracefully', async () => {
      // This test verifies that even if we somehow bypass agent-level checks,
      // the database constraint still prevents duplicates

      // Create a tool call event
      threadManager.addEvent(agent.threadId, 'TOOL_CALL', {
        id: 'constraint-test',
        name: 'bash',
        arguments: { command: 'echo "constraint"' },
      });

      // First approval should succeed
      expect(() => {
        agent.handleApprovalResponse('constraint-test', ApprovalDecision.ALLOW_ONCE);
      }).not.toThrow();

      // Second approval should be silently ignored due to database constraint
      expect(() => {
        agent.handleApprovalResponse('constraint-test', ApprovalDecision.ALLOW_ONCE);
      }).not.toThrow();

      // Wait for any async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify only one approval response exists
      const events = threadManager.getEvents(agent.threadId);
      const approvalResponses = events.filter(
        (e) =>
          e.type === 'TOOL_APPROVAL_RESPONSE' &&
          (e.data as { toolCallId: string }).toolCallId === 'constraint-test'
      );
      expect(approvalResponses).toHaveLength(1);
    });

    it('should maintain conversation integrity with deduplication', () => {
      // This test verifies the conversation builder deduplication layer

      // Manually create scenario with duplicate tool results (bypassing other defenses)
      const toolCallId = 'dedup-test';

      threadManager.addEvent(agent.threadId, 'TOOL_CALL', {
        id: toolCallId,
        name: 'bash',
        arguments: { command: 'echo "dedup"' },
      });

      // Manually add duplicate TOOL_RESULT events (simulating race condition)
      threadManager.addEvent(agent.threadId, 'TOOL_RESULT', {
        id: toolCallId,
        content: [{ type: 'text', text: 'Result 1' }],
        isError: false,
      });

      threadManager.addEvent(agent.threadId, 'TOOL_RESULT', {
        id: toolCallId,
        content: [{ type: 'text', text: 'Result 2' }],
        isError: false,
      });

      // Build conversation messages (what gets sent to AI provider)
      const messages = agent.buildThreadMessages();

      // Count tool results in conversation
      const toolResultMessages = messages.filter(
        (msg) => msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0
      );

      // Should have only one tool result despite duplicates in event stream
      expect(toolResultMessages).toHaveLength(1);
    });
  });

  describe('concurrent approval scenarios', () => {
    it('should handle rapid approval responses without data corruption', async () => {
      // Create tool call
      threadManager.addEvent(agent.threadId, 'TOOL_CALL', {
        id: 'rapid-test',
        name: 'bash',
        arguments: { command: 'echo "rapid"' },
      });

      // Simulate extremely rapid concurrent approvals (like button mashing)
      const rapidApprovals = Array(50)
        .fill(null)
        .map(
          (_, _index) =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                agent.handleApprovalResponse('rapid-test', ApprovalDecision.ALLOW_ONCE);
                resolve();
              }, Math.random() * 10); // Random timing to create race conditions
            })
        );

      // Execute all concurrent approvals
      await Promise.all(rapidApprovals);

      // Wait for processing to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify data integrity
      const events = threadManager.getEvents(agent.threadId);

      // Should have exactly one approval response
      const approvalResponses = events.filter(
        (e) =>
          e.type === 'TOOL_APPROVAL_RESPONSE' &&
          (e.data as { toolCallId: string }).toolCallId === 'rapid-test'
      );
      expect(approvalResponses).toHaveLength(1);

      // Events should be properly ordered and uncorrupted
      expect(events.every((e) => e.id && e.threadId && e.type && e.timestamp)).toBe(true);
    });
  });
});
