// ABOUTME: Test to verify each agent gets its own EventApprovalCallback instance
// ABOUTME: Ensures approval requests are created in the correct thread

import { describe, it, expect, beforeEach } from 'vitest';
import { Session } from '~/sessions/session';
import { ThreadManager } from '~/threads/thread-manager';
import { DatabasePersistence } from '~/persistence/database';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { ProviderRegistry } from '~/providers/provider-registry';
import { TestProvider } from '~/test-utils/test-provider';
import type { ProviderInstanceConfig } from '~/providers/types';

describe('EventApprovalCallback Isolation Fix', () => {
  let session: Session;
  let threadManager: ThreadManager;
  let providerInstance: ProviderInstanceConfig;

  beforeEach(async () => {
    // Set up test infrastructure
    const persistence = new DatabasePersistence(':memory:');
    threadManager = new ThreadManager(persistence);
    const envManager = new ProjectEnvironmentManager();

    // Register test provider
    const providerRegistry = new ProviderRegistry();
    providerRegistry.register('test', new TestProvider());

    providerInstance = {
      id: 'test-instance',
      catalogProviderId: 'test',
      displayName: 'Test Provider',
      hasCredentials: true,
    };

    // Create session with main agent
    session = new Session(
      'test-session',
      'test-project',
      threadManager,
      envManager,
      providerRegistry,
      { approvalCallback: undefined }
    );

    await session.initialize({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });
  });

  it('should give each agent its own approval callback instance', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn a delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });

    // Each agent should have its own approval callback
    const mainCallback = mainAgent.toolExecutor.getApprovalCallback();
    const delegateCallback = delegateAgent.toolExecutor.getApprovalCallback();

    // They should NOT be the same instance (this is the bug)
    expect(mainCallback).not.toBe(delegateCallback);
    expect(mainCallback).toBeDefined();
    expect(delegateCallback).toBeDefined();
  });

  it('should create approval requests in the correct thread when tools are called', async () => {
    // Get main agent and set up approval callback
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });

    const mainThreadId = mainAgent.threadId;
    const delegateThreadId = delegateAgent.threadId;

    // Clear any existing events
    const mainEvents = threadManager.getEvents(mainThreadId);
    const delegateEvents = threadManager.getEvents(delegateThreadId);
    mainEvents.length = 0;
    delegateEvents.length = 0;

    // Mock a tool call from the main agent that requires approval
    const toolCall = {
      id: 'main-tool-call-1',
      name: 'file_list', // This tool requires approval by default
      arguments: { maxDepth: 3 },
    };

    const toolContext = { agent: mainAgent };

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

    // The approval request should be in the main thread (where tool call originated)
    expect(mainApprovalEvents).toHaveLength(1);
    expect(delegateApprovalEvents).toHaveLength(0);
    expect(mainApprovalEvents[0]!.data.toolCallId).toBe('main-tool-call-1');
  });

  it('should handle tool calls from delegate agents correctly', async () => {
    // Get main agent
    const mainAgent = session.getCoordinatorAgent()!;

    // Spawn delegate agent
    const delegateAgent = session.spawnAgent({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });

    const mainThreadId = mainAgent.threadId;
    const delegateThreadId = delegateAgent.threadId;

    // Clear any existing events
    const mainEvents = threadManager.getEvents(mainThreadId);
    const delegateEvents = threadManager.getEvents(delegateThreadId);
    mainEvents.length = 0;
    delegateEvents.length = 0;

    // Mock a tool call from the DELEGATE agent
    const toolCall = {
      id: 'delegate-tool-call-1',
      name: 'file_list',
      arguments: { maxDepth: 2 },
    };

    const toolContext = { agent: delegateAgent };

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
