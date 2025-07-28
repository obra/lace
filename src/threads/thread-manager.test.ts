// ABOUTME: Unit tests for ThreadManager data layer operations
// ABOUTME: Tests verify ThreadManager operates as pure data persistence layer

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';

describe('ThreadManager', () => {
  let threadManager: ThreadManager;

  beforeEach(() => {
    setupTestPersistence();
    threadManager = new ThreadManager();
  });

  afterEach(() => {
    threadManager.close();
    teardownTestPersistence();
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
      expect(event).not.toBeNull();
      expect(event!.type).toBe('USER_MESSAGE');
      expect(event!.data).toBe('Test message');
      expect(event!.threadId).toBe(threadId);

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
      expect(event1).not.toBeNull();
      expect(event2).not.toBeNull();
      expect(event1!.type).toBe('USER_MESSAGE');
      expect(event2!.type).toBe('AGENT_MESSAGE');

      const events = threadManager.getEvents(threadId);
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('Hello');
      expect(events[1].data).toBe('Hi there');
    });

    it('should handle duplicate tool approval responses correctly', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Act - First approval should succeed
      const firstEvent = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'tool-123',
        decision: 'approve',
      });
      expect(firstEvent).not.toBeNull();
      expect(threadManager.getEvents(threadId)).toHaveLength(1);

      // Second approval should be ignored due to database constraint
      const secondEvent = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'tool-123',
        decision: 'approve',
      });
      expect(secondEvent).toBeNull(); // Returns null for duplicates

      // Assert - Memory should still have only first event
      expect(threadManager.getEvents(threadId)).toHaveLength(1);
    });

    it('should handle thread not found gracefully', () => {
      // Act & Assert - Should throw for non-existent thread
      expect(() => {
        threadManager.addEvent('non-existent-thread', 'USER_MESSAGE', 'test');
      }).toThrow('Thread non-existent-thread not found');
    });
  });
});
