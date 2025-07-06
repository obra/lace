// ABOUTME: Unit tests for Agent thread event emission behavior
// ABOUTME: Tests verify Agent emits thread_event_added after ThreadManager operations

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '../agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { ToolExecutor } from '../../tools/executor.js';
import { TestProvider } from '../../__tests__/utils/test-provider.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Agent Thread Events', () => {
  let agent: Agent;
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-agent-test-'));
    threadManager = new ThreadManager(join(testDir, 'test.db'));
    
    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor([], {});
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

  describe('sendMessage', () => {
    it('should emit thread_event_added after ThreadManager.addEvent', async () => {
      // Arrange
      const eventSpy = vi.fn();
      agent.on('thread_event_added', eventSpy);
      
      // Act
      await agent.sendMessage('Test message');
      
      // Assert
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Test message',
          threadId: expect.any(String),
        }),
        threadId: expect.any(String),
      });
    });

    it('should emit thread_event_added for agent response', async () => {
      // Arrange
      const eventSpy = vi.fn();
      agent.on('thread_event_added', eventSpy);
      
      // Act
      await agent.sendMessage('Test message');
      
      // Assert - Should emit for both USER_MESSAGE and AGENT_MESSAGE
      expect(eventSpy).toHaveBeenCalledTimes(2);
      expect(eventSpy).toHaveBeenNthCalledWith(1, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Test message',
        }),
        threadId: expect.any(String),
      });
      expect(eventSpy).toHaveBeenNthCalledWith(2, {
        event: expect.objectContaining({
          type: 'AGENT_MESSAGE',
          data: expect.any(String),
        }),
        threadId: expect.any(String),
      });
    });

    it('should emit thread_event_added with consistent threadId', async () => {
      // Arrange
      const eventSpy = vi.fn();
      agent.on('thread_event_added', eventSpy);
      
      // Act
      await agent.sendMessage('Test message');
      
      // Assert - Both events should have same threadId
      expect(eventSpy).toHaveBeenCalledTimes(2);
      const firstCall = eventSpy.mock.calls[0][0];
      const secondCall = eventSpy.mock.calls[1][0];
      
      expect(firstCall.threadId).toBe(secondCall.threadId);
      expect(firstCall.event.threadId).toBe(secondCall.event.threadId);
    });
  });
});