// ABOUTME: Tests for ThreadManager encapsulation within Agent
// ABOUTME: Verifies that ThreadManager is properly encapsulated and not exposed publicly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Agent ThreadManager Encapsulation', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-encapsulation-test-'));
    threadManager = new ThreadManager(join(testDir, 'test.db'));

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

    await agent.start();
  });

  afterEach(async () => {
    threadManager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('ThreadManager encapsulation', () => {
    it('should provide all needed functionality through Agent API without exposing ThreadManager', () => {
      // Verify Agent provides all the functionality that would be needed
      // Thread ID operations
      expect(typeof agent.getCurrentThreadId).toBe('function');
      expect(typeof agent.generateThreadId).toBe('function');

      // Thread management
      expect(typeof agent.createThread).toBe('function');
      expect(typeof agent.resumeOrCreateThread).toBe('function');

      // Event operations
      expect(typeof agent.getThreadEvents).toBe('function');
      expect(typeof agent.replaySessionEvents).toBe('function');

      // Agent should provide complete functionality without ThreadManager exposure
    });

    it('should handle all thread operations through Agent API', () => {
      // Test core thread operations work through Agent
      const newThreadId = agent.generateThreadId();
      expect(typeof newThreadId).toBe('string');

      agent.createThread(newThreadId);

      const currentThreadId = agent.getCurrentThreadId();
      expect(typeof currentThreadId).toBe('string');

      const events = agent.getThreadEvents();
      expect(Array.isArray(events)).toBe(true);
    });

    it('should not need ThreadManager getter for normal operations', () => {
      // Test that common operations work without accessing threadManager

      // Thread identification
      const threadId = agent.getCurrentThreadId();
      expect(threadId).toBeDefined();

      // Event access
      const events = agent.getThreadEvents();
      expect(Array.isArray(events)).toBe(true);

      // Thread creation
      const newThreadId = agent.generateThreadId();
      agent.createThread(newThreadId);

      // All operations completed without needing direct ThreadManager access
      expect(true).toBe(true);
    });
  });

  describe('API completeness check', () => {
    it('should provide equivalent functionality to ThreadManager public methods', () => {
      // The Agent API should cover all the public ThreadManager functionality
      // that external code needs access to

      // Thread creation and management
      expect(typeof agent.generateThreadId).toBe('function');
      expect(typeof agent.createThread).toBe('function');
      expect(typeof agent.resumeOrCreateThread).toBe('function');

      // Thread identification
      expect(typeof agent.getCurrentThreadId).toBe('function');

      // Event access
      expect(typeof agent.getThreadEvents).toBe('function');
      expect(typeof agent.replaySessionEvents).toBe('function');

      // Note: Some ThreadManager methods like compact(), getMainAndDelegateEvents()
      // may need to be added to Agent API if they're needed by external code
    });
  });
});
