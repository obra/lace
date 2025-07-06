// ABOUTME: Unit tests for ThreadManager focusing on event emission behavior
// ABOUTME: Tests verify ThreadManager becomes pure data layer without event emission

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThreadManager } from '../thread-manager.js';
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
    it('should NOT emit event_added during normal operation', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);
      
      const eventSpy = vi.fn();
      threadManager.on('event_added', eventSpy);
      
      // Act
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');
      
      // Assert
      expect(eventSpy).not.toHaveBeenCalled();
    });

    it('should still properly store events in database', () => {
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

    it('should NOT emit thread_updated during normal operation', () => {
      // Arrange
      const threadId = threadManager.generateThreadId();
      threadManager.createThread(threadId);
      
      const eventSpy = vi.fn();
      threadManager.on('thread_updated', eventSpy);
      
      // Act
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');
      
      // Assert
      expect(eventSpy).not.toHaveBeenCalled();
    });
  });
});