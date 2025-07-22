// ABOUTME: Unit tests for non-interactive interface using Agent API
// ABOUTME: Tests verify non-interactive interface uses Agent API instead of direct ThreadManager access

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils-dir/test-provider';
import { NonInteractiveInterface } from '~/interfaces/non-interactive-interface';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('NonInteractiveInterface Agent API Usage', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let nonInteractiveInterface: NonInteractiveInterface;
  let testDir: string;

  beforeEach(async () => {
    setupTestPersistence();
    testDir = await mkdtemp(join(tmpdir(), 'lace-non-interactive-test-'));
    threadManager = new ThreadManager();

    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      provider,
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
    });

    nonInteractiveInterface = new NonInteractiveInterface(agent);
  });

  afterEach(async () => {
    threadManager.close();
    teardownTestPersistence();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('clearSession', () => {
    it('should create a new thread in the ThreadManager', () => {
      const agentGenerateThreadIdSpy = vi.spyOn(agent, 'generateThreadId');
      const agentCreateThreadSpy = vi.spyOn(agent, 'createThread');

      // Execute clearSession
      nonInteractiveInterface.clearSession();

      // Test actual behavior - Agent API methods are called to create new thread
      expect(agentGenerateThreadIdSpy).toHaveBeenCalled();
      expect(agentCreateThreadSpy).toHaveBeenCalled();
    });

    it('should use Agent API rather than direct ThreadManager access', () => {
      const agentGenerateThreadIdSpy = vi.spyOn(agent, 'generateThreadId');
      const agentCreateThreadSpy = vi.spyOn(agent, 'createThread');

      // Execute clearSession multiple times
      nonInteractiveInterface.clearSession();
      nonInteractiveInterface.clearSession();

      // Test actual behavior - each call uses Agent API
      expect(agentGenerateThreadIdSpy).toHaveBeenCalledTimes(2);
      expect(agentCreateThreadSpy).toHaveBeenCalledTimes(2);
    });

    it('should generate thread IDs through Agent API', () => {
      const testThreadId = 'test-thread-123';
      const agentGenerateThreadIdSpy = vi
        .spyOn(agent, 'generateThreadId')
        .mockReturnValue(testThreadId);
      const agentCreateThreadSpy = vi.spyOn(agent, 'createThread');

      // Execute clearSession
      nonInteractiveInterface.clearSession();

      // Test actual behavior - generated thread ID is used for creation
      expect(agentGenerateThreadIdSpy).toHaveBeenCalled();
      expect(agentCreateThreadSpy).toHaveBeenCalledWith(testThreadId);
    });

    it('should maintain agent thread consistency', () => {
      const initialThreadId = agent.getThreadId();

      // Execute clearSession
      nonInteractiveInterface.clearSession();

      // Test actual behavior - agent maintains its original thread ID
      // (clearSession creates new threads but doesn't switch the agent to them)
      expect(agent.getThreadId()).toBe(initialThreadId);
      expect(agent.getThreadId()).toBeDefined();
    });
  });
});
