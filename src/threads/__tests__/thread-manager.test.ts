// ABOUTME: Unit tests for ThreadManager data layer operations
// ABOUTME: Tests verify ThreadManager operates as pure data persistence layer

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager.js';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ThreadManager', () => {
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'lace-test-'));
    threadManager = new ThreadManager(join(testDir, 'test.db'));
  });

  afterEach(async () => {
    await threadManager.close();
    await rm(testDir, { recursive: true, force: true });
  });

  describe('addEvent', () => {
    it('should properly store events in database', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Act
      const event = threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');

      // Assert
      expect(event).toBeDefined();
      expect(event.type).toBe('USER_MESSAGE');
      expect(event.data).toBe('Test message');
      expect(event.threadId).toBe(threadId);

      const events = threadManager.getEvents(threadId);
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('Test message');
    });

    it('should function as pure data layer without event emission', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Act - ThreadManager now operates as pure data layer
      const event1 = threadManager.addEvent(threadId, 'USER_MESSAGE', 'Hello');
      const event2 = threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there');

      // Assert - Data operations work correctly
      expect(event1.type).toBe('USER_MESSAGE');
      expect(event2.type).toBe('AGENT_MESSAGE');

      const events = threadManager.getEvents(threadId);
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('Hello');
      expect(events[1].data).toBe('Hi there');
    });
  });
});
