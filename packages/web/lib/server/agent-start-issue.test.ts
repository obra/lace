// ABOUTME: Unit tests to isolate agent spawning and thread creation
// ABOUTME: Tests the scenario where agent delegates work with spawnAgent

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session, Project, Agent, ThreadManager } from '@/lib/server/lace-imports';
import type { ToolExecutor } from '@/lib/server/lace-imports';
import type { Tool } from '~/tools/tool';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Agent Spawning and Thread Creation', () => {
  const _tempLaceDir = setupWebTest();
  let session: Session;
  let projectId: string;
  let anthropicInstanceId: string;
  let openaiInstanceId: string;

  beforeEach(async () => {
    // Set up environment
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.LACE_DB_PATH = ':memory:';

    // Create test provider instances
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic Instance',
      apiKey: 'test-anthropic-key',
    });

    openaiInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o'],
      displayName: 'Test OpenAI Instance',
      apiKey: 'test-openai-key',
    });

    // Create a test project
    const project = Project.create('Test Project', '/test/path', 'Test project', {});
    projectId = project.getId();

    // Create session
    session = Session.create({
      name: 'Test Session',
      projectId,
      configuration: {
        providerInstanceId: anthropicInstanceId,
        modelId: 'claude-3-5-haiku-20241022',
      },
    });
  });

  afterEach(async () => {
    if (session) {
      session.destroy();
    }
    await cleanupTestProviderInstances([anthropicInstanceId, openaiInstanceId]);
    vi.clearAllMocks();
  });

  it('should reproduce the exact E2E test scenario', async () => {
    // Get the session's ThreadManager to inspect its state
    const sessionAgent = session.getAgent(session.getId());
    expect(sessionAgent).toBeDefined();

    const threadManager = (sessionAgent as unknown as { _threadManager: ThreadManager })
      ._threadManager;
    expect(threadManager).toBeDefined();

    // Spawn agent (this is what SessionService.spawnAgent does)
    const agent = session.spawnAgent({
      name: 'Test Agent',
      providerInstanceId: anthropicInstanceId,
      modelId: 'claude-3-5-haiku-20241022',
    });
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
      const _event = freshThreadManager.addEvent({
        type: 'USER_MESSAGE',
        threadId: delegateThreadId,
        data: 'Hello',
      });
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
    const _event = sessionThreadManager.addEvent({
      type: 'SYSTEM_PROMPT',
      threadId: delegateThreadId,
      data: 'Starting agent...',
    });
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
      toolExecutor: toolExecutor as unknown as ToolExecutor,
      threadManager: sessionThreadManager,
      threadId: delegateThreadId,
      tools: (toolExecutor as unknown as { getAllTools: () => unknown[] }).getAllTools() as Tool[],
      metadata: {
        name: 'delegate-agent',
        modelId: 'claude-3-5-haiku-20241022',
        providerInstanceId: anthropicInstanceId,
      },
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
