// ABOUTME: Unit tests for Agent thread event emission behavior
// ABOUTME: Tests verify Agent emits thread_event_added after ThreadManager operations

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Agent } from '~/agents/agent';
import { ThreadManager } from '~/threads/thread-manager';
import { ToolExecutor } from '~/tools/executor';
import { TestProvider } from '~/test-utils/test-provider';
import { LaceEvent } from '~/threads/types';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { createTestTempDir } from '~/test-utils/temp-directory';

describe('Agent Thread Events', () => {
  const _tempLaceDir = setupCoreTest();
  const tempDir = createTestTempDir('lace-agent-test-');
  let agent: Agent;
  let threadManager: ThreadManager;

  beforeEach(async () => {
    // setupTestPersistence replaced by setupCoreTest
    await tempDir.getPath();
    threadManager = new ThreadManager();

    const provider = new TestProvider();
    const toolExecutor = new ToolExecutor();
    const threadId = threadManager.generateThreadId();
    threadManager.createThread(threadId);

    agent = new Agent({
      toolExecutor,
      threadManager,
      threadId,
      tools: [],
      metadata: {
        name: 'test-agent',
        modelId: 'test-model',
        providerInstanceId: 'test-instance',
      },
    });

    // Mock provider creation for test
    vi.spyOn(agent, '_createProviderInstance' as any).mockResolvedValue(provider);

    await agent.start();

    // Set model metadata for the agent (required for model-agnostic providers)
    agent.updateThreadMetadata({
      modelId: 'test-model',
      providerInstanceId: 'test-instance',
    });
  });

  afterEach(async () => {
    threadManager.close();
    // Test cleanup handled by setupCoreTest
    await tempDir.cleanup();
  });

  describe('sendMessage', () => {
    it('should emit thread_event_added after ThreadManager.addEvent', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert
      expect(eventSpy).toHaveBeenCalledWith({
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Test message',
          context: { threadId: expect.any(String) as string },
        }) as LaceEvent,
        threadId: expect.any(String) as string,
      });
    });

    it('should emit thread_event_added for agent response', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert - Should emit for USER_MESSAGE and AGENT_MESSAGE (and possibly system prompts)
      // Filter to only check the events we care about
      const userMessageCalls = eventSpy.mock.calls.filter(
        (call) => call[0].event.type === 'USER_MESSAGE'
      );
      const agentMessageCalls = eventSpy.mock.calls.filter(
        (call) => call[0].event.type === 'AGENT_MESSAGE'
      );

      expect(userMessageCalls).toHaveLength(1);
      expect(agentMessageCalls).toHaveLength(1);

      // Check USER_MESSAGE event
      expect(userMessageCalls[0][0].event.type).toBe('USER_MESSAGE');
      expect(userMessageCalls[0][0].event.data).toBe('Test message');
      expect(typeof userMessageCalls[0][0].event.context?.threadId).toBe('string');

      // Check AGENT_MESSAGE event
      expect(agentMessageCalls[0][0].event.type).toBe('AGENT_MESSAGE');
      expect((agentMessageCalls[0][0].event.data as { content: string }).content).toBeDefined();
      expect(typeof agentMessageCalls[0][0].event.context?.threadId).toBe('string');
    });

    it('should emit thread_event_added with consistent threadId', async () => {
      // Arrange
      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      await agent.sendMessage('Test message');

      // Assert - All events should have same threadId
      // Filter to only check USER_MESSAGE and AGENT_MESSAGE
      const relevantCalls = eventSpy.mock.calls.filter(
        (call) => call[0].event.type === 'USER_MESSAGE' || call[0].event.type === 'AGENT_MESSAGE'
      );

      expect(relevantCalls).toHaveLength(2);
      const firstCall: { event: LaceEvent; threadId: string } = relevantCalls[0][0];
      const secondCall: { event: LaceEvent; threadId: string } = relevantCalls[1][0];

      expect(firstCall.threadId).toBe(secondCall.threadId);
      expect(firstCall.event.context?.threadId).toBe(secondCall.event.context?.threadId);
    });
  });

  describe('replaySessionEvents', () => {
    it('should emit thread_event_added for all historical events', () => {
      // Arrange - Clear existing events and add test events
      const threadId = agent.getThreadId();
      threadManager.clearEvents(threadId);

      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'First message',
      });
      threadManager.addEvent({
        type: 'AGENT_MESSAGE',
        context: { threadId },
        data: { content: 'First response' },
      });
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Second message',
      });

      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      agent.replaySessionEvents();

      // Assert
      expect(eventSpy).toHaveBeenCalledTimes(3);
      expect(eventSpy).toHaveBeenNthCalledWith(1, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'First message',
        }) as LaceEvent,
        threadId,
      });
      expect(eventSpy).toHaveBeenNthCalledWith(2, {
        event: expect.objectContaining({
          type: 'AGENT_MESSAGE',
          data: { content: 'First response' },
        }) as LaceEvent,
        threadId,
      });
      expect(eventSpy).toHaveBeenNthCalledWith(3, {
        event: expect.objectContaining({
          type: 'USER_MESSAGE',
          data: 'Second message',
        }) as LaceEvent,
        threadId,
      });
    });

    it('should replay events in chronological order', () => {
      // Arrange - Clear existing events and create test events with different timestamps
      const threadId = agent.getThreadId();
      threadManager.clearEvents(threadId);

      const event1 = expectEventAdded(
        threadManager.addEvent({
          type: 'USER_MESSAGE',
          context: { threadId },
          data: 'Message 1',
        })
      );
      const event2 = expectEventAdded(
        threadManager.addEvent({
          type: 'AGENT_MESSAGE',
          context: { threadId },
          data: { content: 'Response 1' },
        })
      );
      const event3 = expectEventAdded(
        threadManager.addEvent({
          type: 'USER_MESSAGE',
          context: { threadId },
          data: 'Message 2',
        })
      );

      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
      agent.on('thread_event_added', eventSpy);

      // Act
      agent.replaySessionEvents();

      // Assert - Events should be emitted in chronological order
      expect(eventSpy).toHaveBeenCalledTimes(3);
      const calls: LaceEvent[] = eventSpy.mock.calls.map(
        (call: [{ event: LaceEvent; threadId: string }]) => call[0].event
      );

      expect(calls[0].timestamp!.getTime()).toBeLessThanOrEqual(calls[1].timestamp!.getTime());
      expect(calls[1].timestamp!.getTime()).toBeLessThanOrEqual(calls[2].timestamp!.getTime());

      expect(calls[0].id).toBe(event1.id);
      expect(calls[1].id).toBe(event2.id);
      expect(calls[2].id).toBe(event3.id);
    });

    it('should handle empty thread gracefully', () => {
      // Arrange - Clear thread to make it empty
      const threadId = agent.getThreadId();
      threadManager.clearEvents(threadId);

      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
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
      const threadId = agent.getThreadId();

      // Assert
      expect(threadId).toBe(agent.getThreadId());
      expect(typeof threadId).toBe('string');
    });

    it('should provide getLaceEvents method', () => {
      // Arrange
      const threadId = agent.getThreadId();
      threadManager.clearEvents(threadId);
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Test message',
      });

      // Act
      const events = agent.getLaceEvents();

      // Assert
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('USER_MESSAGE');
      expect(events[0].data).toBe('Test message');
    });

    it('should provide getLaceEvents with specific threadId', () => {
      // Arrange
      const threadId = agent.getThreadId();
      threadManager.clearEvents(threadId);
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId },
        data: 'Specific thread message',
      });

      // Act
      const events = agent.getLaceEvents(threadId);

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
      const existingThreadId = agent.getThreadId();
      threadManager.clearEvents(existingThreadId);
      threadManager.addEvent({
        type: 'USER_MESSAGE',
        context: { threadId: existingThreadId },
        data: 'Existing message',
      });

      const eventSpy = vi.fn<(arg: { event: LaceEvent; threadId: string }) => void>();
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
        }) as LaceEvent,
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
