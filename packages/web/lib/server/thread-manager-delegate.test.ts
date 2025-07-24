// ABOUTME: Unit tests for ThreadManager delegate thread creation
// ABOUTME: Tests to isolate the agent spawning thread creation issue

/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadManager } from '@/lib/server/lace-imports';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('ThreadManager Delegate Thread Creation', () => {
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

  it('should create delegate thread and persist it', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);

    // Verify delegate thread properties
    expect(delegateThread.id).toMatch(new RegExp(`^${parentThreadId}\\.\\d+$`));
    expect(delegateThread.events).toEqual([]);
    expect(delegateThread.createdAt).toBeInstanceOf(Date);
    expect(delegateThread.updatedAt).toBeInstanceOf(Date);
  });

  it('should be able to retrieve delegate thread after creation', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Retrieve the delegate thread
    const retrievedThread = threadManager.getThread(delegateThreadId);

    // Verify it exists and has correct properties
    expect(retrievedThread).toBeDefined();
    expect(retrievedThread?.id).toBe(delegateThreadId);
    expect(retrievedThread?.events).toEqual([]);
  });

  it('should persist delegate thread to database', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Create a new ThreadManager instance to test persistence
    const newThreadManager = new ThreadManager();

    // Try to load the delegate thread
    const loadedThread = newThreadManager.getThread(delegateThreadId);

    // Verify it was persisted
    expect(loadedThread).toBeDefined();
    expect(loadedThread?.id).toBe(delegateThreadId);
  });

  it('should allow adding events to delegate thread', () => {
    // Create delegate thread
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);
    const delegateThreadId = delegateThread.id;

    // Add an event to the delegate thread
    const event = threadManager.addEvent(delegateThreadId, 'USER_MESSAGE', 'Hello delegate');

    // Verify event was added
    expect(event.threadId).toBe(delegateThreadId);
    expect(event.type).toBe('USER_MESSAGE');
    expect(event.data).toBe('Hello delegate');

    // Verify event persists
    const events = threadManager.getEvents(delegateThreadId);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(event.id);
  });

  it('should generate unique delegate thread IDs', () => {
    // Create multiple delegate threads
    const delegate1 = threadManager.createDelegateThreadFor(parentThreadId);
    const delegate2 = threadManager.createDelegateThreadFor(parentThreadId);
    const delegate3 = threadManager.createDelegateThreadFor(parentThreadId);

    // Delegate IDs available for debugging if needed

    // Verify they have unique IDs
    expect(delegate1.id).not.toBe(delegate2.id);
    expect(delegate2.id).not.toBe(delegate3.id);
    expect(delegate1.id).not.toBe(delegate3.id);

    // Verify they follow the pattern parentId.1, parentId.2, etc
    expect(delegate1.id).toBe(`${parentThreadId}.1`);
    expect(delegate2.id).toBe(`${parentThreadId}.2`);
    expect(delegate3.id).toBe(`${parentThreadId}.3`);
  });

  it('should handle delegate thread creation when parent thread exists', () => {
    // Create another thread (ThreadManager is stateless, no "current" concept)
    const otherThreadId = threadManager.createThread();

    // Create delegate thread for original parent
    const delegateThread = threadManager.createDelegateThreadFor(parentThreadId);

    // Verify delegate thread was created correctly
    expect(delegateThread.id).toMatch(new RegExp(`^${parentThreadId}\\.\\d+$`));

    // Verify it can be retrieved
    const retrievedThread = threadManager.getThread(delegateThread.id);
    expect(retrievedThread).toBeDefined();
    expect(retrievedThread?.id).toBe(delegateThread.id);
  });

  it('should throw error when trying to add event to non-existent delegate thread', () => {
    const nonExistentThreadId = `${parentThreadId}.999`;

    // Try to add event to non-existent thread
    expect(() => {
      threadManager.addEvent(nonExistentThreadId, 'USER_MESSAGE', 'Hello');
    }).toThrow(`Thread ${nonExistentThreadId} not found`);
  });
});
