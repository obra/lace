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
    it('should use Agent.generateThreadId() instead of direct ThreadManager access', () => {
      // Arrange
      const agentGenerateThreadIdSpy = vi.spyOn(agent, 'generateThreadId');

      // Act
      nonInteractiveInterface.clearSession();

      // Assert - Should use Agent API
      expect(agentGenerateThreadIdSpy).toHaveBeenCalled();
    });

    it('should use Agent.createThread() instead of direct ThreadManager access', () => {
      // Arrange
      const agentCreateThreadSpy = vi.spyOn(agent, 'createThread');

      // Act
      nonInteractiveInterface.clearSession();

      // Assert - Should use Agent API
      expect(agentCreateThreadSpy).toHaveBeenCalled();
    });

    it('should create new thread through Agent API', () => {
      // Arrange
      const agentGenerateThreadIdSpy = vi
        .spyOn(agent, 'generateThreadId')
        .mockReturnValue('test-thread-123');
      const agentCreateThreadSpy = vi.spyOn(agent, 'createThread');

      // Act
      nonInteractiveInterface.clearSession();

      // Assert
      expect(agentGenerateThreadIdSpy).toHaveBeenCalled();
      expect(agentCreateThreadSpy).toHaveBeenCalledWith('test-thread-123');
    });

    // All thread operations go through Agent API
  });
});
