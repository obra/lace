import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { setupCoreTest } from '~/test-utils/core-test-setup';

describe('ThreadManager - Core Behavior', () => {
  const _tempLaceDir = setupCoreTest();
  let threadManager: ThreadManager;
  let threadId: string;

  beforeEach(() => {
    threadManager = new ThreadManager();
    threadId = threadManager.createThread();
  });

  afterEach(() => {
    // Test cleanup handled by setupCoreTest
  });

  describe('Core thread operations', () => {
    it('creates thread and returns thread ID', () => {
      const newThreadId = threadManager.createThread();
      expect(newThreadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
    });

    it('adds events to specific thread', () => {
      expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello'));
      expectEventAdded(threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there'));

      const events = threadManager.getEvents(threadId);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('USER_MESSAGE');
      expect(events[1].type).toBe('AGENT_MESSAGE');
    });

    it('retrieves events from specific thread', () => {
      const thread1 = threadManager.createThread();
      const thread2 = threadManager.createThread();

      expectEventAdded(threadManager.addEvent(thread1, 'USER_MESSAGE', 'Thread 1 message'));
      expectEventAdded(threadManager.addEvent(thread2, 'USER_MESSAGE', 'Thread 2 message'));

      const events1 = threadManager.getEvents(thread1);
      const events2 = threadManager.getEvents(thread2);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].data).toBe('Thread 1 message');
      expect(events2[0].data).toBe('Thread 2 message');
    });

    it('handles non-existent thread gracefully', () => {
      const events = threadManager.getEvents('non-existent-thread');
      expect(events).toEqual([]);
    });
  });

  describe('Thread persistence', () => {
    it('persists thread data across ThreadManager instances', () => {
      expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Persistent message'));

      // Create new ThreadManager instance
      const newManager = new ThreadManager();
      const events = newManager.getEvents(threadId);

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('Persistent message');
    });
  });

  describe('Delegate thread support', () => {
    it('creates delegate threads with proper naming', () => {
      const delegate1 = threadManager.generateDelegateThreadId(threadId);
      threadManager.createThread(delegate1); // Create the thread so it's counted
      const delegate2 = threadManager.generateDelegateThreadId(threadId);

      expect(delegate1).toBe(`${threadId}.1`);
      expect(delegate2).toBe(`${threadId}.2`);
    });

    it('maintains separate event streams for delegates', () => {
      const delegateId = threadManager.generateDelegateThreadId(threadId);
      threadManager.createThread(delegateId);

      expectEventAdded(threadManager.addEvent(threadId, 'USER_MESSAGE', 'Parent message'));
      expectEventAdded(threadManager.addEvent(delegateId, 'USER_MESSAGE', 'Delegate message'));

      const parentEvents = threadManager.getEvents(threadId);
      const delegateEvents = threadManager.getEvents(delegateId);

      expect(parentEvents).toHaveLength(1);
      expect(delegateEvents).toHaveLength(1);
      expect(parentEvents[0].data).toBe('Parent message');
      expect(delegateEvents[0].data).toBe('Delegate message');
    });
  });
});
