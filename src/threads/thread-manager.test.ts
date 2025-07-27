// ABOUTME: Unit tests for ThreadManager data layer operations
// ABOUTME: Tests verify ThreadManager operates as pure data persistence layer

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ThreadManager', () => {
  let threadManager: ThreadManager;
  let testDir: string;

  beforeEach(async () => {
    setupTestPersistence();
    testDir = await mkdtemp(join(tmpdir(), 'lace-test-'));
    threadManager = new ThreadManager();
  });

  afterEach(async () => {
    threadManager.close();
    teardownTestPersistence();
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

    it('should not update memory if database save fails', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Mock database to fail on second save
      const mockPersistence = vi.spyOn(threadManager['_persistence'], 'saveEvent');
      mockPersistence.mockImplementationOnce(() => {}); // First call succeeds
      mockPersistence.mockImplementationOnce(() => {
        throw new Error('Database error');
      });

      // Act - First event should succeed
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'hello');
      expect(threadManager.getEvents(threadId)).toHaveLength(1);

      // Second event should fail and not affect memory
      expect(() => {
        threadManager.addEvent(threadId, 'USER_MESSAGE', 'world');
      }).toThrow('Database error');

      // Assert - Memory should still have only first event
      expect(threadManager.getEvents(threadId)).toHaveLength(1);
    });

    it('should handle database constraint violations atomically', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Mock database to throw constraint violation on second save
      const mockPersistence = vi.spyOn(threadManager['_persistence'], 'saveEvent');
      mockPersistence.mockImplementationOnce(() => {}); // First call succeeds
      mockPersistence.mockImplementationOnce(() => {
        const error = new Error('UNIQUE constraint failed: events.thread_id, events.type, json_extract(events.data, \'$.toolCallId\')');
        (error as any).code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw error;
      });

      // Act - First approval should succeed
      threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', { toolCallId: 'tool-123', decision: 'approve' });
      expect(threadManager.getEvents(threadId)).toHaveLength(1);

      // Second approval should fail and not affect memory
      expect(() => {
        threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', { toolCallId: 'tool-123', decision: 'approve' });
      }).toThrow(/UNIQUE constraint failed/);

      // Assert - Memory should still have only first event
      expect(threadManager.getEvents(threadId)).toHaveLength(1);
    });
  });
});
