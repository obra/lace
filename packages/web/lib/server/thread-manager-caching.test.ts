// ABOUTME: Unit tests for ThreadManager caching issues
// ABOUTME: Tests to isolate the specific caching issue where getThread can't find delegate threads

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadManager } from '@/lib/server/lace-imports';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('ThreadManager Caching Issues', () => {
  let threadManager: ThreadManager;
  let parentThreadId: string;

  beforeEach(() => {
    setupTestPersistence();
    threadManager = new ThreadManager();

    // Create a parent thread
    parentThreadId = threadManager.createThread();
  });

  afterEach(() => {
    teardownTestPersistence();
  });

  it('should find delegate thread immediately after creation', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Immediately try to get the thread
    const retrievedThread = threadManager.getThread(delegateThreadId);

    // This should work
    expect(retrievedThread).toBeDefined();
    expect(retrievedThread?.id).toBe(delegateThreadId);
  });

  it('should find delegate thread from different ThreadManager instance', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Create new ThreadManager instance
    const newThreadManager = new ThreadManager();

    // Try to get the thread from the new instance
    const retrievedThread = newThreadManager.getThread(delegateThreadId);

    // This should work
    expect(retrievedThread).toBeDefined();
    expect(retrievedThread?.id).toBe(delegateThreadId);
  });

  it('should add event to delegate thread immediately after creation', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Try to add event immediately
    const event = threadManager.addEvent(delegateThreadId, 'USER_MESSAGE', 'Hello');

    // This should work
    expect(event).not.toBeNull();
    expect(event?.threadId).toBe(delegateThreadId);
    expect(event?.type).toBe('USER_MESSAGE');
    expect(event?.data).toBe('Hello');
  });

  it('should add event to delegate thread from different ThreadManager instance', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Create new ThreadManager instance
    const newThreadManager = new ThreadManager();

    // Try to add event from the new instance
    const event = newThreadManager.addEvent(
      delegateThreadId,
      'USER_MESSAGE',
      'Hello from new manager'
    );

    // This should work
    expect(event).not.toBeNull();
    expect(event?.threadId).toBe(delegateThreadId);
    expect(event?.type).toBe('USER_MESSAGE');
    expect(event?.data).toBe('Hello from new manager');
  });

  it('should handle multiple delegate threads correctly', () => {
    // Create multiple delegate threads
    const delegate1 = threadManager.createDelegateThreadFor(parentThreadId);
    const delegate2 = threadManager.createDelegateThreadFor(parentThreadId);

    // Both should be immediately retrievable
    const retrieved1 = threadManager.getThread(delegate1.id);
    const retrieved2 = threadManager.getThread(delegate2.id);

    expect(retrieved1).toBeDefined();
    expect(retrieved2).toBeDefined();
    expect(retrieved1?.id).toBe(delegate1.id);
    expect(retrieved2?.id).toBe(delegate2.id);

    // Should be able to add events to both
    const event1 = threadManager.addEvent(delegate1.id, 'USER_MESSAGE', 'Hello 1');
    const event2 = threadManager.addEvent(delegate2.id, 'USER_MESSAGE', 'Hello 2');

    expect(event1).not.toBeNull();
    expect(event2).not.toBeNull();
    expect(event1?.threadId).toBe(delegate1.id);
    expect(event2?.threadId).toBe(delegate2.id);
  });

  it('should handle delegate thread when parent exists', () => {
    // Create another thread (ThreadManager is stateless, no "current" concept)
    const _otherThreadId = threadManager.createThread();

    // Create delegate thread for original parent
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Should be able to get and use the delegate thread
    const retrievedThread = threadManager.getThread(delegateThreadId);
    expect(retrievedThread).toBeDefined();
    expect(retrievedThread?.id).toBe(delegateThreadId);

    // Should be able to add event
    const event = threadManager.addEvent(delegateThreadId, 'USER_MESSAGE', 'Hello delegate');
    expect(event).not.toBeNull();
    expect(event?.threadId).toBe(delegateThreadId);
  });
});
