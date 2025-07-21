// ABOUTME: Integration test for tool approval event flow
// ABOUTME: Tests the complete path from tool execution to approval decision

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSessionService } from '@/lib/server/session-service';
import { getApprovalManager } from '@/lib/server/approval-manager';
import { Agent, AgentEvents, ApprovalDecision, Project } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/lib/server/core-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the file-read tool for testing
import { Tool } from '~/tools/tool';
import { ToolAnnotations } from '~/tools/types';
import { z } from 'zod';

// Type definitions for test
interface ToolExecutorWithApproval {
  approvalCallback?: {
    requestApproval: (toolName: string, input: unknown) => Promise<ApprovalDecision>;
  };
}

interface EventLogEntry {
  event: string;
  data: unknown;
  timestamp: number;
}

interface ApprovalManagerWithPending {
  pendingApprovals: Map<string, unknown>;
  resolveApproval: (requestId: string, decision: ApprovalDecision) => boolean;
}

class MockFileReadTool extends Tool {
  name = 'file-read';
  description = 'Test tool that requires approval';
  schema = z.object({
    path: z.string().min(1, 'File path cannot be empty'),
  });

  annotations = {
    readOnlyHint: true,
    destructiveHint: false,
  };

  protected async executeValidated(_args: z.infer<typeof this.schema>) {
    return {
      content: [{ type: 'text' as const, text: 'File content here' }],
      isError: false,
    };
  }
}

describe('Tool Approval Flow Integration', () => {
  let sessionService: ReturnType<typeof getSessionService>;
  let approvalManager: ReturnType<typeof getApprovalManager>;
  let projectId: string;
  let sessionId: ThreadId;
  let agent: Agent;
  let tempDir: string;

  // Track events for debugging
  const eventLog: EventLogEntry[] = [];

  function logEvent(event: string, data: unknown): void {
    eventLog.push({ event, data, timestamp: Date.now() });
    // Debug logging removed for production
  }

  beforeEach(async () => {
    // Set up test persistence
    setupTestPersistence();

    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), 'lace-approval-test-'));

    // Clear event log
    eventLog.length = 0;

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Initialize services
    sessionService = getSessionService();
    approvalManager = getApprovalManager();

    // Create a test project
    const project = Project.create(
      'Tool Approval Test Project',
      'Project for testing tool approval flow',
      tempDir
    );
    projectId = project.getId();

    // Create a test session
    const session = await sessionService.createSession(
      'Tool Approval Test Session',
      'anthropic',
      'claude-3-haiku-20240307',
      projectId
    );
    sessionId = session.id;

    // Get the session and its coordinator agent
    const sessionInstance = await sessionService.getSession(sessionId);
    if (!sessionInstance) {
      throw new Error('Failed to get session instance');
    }

    // Get the coordinator agent (every session has one)
    const agentResult = sessionInstance.getAgent(sessionId);
    if (!agentResult) {
      throw new Error('Failed to get coordinator agent');
    }
    agent = agentResult;

    // Register mock tool with correct name
    const mockTool = new MockFileReadTool();
    agent.toolExecutor.registerTool('file-read', mockTool);

    // Add event logging to agent
    const originalEmit = agent.emit.bind(agent);
    agent.emit = vi.fn().mockImplementation((event: keyof AgentEvents, ...args: unknown[]) => {
      logEvent(`agent.emit(${String(event)})`, args[0]);
      return (originalEmit as typeof agent.emit)(event, ...args);
    });

    // Add event logging to approval manager
    const originalRequestApproval = approvalManager.requestApproval.bind(approvalManager);
    approvalManager.requestApproval = vi
      .fn()
      .mockImplementation(
        async (
          threadId: ThreadId,
          sessionId: ThreadId,
          toolName: string,
          description: string,
          context: unknown,
          input: unknown,
          isReadOnly: boolean
        ) => {
          logEvent('approvalManager.requestApproval', {
            threadId,
            sessionId,
            toolName,
            description,
            context,
            input,
            isReadOnly,
          });
          return originalRequestApproval(
            threadId,
            sessionId,
            toolName,
            description,
            context as ToolAnnotations | undefined,
            input,
            isReadOnly
          );
        }
      );

    logEvent('setup.complete', {
      projectId,
      sessionId,
      agentId: agent.threadId,
      toolExecutorSet: !!agent.toolExecutor,
      approvalCallbackSet: !!(agent.toolExecutor as unknown as ToolExecutorWithApproval)
        .approvalCallback,
    });
  });

  afterEach(async () => {
    // Clean up session service
    if (sessionService) {
      sessionService.clearActiveSessions();
    }

    // Clean up test persistence
    teardownTestPersistence();

    // Clean up temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (_error) {
        // Failed to cleanup temp directory silently
      }
    }
  });

  it('should trace the complete tool approval flow', async () => {
    logEvent('test.start', { testName: 'complete approval flow' });

    // Step 1: Verify agent setup
    expect(agent).toBeDefined();
    expect(agent.toolExecutor).toBeDefined();

    // Step 2: Verify approval callback is set
    const toolExecutor = agent.toolExecutor as unknown as ToolExecutorWithApproval;
    logEvent('approval.callback.check', {
      callbackExists: !!toolExecutor.approvalCallback,
      callbackType: typeof toolExecutor.approvalCallback,
    });

    expect(toolExecutor.approvalCallback).toBeDefined();
    if (toolExecutor.approvalCallback) {
      expect(typeof toolExecutor.approvalCallback.requestApproval).toBe('function');
    }

    // Step 3: Verify agent has approval_request event listeners
    const listenerCount = agent.listenerCount('approval_request');
    logEvent('agent.listeners.check', {
      approvalRequestListeners: listenerCount,
      allEvents: agent.eventNames(),
    });

    expect(listenerCount).toBeGreaterThan(0);

    // Step 4: Execute a tool that requires approval
    logEvent('tool.execution.start', {
      toolName: 'file-read',
      args: { path: '/test/file.txt' },
    });

    // Create a promise to track approval request
    let approvalRequestReceived = false;
    let approvalResolveFunction: ((decision: ApprovalDecision) => void) | null = null;

    // Listen for approval_request event
    agent.once('approval_request', (data: unknown) => {
      const approvalData = data as { resolve: (decision: ApprovalDecision) => void };
      logEvent('approval_request.received', data);
      approvalRequestReceived = true;
      approvalResolveFunction = approvalData.resolve;

      // Automatically approve after a short delay to complete the flow
      setTimeout(() => {
        logEvent('approval_request.resolving', { decision: 'ALLOW_ONCE' });
        approvalData.resolve(ApprovalDecision.ALLOW_ONCE);
      }, 100);
    });

    // Execute the tool with correct ToolCall format (no context to force approval)
    const toolCall = {
      id: 'test-call-id',
      name: 'file-read',
      arguments: { path: '/test/file.txt' },
    };
    const toolResult = await agent.toolExecutor.executeTool(toolCall, undefined);

    logEvent('tool.execution.complete', {
      result: toolResult,
      resultError:
        toolResult.isError &&
        toolResult.content &&
        toolResult.content[0] &&
        'text' in toolResult.content[0]
          ? toolResult.content[0].text
          : null,
      approvalRequestReceived,
      resolveFunction: !!approvalResolveFunction,
    });

    // Verify the flow worked
    expect(approvalRequestReceived).toBe(true);
    expect(toolResult).toBeDefined();
    expect(toolResult.isError).toBe(false);

    // Event log available for debugging if needed
  });

  it('should test approval callback directly', async () => {
    logEvent('test.start', { testName: 'direct approval callback' });

    const toolExecutor = agent.toolExecutor as unknown as ToolExecutorWithApproval;
    const approvalCallback = toolExecutor.approvalCallback;

    expect(approvalCallback).toBeDefined();
    if (!approvalCallback) {
      throw new Error('Approval callback not found');
    }

    // Test the approval callback directly
    let eventEmitted = false;
    let eventData: unknown = null;

    agent.once('approval_request', (data: unknown) => {
      const approvalData = data as {
        resolve: (decision: ApprovalDecision) => void;
        toolName: string;
        requestId: string;
      };
      logEvent('direct.approval_request.received', data);
      eventEmitted = true;
      eventData = data;

      // Resolve immediately
      approvalData.resolve(ApprovalDecision.ALLOW_ONCE);
    });

    logEvent('direct.callback.calling', { toolName: 'file-read' });

    const decision = await approvalCallback.requestApproval('file-read', {
      path: '/test/file.txt',
    });

    logEvent('direct.callback.complete', {
      decision,
      eventEmitted,
      eventData: eventData
        ? {
            toolName: (eventData as { toolName?: string })?.toolName,
            hasResolve: typeof (eventData as { resolve?: unknown })?.resolve === 'function',
            requestId: (eventData as { requestId?: string })?.requestId,
          }
        : null,
    });

    expect(eventEmitted).toBe(true);
    expect(decision).toBe(ApprovalDecision.ALLOW_ONCE);
    if (eventData) {
      expect((eventData as { toolName?: string })?.toolName).toBe('file-read');
      expect(typeof (eventData as { resolve?: unknown })?.resolve).toBe('function');
    }
  });

  it('should test SessionService approval event handling', async () => {
    logEvent('test.start', { testName: 'SessionService event handling' });

    // Check if SessionService has set up event handlers
    const listenerCount = agent.listenerCount('approval_request');
    logEvent('session.listeners.check', {
      approvalRequestListeners: listenerCount,
      allEventNames: agent.eventNames(),
    });

    expect(listenerCount).toBeGreaterThan(0);

    // Manually emit an approval_request event to test the handler
    let approvalManagerCalled = false;
    const originalRequestApproval = approvalManager.requestApproval;

    approvalManager.requestApproval = vi
      .fn()
      .mockImplementation(
        async (
          threadId: ThreadId,
          sessionId: ThreadId,
          toolName: string,
          description: string,
          context: unknown,
          input: unknown,
          isReadOnly: boolean
        ) => {
          logEvent('manual.approval_manager.called', {
            threadId,
            sessionId,
            toolName,
            description,
            context,
            input,
            isReadOnly,
          });
          approvalManagerCalled = true;
          return ApprovalDecision.ALLOW_ONCE;
        }
      );

    const testPromise = new Promise<ApprovalDecision>((resolve) => {
      logEvent('manual.approval_request.emitting', {
        toolName: 'file-read',
        input: { path: '/test/file.txt' },
      });

      agent.emit('approval_request', {
        toolName: 'file-read',
        input: { path: '/test/file.txt' },
        isReadOnly: true,
        requestId: 'test-request-123',
        resolve,
      });
    });

    const result = await testPromise;

    logEvent('manual.approval_request.complete', {
      result,
      approvalManagerCalled,
    });

    expect(approvalManagerCalled).toBe(true);
    expect(result).toBe(ApprovalDecision.ALLOW_ONCE);

    // Restore original method
    approvalManager.requestApproval = originalRequestApproval;
  });

  it.skip('should verify ApprovalManager SSE integration', async () => {
    logEvent('test.start', { testName: 'ApprovalManager SSE integration' });

    // Test ApprovalManager directly
    const approvalPromise = approvalManager.requestApproval(
      asThreadId(agent.threadId),
      sessionId,
      'file-read',
      'Test approval request',
      undefined,
      { path: '/test/file.txt' },
      true
    );

    // Wait a bit for SSE event to be sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check if there are any pending approvals
    const approvalManagerWithState = approvalManager as unknown as ApprovalManagerWithPending;
    const pendingApprovals = approvalManagerWithState.pendingApprovals;
    const pendingKeys = Array.from(pendingApprovals.keys());
    logEvent('approval_manager.state', {
      hasPendingApprovals: pendingKeys.length > 0,
      pendingKeys,
    });

    // Simulate approval resolution
    const requestId = pendingKeys[0];
    if (requestId) {
      logEvent('approval_manager.resolving', { requestId });
      approvalManagerWithState.resolveApproval(requestId, ApprovalDecision.ALLOW_ONCE);
    }

    const result = await approvalPromise;
    logEvent('approval_manager.complete', { result });

    expect(result).toBe(ApprovalDecision.ALLOW_ONCE);
  });
});
