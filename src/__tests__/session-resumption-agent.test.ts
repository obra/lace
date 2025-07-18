// ABOUTME: Unit tests for session resumption using Agent API
// ABOUTME: Tests verify session resumption uses Agent.resumeOrCreateThread with automatic replay

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/__tests__/utils/test-provider';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '~/utils/logger';

// Mock the app's handleSession function with Agent API usage
function handleSessionWithAgent(agent: Agent, continueMode?: boolean | string): string {
  let continueThreadId: string | undefined;
  if (continueMode) {
    if (typeof continueMode === 'string') {
      continueThreadId = continueMode;
    } else {
      // Use Agent API to get latest thread ID (not implemented yet, fallback for now)
      continueThreadId = agent.getCurrentThreadId() || undefined;
    }
  }

  const sessionInfo = agent.resumeOrCreateThread(continueThreadId);
  const { threadId } = sessionInfo;

  if (sessionInfo.isResumed) {
    logger.debug(`Continuing conversation ${threadId}`);
  } else if (sessionInfo.resumeError) {
    logger.debug(`Resume error: ${sessionInfo.resumeError}`);
    logger.debug(`Starting new conversation ${threadId}`);
  } else {
    logger.debug(`Starting conversation ${threadId}`);
  }

  return threadId;
}

describe('Session Resumption with Agent API', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-session-test-'));
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

  describe('handleSessionWithAgent', () => {
    it('should use Agent.resumeOrCreateThread for session resumption', () => {
      // Arrange
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');

      // Act
      handleSessionWithAgent(agent, true);

      // Assert
      expect(resumeOrCreateThreadSpy).toHaveBeenCalled();
    });

    it('should replay events when resuming existing thread', () => {
      // Arrange
      const existingThreadId = agent.getCurrentThreadId()!;
      threadManager.clearEvents(existingThreadId);
      threadManager.addEvent(existingThreadId, 'USER_MESSAGE', 'Previous message');

      const eventSpy = vi.fn();
      agent.on('thread_event_added', eventSpy);

      // Act
      const threadId = handleSessionWithAgent(agent, existingThreadId);

      // Assert
      expect(threadId).toBe(existingThreadId);
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Previous message',
        }) as object,
        threadId: existingThreadId,
      });
    });

    it('should create new thread when no existing thread specified', () => {
      // Arrange
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');

      // Act
      const threadId = handleSessionWithAgent(agent);

      // Assert
      expect(threadId).toBeDefined();
      expect(resumeOrCreateThreadSpy).toHaveBeenCalledWith(undefined);
    });

    it('should handle thread ID string for specific thread resumption', () => {
      // Arrange
      const specificThreadId = 'test-thread-123';
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');

      // Act
      handleSessionWithAgent(agent, specificThreadId);

      // Assert
      expect(resumeOrCreateThreadSpy).toHaveBeenCalledWith(specificThreadId);
    });
  });
});
