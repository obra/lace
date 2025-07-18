// ABOUTME: Tests for Agent.createDelegateAgent method to ensure delegate threads are created properly
// ABOUTME: Regression test for thread ID isolation issue between multiple Agent instances

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { createMockProvider } from '~/__tests__/utils/mock-provider';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

describe('Agent Delegate Creation', () => {
  let threadManager: ThreadManager;
  let toolExecutor: ToolExecutor;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    setupTestPersistence();
    threadManager = new ThreadManager();
    toolExecutor = new ToolExecutor();
    mockProvider = createMockProvider();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should create delegate agent with correct parent thread ID', () => {
    // Create main agent with specific thread ID
    const mainThreadId = threadManager.createThread();
    const mainAgent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: [],
    });

    // Create delegate agent
    const delegateAgent = mainAgent.createDelegateAgent(toolExecutor);

    // Verify delegate thread has correct parent ID pattern
    const delegateThreadId = delegateAgent.threadId;
    expect(delegateThreadId).toMatch(new RegExp(`^${mainThreadId}\\.\\d+$`));
    expect(delegateThreadId).toBe(`${mainThreadId}.1`);
  });

  it('should create delegate agent with own thread ID when ThreadManager current differs', () => {
    // Create main agent with specific thread ID
    const mainThreadId = threadManager.createThread();
    const mainAgent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: [],
    });

    // Create another thread and make it current in ThreadManager
    const otherThreadId = threadManager.createThread();
    threadManager.setCurrentThread(otherThreadId);

    // Verify ThreadManager current thread is different from main agent's thread
    expect(threadManager.getCurrentThreadId()).toBe(otherThreadId);
    expect(threadManager.getCurrentThreadId()).not.toBe(mainThreadId);

    // Create delegate agent - should use main agent's thread ID as parent, not ThreadManager's current
    const delegateAgent = mainAgent.createDelegateAgent(toolExecutor);

    // Verify delegate thread uses main agent's thread ID as parent
    const delegateThreadId = delegateAgent.threadId;
    expect(delegateThreadId).toBe(`${mainThreadId}.1`);
    expect(delegateThreadId).not.toBe(`${otherThreadId}.1`);
  });

  it('should create multiple delegate agents with sequential IDs', () => {
    // Create main agent
    const mainThreadId = threadManager.createThread();
    const mainAgent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: [],
    });

    // Create multiple delegate agents
    const delegate1 = mainAgent.createDelegateAgent(toolExecutor);
    const delegate2 = mainAgent.createDelegateAgent(toolExecutor);
    const delegate3 = mainAgent.createDelegateAgent(toolExecutor);

    // Verify they have sequential IDs
    expect(delegate1.threadId).toBe(`${mainThreadId}.1`);
    expect(delegate2.threadId).toBe(`${mainThreadId}.2`);
    expect(delegate3.threadId).toBe(`${mainThreadId}.3`);
  });

  it('should create delegate agents with proper thread sharing', () => {
    // Create main agent
    const mainThreadId = threadManager.createThread();
    const mainAgent = new Agent({
      provider: mockProvider,
      toolExecutor,
      threadManager,
      threadId: mainThreadId,
      tools: [],
    });

    // Create delegate agent
    const delegateAgent = mainAgent.createDelegateAgent(toolExecutor);

    // Verify delegate agent returns its own thread ID
    expect(delegateAgent.getCurrentThreadId()).toBe(delegateAgent.threadId);

    // Both agents should be able to access their respective threads
    const mainThread = threadManager.getThread(mainThreadId);
    const delegateThread = threadManager.getThread(delegateAgent.threadId);

    expect(mainThread).toBeDefined();
    expect(delegateThread).toBeDefined();
    expect(mainThread?.id).toBe(mainThreadId);
    expect(delegateThread?.id).toBe(delegateAgent.threadId);
  });
});
