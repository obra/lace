// ABOUTME: Test for the shared EventApprovalCallback bug between main and delegate agents
// ABOUTME: Demonstrates how shared callbacks cause approval requests to be created in wrong threads

import { describe, it, expect, beforeEach } from 'vitest';
import { Session } from '~/sessions/session';
import { ThreadManager } from '~/threads/thread-manager';
import { MemoryPersistence } from '~/persistence/memory-persistence';
import { ProjectEnvironmentManager } from '~/projects/environment-variables';
import { ProviderRegistry } from '~/providers/provider-registry';
import { setupAgentApprovals } from '@/lib/server/agent-utils';
import { TestProvider } from '~/test-utils/test-provider';
import { vi } from 'vitest';
import type { ProviderInstanceConfig } from '~/providers/types';

describe('Shared EventApprovalCallback Bug', () => {
  let session: Session;
  let threadManager: ThreadManager;
  let providerInstance: ProviderInstanceConfig;

  beforeEach(async () => {
    // Set up test infrastructure
    const persistence = new MemoryPersistence();
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
      { approvalCallback: undefined } // We'll set this up later
    );

    await session.initialize({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });
  });

  it('should create approval requests in the correct thread when agents share approval callbacks', async () => {
    // Set up approval callbacks for both agents
    const mainAgent = session.getCoordinatorAgent()!;
    setupAgentApprovals(mainAgent, session.getId());

    // Spawn a delegate agent (this is where the bug happens)
    const delegateAgent = session.spawnAgent({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });

    // BUG: The delegate agent gets the SAME approval callback as the main agent
    // This means approval requests can be created in the wrong thread

    const mainCallback = mainAgent.toolExecutor.getApprovalCallback();
    const delegateCallback = delegateAgent.toolExecutor.getApprovalCallback();

    // This assertion will PASS (showing the bug exists)
    expect(mainCallback).toBe(delegateCallback); // Same callback instance!

    // Now test the actual bug: main agent tool call creates approval in wrong thread
    const mainThreadId = mainAgent.threadId;
    const delegateThreadId = delegateAgent.threadId;

    expect(mainThreadId).not.toBe(delegateThreadId); // Different threads

    // Mock a tool call from the main agent that requires approval
    const toolCall = {
      id: 'test-tool-call-1',
      name: 'file_list', // This tool requires approval (no policy set)
      arguments: { maxDepth: 3 },
    };

    // Clear any existing events
    threadManager.getEvents(mainThreadId).length = 0;
    threadManager.getEvents(delegateThreadId).length = 0;

    // Main agent tries to execute a tool requiring approval
    const toolContext = { agent: mainAgent };

    try {
      await mainAgent.toolExecutor.requestToolPermission(toolCall, toolContext);

      // If we get here without an ApprovalPendingError, something's wrong
      expect.fail('Expected ApprovalPendingError to be thrown');
    } catch (error: any) {
      // We expect an ApprovalPendingError, but the approval request should be in main thread
      expect(error.name).toBe('ApprovalPendingError');
    }

    // Check which thread got the approval request
    const mainEvents = threadManager.getEvents(mainThreadId);
    const delegateEvents = threadManager.getEvents(delegateThreadId);

    const mainApprovalEvents = mainEvents.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');
    const delegateApprovalEvents = delegateEvents.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');

    // BUG: This test will FAIL because approval goes to wrong thread
    // The approval request should be in the main thread (where tool call originated)
    // But due to the shared callback bug, it goes to the delegate thread instead
    expect(mainApprovalEvents).toHaveLength(1); // Should be 1, but will be 0
    expect(delegateApprovalEvents).toHaveLength(0); // Should be 0, but will be 1

    // Additional verification: the approval request should reference the correct tool call
    if (mainApprovalEvents.length > 0) {
      expect(mainApprovalEvents[0]!.data.toolCallId).toBe('test-tool-call-1');
    }
  });

  it('should demonstrate the thread context mixup in EventApprovalCallback', async () => {
    const mainAgent = session.getCoordinatorAgent()!;
    setupAgentApprovals(mainAgent, session.getId());

    const delegateAgent = session.spawnAgent({
      providerInstanceId: 'test-instance',
      modelId: 'test-model',
    });

    // Get the shared callback (this is the bug)
    const sharedCallback = mainAgent.toolExecutor.getApprovalCallback()!;

    // The callback should create approval requests in the context of the agent that calls it
    // But because it's shared, it will use the last agent it was associated with

    const toolCall = {
      id: 'main-tool-call',
      name: 'file_list',
      arguments: {},
    };

    // Create an EventApprovalCallback and see which agent it references
    const EventApprovalCallback = (await import('~/tools/event-approval-callback'))
      .EventApprovalCallback;
    const callbackInstance = sharedCallback as InstanceType<typeof EventApprovalCallback>;

    // The bug: the callback's internal agent reference points to the delegate agent
    // even when called by the main agent, because delegate was created last
    const callbackAgent = (callbackInstance as any).agent;

    // This assertion reveals the bug
    expect(callbackAgent.threadId).toBe(delegateAgent.threadId); // Points to delegate!
    expect(callbackAgent.threadId).not.toBe(mainAgent.threadId); // Not main agent

    // When main agent calls requestApproval, it creates the request in delegate's thread
    try {
      await sharedCallback.requestApproval(toolCall);
    } catch (error: any) {
      // The approval request ends up in the delegate thread instead of main thread
      const delegateEvents = threadManager.getEvents(delegateAgent.threadId);
      const approvalEvents = delegateEvents.filter((e) => e.type === 'TOOL_APPROVAL_REQUEST');

      expect(approvalEvents).toHaveLength(1); // Bug: approval in wrong thread
      expect(approvalEvents[0]!.data.toolCallId).toBe('main-tool-call');
    }
  });
});
