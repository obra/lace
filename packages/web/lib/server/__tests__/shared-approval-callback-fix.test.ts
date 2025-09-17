// ABOUTME: Test to verify each agent gets its own EventApprovalCallback instance
// ABOUTME: Ensures approval requests are created in the correct thread

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session, Project, ThreadManager } from '@/lib/server/lace-imports';
import { asThreadId, type ThreadId } from '@/types/core';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('EventApprovalCallback Isolation Fix', () => {
  const _tempLaceDir = setupWebTest();
  let session: Session;
  let projectId: string;
  let anthropicInstanceId: string;

  beforeEach(async () => {
    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create test project
    const project = await Project.create(
      'Test Project',
      '/tmp/test-project',
      new Map([['ANTHROPIC_KEY', 'test-key']])
    );
    projectId = project.getId();

    // Create provider instance
    anthropicInstanceId = await createTestProviderInstance(
      projectId,
      'anthropic',
      'claude-3-5-sonnet-20240620'
    );

    // Create session
    session = await Session.create(
      projectId,
      asThreadId(`lace_${new Date().toISOString().split('T')[0]!.replace(/-/g, '')}_test`),
      anthropicInstanceId,
      'claude-3-5-sonnet-20240620'
    );

    await session.initialize({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });
  });

  afterEach(async () => {
    await cleanupTestProviderInstances();
  });

  it('should give each agent its own approval callback instance', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn a delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });

    // Each agent should have its own approval callback
    const mainCallback = mainAgent.toolExecutor.getApprovalCallback();
    const delegateCallback = delegateAgent.toolExecutor.getApprovalCallback();

    // This is the BUG: they should NOT be the same instance
    // With the current bug, this assertion will FAIL
    expect(mainCallback).not.toBe(delegateCallback);
    expect(mainCallback).toBeDefined();
    expect(delegateCallback).toBeDefined();
  });

  it('should create approval requests in the correct thread when tools are called', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });

    const mainThreadId = mainAgent.threadId;
    const delegateThreadId = delegateAgent.threadId;

    // Mock a tool call from the main agent that requires approval
    const toolCall = {
      id: 'main-tool-call-1',
      name: 'file_list', // This tool requires approval by default
      arguments: { maxDepth: 3 },
    };

    const toolContext = { agent: mainAgent };

    // Clear any existing events for clean test
    const threadManager = (session as any)._threadManager as ThreadManager;
    const mainEvents = threadManager.getEvents(mainThreadId);
    const delegateEvents = threadManager.getEvents(delegateThreadId);
    mainEvents.length = 0;
    delegateEvents.length = 0;

    // Main agent tries to execute a tool requiring approval
    try {
      await mainAgent.toolExecutor.requestToolPermission(toolCall, toolContext);
      // Should throw ApprovalPendingError
      expect.fail('Expected ApprovalPendingError to be thrown');
    } catch (error: any) {
      expect(error.name).toBe('ApprovalPendingError');
    }

    // Check that approval request was created in the MAIN thread, not delegate thread
    const mainApprovalEvents = threadManager
      .getEvents(mainThreadId)
      .filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    const delegateApprovalEvents = threadManager
      .getEvents(delegateThreadId)
      .filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');

    // With the BUG: approval might go to wrong thread
    // This test will FAIL if the bug exists
    expect(mainApprovalEvents).toHaveLength(1);
    expect(delegateApprovalEvents).toHaveLength(0);
    expect(mainApprovalEvents[0]!.data.toolCallId).toBe('main-tool-call-1');
  });

  it('should handle tool calls from delegate agents correctly', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-sonnet-20240620',
    });

    const mainThreadId = mainAgent.threadId;
    const delegateThreadId = delegateAgent.threadId;

    // Mock a tool call from the DELEGATE agent
    const toolCall = {
      id: 'delegate-tool-call-1',
      name: 'file_list',
      arguments: { maxDepth: 2 },
    };

    const toolContext = { agent: delegateAgent };

    // Clear any existing events for clean test
    const threadManager = (session as any)._threadManager as ThreadManager;
    const mainEvents = threadManager.getEvents(mainThreadId);
    const delegateEvents = threadManager.getEvents(delegateThreadId);
    mainEvents.length = 0;
    delegateEvents.length = 0;

    // Delegate agent tries to execute a tool requiring approval
    try {
      await delegateAgent.toolExecutor.requestToolPermission(toolCall, toolContext);
      expect.fail('Expected ApprovalPendingError to be thrown');
    } catch (error: any) {
      expect(error.name).toBe('ApprovalPendingError');
    }

    // Check that approval request was created in the DELEGATE thread, not main thread
    const mainApprovalEvents = threadManager
      .getEvents(mainThreadId)
      .filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    const delegateApprovalEvents = threadManager
      .getEvents(delegateThreadId)
      .filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');

    // The approval request should be in the delegate thread (where tool call originated)
    expect(mainApprovalEvents).toHaveLength(0);
    expect(delegateApprovalEvents).toHaveLength(1);
    expect(delegateApprovalEvents[0]!.data.toolCallId).toBe('delegate-tool-call-1');
  });
});
