// ABOUTME: Unit tests for ThreadManager data layer operations
// ABOUTME: Tests verify ThreadManager operates as pure data persistence layer

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { setupCoreTest } from '~/test-utils/core-test-setup';
import { expectEventAdded } from '~/test-utils/event-helpers';
import { ApprovalDecision } from '~/tools/approval-types';

describe('ThreadManager', () => {
  const _tempLaceDir = setupCoreTest();
  let threadManager: ThreadManager;

  beforeEach(() => {
    threadManager = new ThreadManager();
  });

  afterEach(() => {
    threadManager.close();
  });

  describe('addEvent', () => {
    it('should properly store events in database', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);

      // Act
      const event = expectEventAdded(
        threadManager.addEvent({
          type: 'USER_MESSAGE',
          threadId,
          data: 'Test message',
        })
      );

      // Assert
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
      const event1 = expectEventAdded(
        threadManager.addEvent({
          type: 'USER_MESSAGE',
          threadId,
          data: 'Hello',
        })
      );
      const event2 = expectEventAdded(
        threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Hi there')
      );

      // Assert - Data operations work correctly
      expect(event1.type).toBe('USER_MESSAGE');
      expect(event2.type).toBe('AGENT_MESSAGE');

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
      expectEventAdded(
        threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
          toolCallId: 'tool-123',
          decision: ApprovalDecision.ALLOW_ONCE,
        })
      );
      expect(threadManager.getEvents(threadId)).toHaveLength(1);

      // Second approval should be ignored due to database constraint
      const secondEvent = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
        toolCallId: 'tool-123',
        decision: ApprovalDecision.ALLOW_ONCE,
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

  describe('delegate thread creation', () => {
    it('should set sessionId on delegate threads', () => {
      const mainThreadId = 'lace_20250809_main';

      // Create main thread with sessionId
      threadManager.createThread(mainThreadId);
      const mainThread = threadManager.getThread(mainThreadId);
      mainThread!.sessionId = 'session_123';
      threadManager.saveThread(mainThread!);

      // Create delegate thread
      const delegateThread = threadManager.createDelegateThreadFor(mainThreadId);

      // Delegate should have same sessionId as parent
      expect(delegateThread.sessionId).toBe('session_123');
    });
  });
});
