// ABOUTME: Unit tests for Agent thread event emission behavior
// ABOUTME: Tests verify Agent emits thread_event_added after ThreadManager operations

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent.js';
import { ThreadManager } from '~/threads/thread-manager.js';
import { ToolExecutor } from '~/tools/executor.js';
import { TestProvider } from '~/__tests__/utils/test-provider.js';
import { ThreadEvent } from '~/threads/types.js';
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

  describe('sendMessage', () => {
    it('should emit thread_event_added after ThreadManager.addEvent', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Test message',
          threadId: expect.any(String) as string,
        }) as ThreadEvent,
        threadId: expect.any(String) as string,
      });
    });

    it('should emit thread_event_added for agent response', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert - Should emit for both USER_MESSAGE and AGENT_MESSAGE
      expect(eventSpy).toHaveBeenCalledTimes(2);
      expect(eventSpy).toHaveBeenNthCalledWith(1, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Test message',
        }) as ThreadEvent,
        threadId: expect.any(String) as string,
      });
      expect(eventSpy).toHaveBeenNthCalledWith(2, {
        event: expect.objectContaining({
          type: 'AGENT_MESSAGE',
          data: expect.any(String) as string,
        }) as ThreadEvent,
        threadId: expect.any(String) as string,
      });
    });

    it('should emit thread_event_added with consistent threadId', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert - Both events should have same threadId
      expect(eventSpy).toHaveBeenCalledTimes(2);
      const firstCall: { event: ThreadEvent; threadId: string } = eventSpy.mock.calls[0][0];
      const secondCall: { event: ThreadEvent; threadId: string } = eventSpy.mock.calls[1][0];

      expect(firstCall.threadId).toBe(secondCall.threadId);
      expect(firstCall.event.threadId).toBe(secondCall.event.threadId);
    });
  });

  describe('replaySessionEvents', () => {
    it('should emit thread_event_added for all historical events', () => {
      // Arrange - Clear existing events and add test events
      const threadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(threadId);

      threadManager.addEvent(threadId, 'USER_MESSAGE', 'First message');
      threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'First response');
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Second message');

      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      agent.replaySessionEvents();

      // Assert
      expect(eventSpy).toHaveBeenCalledTimes(3);
      expect(eventSpy).toHaveBeenNthCalledWith(1, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'First message',
        }) as ThreadEvent,
        threadId,
      });
      expect(eventSpy).toHaveBeenNthCalledWith(2, {
        event: expect.objectContaining({
          type: 'AGENT_MESSAGE',
          data: 'First response',
        }) as ThreadEvent,
        threadId,
      });
      expect(eventSpy).toHaveBeenNthCalledWith(3, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Second message',
        }) as ThreadEvent,
        threadId,
      });
    });

    it('should replay events in chronological order', () => {
      // Arrange - Clear existing events and create test events with different timestamps
      const threadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(threadId);

      const event1 = threadManager.addEvent(threadId, 'USER_MESSAGE', 'Message 1');
      const event2 = threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Response 1');
      const event3 = threadManager.addEvent(threadId, 'USER_MESSAGE', 'Message 2');

      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      agent.replaySessionEvents();

      // Assert - Events should be emitted in chronological order
      expect(eventSpy).toHaveBeenCalledTimes(3);
      const calls: ThreadEvent[] = eventSpy.mock.calls.map(
        (call: [{ event: ThreadEvent; threadId: string }]) => call[0].event
      );

      expect(calls[0].timestamp.getTime()).toBeLessThanOrEqual(calls[1].timestamp.getTime());
      expect(calls[1].timestamp.getTime()).toBeLessThanOrEqual(calls[2].timestamp.getTime());

      expect(calls[0].id).toBe(event1.id);
      expect(calls[1].id).toBe(event2.id);
      expect(calls[2].id).toBe(event3.id);
    });

    it('should handle empty thread gracefully', () => {
      // Arrange - Clear thread to make it empty
      const threadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(threadId);

      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      agent.replaySessionEvents();

      // Assert
      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('thread management API', () => {
    it('should provide getCurrentThreadId method', () => {
      // Act
      const threadId = agent.getCurrentThreadId();

      // Assert
      expect(threadId).toBe(threadManager.getCurrentThreadId());
      expect(typeof threadId).toBe('string');
    });

    it('should provide getThreadEvents method', () => {
      // Arrange
      const threadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(threadId);
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');

      // Act
      const events = agent.getThreadEvents();

      // Assert
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('USER_MESSAGE');
      expect(events[0].data).toBe('Test message');
    });

    it('should provide getThreadEvents with specific threadId', () => {
      // Arrange
      const threadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(threadId);
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Specific thread message');

      // Act
      const events = agent.getThreadEvents(threadId);

      // Assert
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('Specific thread message');
    });

    it('should provide generateThreadId method', () => {
      // Act
      const threadId = agent.generateThreadId();

      // Assert
      expect(typeof threadId).toBe('string');
      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    });

    it('should provide createThread method', () => {
      // Arrange
      const newThreadId = agent.generateThreadId();

      // Act
      agent.createThread(newThreadId);

      // Assert
      const thread = threadManager.getThread(newThreadId);
      expect(thread).toBeDefined();
      expect(thread!.id).toBe(newThreadId);
    });

    it('should provide resumeOrCreateThread method that replays events on resume', () => {
      // Arrange
      const existingThreadId = threadManager.getCurrentThreadId()!;
      threadManager.clearEvents(existingThreadId);
      threadManager.addEvent(existingThreadId, 'USER_MESSAGE', 'Existing message');

      const eventSpy = vi.fn<(arg: { event: ThreadEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      const result = agent.resumeOrCreateThread(existingThreadId);

      // Assert
      expect(result.threadId).toBe(existingThreadId);
      expect(result.isResumed).toBe(true);
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Existing message',
        }) as ThreadEvent,
        threadId: existingThreadId,
      });
    });

    it('should provide resumeOrCreateThread method that creates new thread when needed', () => {
      // Act
      const result = agent.resumeOrCreateThread();

      // Assert
      expect(result.threadId).toBeDefined();
      expect(result.isResumed).toBe(false);
      expect(typeof result.threadId).toBe('string');
    });
  });
});
