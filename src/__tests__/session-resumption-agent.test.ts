// ABOUTME: Unit tests for session resumption using Agent API
// ABOUTME: Tests verify session resumption uses Agent.resumeOrCreateThread with automatic replay

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agents/agent.js';
import { ThreadManager } from '../threads/thread-manager.js';
import { ToolExecutor } from '../tools/executor.js';
import { TestProvider } from './utils/test-provider.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock the app's handleSession function with Agent API usage
async function handleSessionWithAgent(
  agent: Agent,
  continueMode?: boolean | string
): Promise<string> {
  let continueThreadId: string | undefined;
  if (continueMode) {
    if (typeof continueMode === 'string') {
      continueThreadId = continueMode;
    } else {
      // Use Agent API to get latest thread ID (not implemented yet, fallback for now)
      continueThreadId = agent.getCurrentThreadId() || undefined;
    }
  }

  const sessionInfo = await agent.resumeOrCreateThread(continueThreadId);
  const { threadId } = sessionInfo;

  if (sessionInfo.isResumed) {
    console.log(`📖 Continuing conversation ${threadId}`);
  } else if (sessionInfo.resumeError) {
    console.warn(`⚠️  ${sessionInfo.resumeError}`);
    console.log(`🆕 Starting new conversation ${threadId}`);
  } else {
    console.log(`🆕 Starting conversation ${threadId}`);
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
    await threadManager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('handleSessionWithAgent', () => {
    it('should use Agent.resumeOrCreateThread for session resumption', async () => {
      // Arrange
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');
      
      // Act
      await handleSessionWithAgent(agent, true);
      
      // Assert
      expect(resumeOrCreateThreadSpy).toHaveBeenCalled();
    });

    it('should replay events when resuming existing thread', async () => {
      // Arrange
      const existingThreadId = agent.getCurrentThreadId()!;
      threadManager.clearEvents(existingThreadId);
      threadManager.addEvent(existingThreadId, 'USER_MESSAGE', 'Previous message');
      
      const eventSpy = vi.fn();
      agent.on('thread_event_added', eventSpy);
      
      // Act
      const threadId = await handleSessionWithAgent(agent, existingThreadId);
      
      // Assert
      expect(threadId).toBe(existingThreadId);
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Previous message',
        }),
        threadId: existingThreadId,
      });
    });

    it('should create new thread when no existing thread specified', async () => {
      // Arrange
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');
      
      // Act
      const threadId = await handleSessionWithAgent(agent);
      
      // Assert
      expect(threadId).toBeDefined();
      expect(resumeOrCreateThreadSpy).toHaveBeenCalledWith(undefined);
    });

    it('should handle thread ID string for specific thread resumption', async () => {
      // Arrange
      const specificThreadId = 'test-thread-123';
      const resumeOrCreateThreadSpy = vi.spyOn(agent, 'resumeOrCreateThread');
      
      // Act
      await handleSessionWithAgent(agent, specificThreadId);
      
      // Assert
      expect(resumeOrCreateThreadSpy).toHaveBeenCalledWith(specificThreadId);
    });
  });
});