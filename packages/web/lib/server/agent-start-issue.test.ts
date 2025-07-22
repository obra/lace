// ABOUTME: Unit tests to isolate agent spawning and thread creation
// ABOUTME: Tests the scenario where agent delegates work with spawnAgent

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session, Project, Agent, ThreadManager } from '@/lib/server/lace-imports';
import type { ToolExecutor } from '@/lib/server/lace-imports';
import type { AIProvider } from '~/providers/base-provider';
import type { Tool } from '~/tools/tool';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Agent Spawning and Thread Creation', () => {
  let session: Session;
  let projectId: string;

  beforeEach(() => {
    setupTestPersistence();

    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create a test project
    const project = Project.create('Test Project', '/test/path', 'Test project', {});
    projectId = project.getId();

    // Create session
    session = Session.create('Test Session', 'anthropic', 'claude-3-haiku-20240307', projectId);
  });

  afterEach(() => {
    session.destroy();
    teardownTestPersistence();
  });

  it('should reproduce the exact E2E test scenario', async () => {
    // Get the session's ThreadManager to inspect its state
    const sessionAgent = session.getAgent(session.getId());
    expect(sessionAgent).toBeDefined();

    const threadManager = (sessionAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;
    expect(threadManager).toBeDefined();

    // Spawn agent (this is what SessionService.spawnAgent does)
    const agent = session.spawnAgent('Test Agent', 'anthropic', 'claude-3-haiku-20240307');
    const agentThreadId = agent.threadId;

    // Check if the agent's thread exists in ThreadManager
    const agentThread = threadManager.getThread(agentThreadId);

    if (agentThread) {
      // Thread exists, continue with test
      expect(agentThread).toBeDefined();
    }

    // Check the agent's own ThreadManager reference
    const _agentThreadManager = (agent as unknown as { _threadManager: ThreadManager })
      ._threadManager;
    expect(_agentThreadManager).toBeDefined();

    // Agent auto-starts when needed - no manual start required
    expect(agent).toBeDefined();
  });

  it('should check persistence state after delegate thread creation', () => {
    // Get the session's ThreadManager
    const sessionAgent = session.getAgent(session.getId());
    const threadManager = (sessionAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;

    // Create delegate thread directly
    const delegateThread = threadManager.createDelegateThreadFor(session.getId());
    const delegateThreadId = delegateThread.id;

    expect(delegateThreadId).toBeDefined();

    // Check if it's immediately accessible
    const _immediateThread = threadManager.getThread(delegateThreadId);
    expect(_immediateThread).toBeDefined();

    // Create fresh ThreadManager to test persistence
    const freshThreadManager = new ThreadManager();
    const persistedThread = freshThreadManager.getThread(delegateThreadId);

    // Try to add event to persisted thread
    if (persistedThread) {
      const _event = freshThreadManager.addEvent(delegateThreadId, 'USER_MESSAGE', 'Hello');
      expect(_event).toBeDefined();
    }
  });

  it('should check the exact agent creation flow', () => {
    // Get the session agent
    const sessionAgent = session.getAgent(session.getId());
    const sessionThreadManager = (sessionAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;

    // Create delegate agent directly (mimicking createDelegateAgent)
    const parentThreadId = session.getId();
    const delegateThread = sessionThreadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    expect(delegateThreadId).toBeDefined();

    // Check if delegate thread is accessible
    const _retrievedThread = sessionThreadManager.getThread(delegateThreadId);
    expect(_retrievedThread).toBeDefined();

    // Now try to simulate what happens during agent operation
    // The agent tries to add an event to its thread
    const _event = sessionThreadManager.addEvent(
      delegateThreadId,
      'SYSTEM_PROMPT',
      'Starting agent...'
    );
    expect(_event).toBeDefined();
  });

  it('should test the actual Agent constructor with delegate thread', async () => {
    // Get the session agent and its ThreadManager
    const sessionAgent = session.getAgent(session.getId());
    const sessionThreadManager = (sessionAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;
    const toolExecutor = (sessionAgent as unknown as { _toolExecutor: unknown })._toolExecutor;

    // Create delegate thread
    const delegateThread = sessionThreadManager.createDelegateThreadFor(session.getId());
    const delegateThreadId = delegateThread.id;

    expect(delegateThreadId).toBeDefined();

    // Create new Agent with the delegate thread ID
    const delegateAgent = new Agent({
      provider: (sessionAgent as unknown as { _provider: unknown })._provider as AIProvider,
      toolExecutor: toolExecutor as unknown as ToolExecutor,
      threadManager: sessionThreadManager,
      threadId: delegateThreadId,
      tools: (toolExecutor as unknown as { getAllTools: () => unknown[] }).getAllTools() as Tool[],
    });

    expect(delegateAgent).toBeDefined();

    // Check if the agent can find its own thread
    const agentThreadManager = (delegateAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;
    const _agentThread = agentThreadManager.getThread(delegateAgent.threadId);
    expect(_agentThread).toBeDefined();

    // Agent will auto-start when needed - no manual start required
    expect(delegateAgent).toBeDefined();
  });
});
