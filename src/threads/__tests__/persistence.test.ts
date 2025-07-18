// ABOUTME: Comprehensive test suite for thread persistence system
// ABOUTME: Tests ThreadPersistence, enhanced ThreadManager, and integration scenarios

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { DatabasePersistence } from '~/persistence/database';
import { ThreadManager } from '~/threads/thread-manager';
import { Thread, ThreadEvent, EventType } from '~/threads/types';

describe('DatabasePersistence (Thread Features)', () => {
  let tempDbPath: string;
  let persistence: DatabasePersistence;

  beforeEach(() => {
    // Create temporary database file
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
    persistence = new DatabasePersistence(tempDbPath);
  });

  afterEach(() => {
    persistence.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('initialization', () => {
    it('should create database file', () => {
      expect(fs.existsSync(tempDbPath)).toBe(true);
    });

    it('should create required tables', () => {
      const db = new Database(tempDbPath);

      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('threads', 'events', 'tasks', 'task_notes')
      `
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(4);
      expect(tables.map((t) => t.name)).toContain('threads');
      expect(tables.map((t) => t.name)).toContain('events');
      expect(tables.map((t) => t.name)).toContain('tasks');
      expect(tables.map((t) => t.name)).toContain('task_notes');

      db.close();
    });

    it('should create required indexes', () => {
      const db = new Database(tempDbPath);

      const indexes = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='index' AND name LIKE 'idx_%'
      `
        )
        .all() as Array<{ name: string }>;

      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes.map((i) => i.name)).toContain('idx_events_thread_timestamp');
      expect(indexes.map((i) => i.name)).toContain('idx_threads_updated');

      db.close();
    });

    it('should create version management tables', () => {
      const db = new Database(tempDbPath);

      const tables = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('thread_versions', 'version_history')
      `
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(2);
      expect(tables.map((t) => t.name)).toContain('thread_versions');
      expect(tables.map((t) => t.name)).toContain('version_history');

      db.close();
    });
  });

  describe('thread operations', () => {
    it('should save and load a thread', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:30:00Z'),
        events: [],
      };

      persistence.saveThread(thread);
      const loaded = persistence.loadThread('test_thread_123');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('test_thread_123');
      expect(loaded!.createdAt).toEqual(thread.createdAt);
      expect(loaded!.updatedAt).toEqual(thread.updatedAt);
      expect(loaded!.events).toEqual([]);
    });

    it('should return null for non-existent thread', () => {
      const loaded = persistence.loadThread('non_existent');
      expect(loaded).toBeNull();
    });

    it('should update existing thread on save', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:30:00Z'),
        events: [],
      };

      persistence.saveThread(thread);

      // Update and save again
      thread.updatedAt = new Date('2025-01-01T11:00:00Z');
      persistence.saveThread(thread);

      const loaded = persistence.loadThread('test_thread_123');
      expect(loaded!.updatedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
    });
  });

  describe('event operations', () => {
    it('should save and load events', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(thread);

      const event: ThreadEvent = {
        id: 'evt_123',
        threadId: 'test_thread_123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        data: 'Hello world',
      };

      persistence.saveEvent(event);
      const events = persistence.loadEvents('test_thread_123');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt_123');
      expect(events[0].type).toBe('USER_MESSAGE');
      expect(events[0].data).toBe('Hello world');
      expect(events[0].timestamp).toEqual(new Date('2025-01-01T10:00:00Z'));
    });

    it('should load events in chronological order', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(thread);

      const events = [
        {
          id: 'evt_3',
          threadId: 'test_thread_123',
          type: 'USER_MESSAGE' as EventType,
          timestamp: new Date('2025-01-01T10:02:00Z'),
          data: 'Third message',
        },
        {
          id: 'evt_1',
          threadId: 'test_thread_123',
          type: 'USER_MESSAGE' as EventType,
          timestamp: new Date('2025-01-01T10:00:00Z'),
          data: 'First message',
        },
        {
          id: 'evt_2',
          threadId: 'test_thread_123',
          type: 'AGENT_MESSAGE' as EventType,
          timestamp: new Date('2025-01-01T10:01:00Z'),
          data: 'Second message',
        },
      ];

      // Save events out of order
      for (const event of events) {
        persistence.saveEvent(event);
      }

      const loaded = persistence.loadEvents('test_thread_123');

      expect(loaded).toHaveLength(3);
      expect(loaded[0].id).toBe('evt_1'); // First chronologically
      expect(loaded[1].id).toBe('evt_2'); // Second chronologically
      expect(loaded[2].id).toBe('evt_3'); // Third chronologically
    });

    it('should handle complex event data', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(thread);

      const complexData = {
        id: 'call_123',
        name: 'bash',
        arguments: {
          command: 'ls -la',
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
          },
        },
      };

      const event: ThreadEvent = {
        id: 'evt_complex',
        threadId: 'test_thread_123',
        type: 'TOOL_CALL',
        timestamp: new Date(),
        data: complexData,
      };

      persistence.saveEvent(event);
      const events = persistence.loadEvents('test_thread_123');

      expect(events).toHaveLength(1);
      expect(events[0].data).toEqual(complexData);
    });

    it('should update thread timestamp when saving event', () => {
      const thread: Thread = {
        id: 'test_thread_123',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:00:00Z'),
        events: [],
      };
      persistence.saveThread(thread);

      const event: ThreadEvent = {
        id: 'evt_123',
        threadId: 'test_thread_123',
        type: 'USER_MESSAGE',
        timestamp: new Date('2025-01-01T10:30:00Z'),
        data: 'Hello',
      };

      const saveTime = new Date();
      persistence.saveEvent(event);

      const loaded = persistence.loadThread('test_thread_123');
      expect(loaded!.updatedAt.getTime()).toBeGreaterThanOrEqual(saveTime.getTime() - 1000);
    });
  });

  describe('thread discovery', () => {
    it('should return latest thread ID', () => {
      const threads = [
        {
          id: 'thread_old',
          createdAt: new Date('2025-01-01T10:00:00Z'),
          updatedAt: new Date('2025-01-01T10:00:00Z'),
          events: [],
        },
        {
          id: 'thread_latest',
          createdAt: new Date('2025-01-01T11:00:00Z'),
          updatedAt: new Date('2025-01-01T12:00:00Z'), // Most recently updated
          events: [],
        },
        {
          id: 'thread_middle',
          createdAt: new Date('2025-01-01T10:30:00Z'),
          updatedAt: new Date('2025-01-01T11:30:00Z'),
          events: [],
        },
      ];

      for (const thread of threads) {
        persistence.saveThread(thread);
      }

      const latestId = persistence.getLatestThreadId();
      expect(latestId).toBe('thread_latest');
    });

    it('should return null when no threads exist', () => {
      const latestId = persistence.getLatestThreadId();
      expect(latestId).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON in event data gracefully', () => {
      // Manually insert malformed JSON
      const db = new Database(tempDbPath);
      db.prepare(
        `
        INSERT INTO threads (id, created_at, updated_at)
        VALUES ('test_thread', '2025-01-01T10:00:00Z', '2025-01-01T10:00:00Z')
      `
      ).run();

      db.prepare(
        `
        INSERT INTO events (id, thread_id, type, timestamp, data)
        VALUES ('evt_bad', 'test_thread', 'USER_MESSAGE', '2025-01-01T10:00:00Z', 'invalid json')
      `
      ).run();
      db.close();

      // Should throw when trying to load events with invalid JSON
      expect(() => persistence.loadEvents('test_thread')).toThrow();
    });
  });

  describe('version management', () => {
    it('should return null for non-versioned threads', () => {
      const currentVersion = persistence.getCurrentVersion('non_existent');
      expect(currentVersion).toBeNull();
    });

    it('should create and retrieve thread versions', () => {
      const canonicalId = 'thread_canonical_123';
      const versionId = 'thread_version_456';
      const reason = 'Created shadow for compaction';

      // Create the version thread first to satisfy foreign key constraint
      const versionThread: Thread = {
        id: versionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(versionThread);

      persistence.createVersion(canonicalId, versionId, reason);
      const currentVersion = persistence.getCurrentVersion(canonicalId);

      expect(currentVersion).toBe(versionId);
    });

    it('should update existing version', () => {
      const canonicalId = 'thread_canonical_123';
      const firstVersionId = 'thread_version_456';
      const secondVersionId = 'thread_version_789';

      // Create both version threads
      const firstThread: Thread = {
        id: firstVersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      const secondThread: Thread = {
        id: secondVersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(firstThread);
      persistence.saveThread(secondThread);

      persistence.createVersion(canonicalId, firstVersionId, 'First version');
      persistence.createVersion(canonicalId, secondVersionId, 'Second version');

      const currentVersion = persistence.getCurrentVersion(canonicalId);
      expect(currentVersion).toBe(secondVersionId);
    });

    it('should track version history', async () => {
      const canonicalId = 'thread_canonical_123';
      const firstVersionId = 'thread_version_456';
      const secondVersionId = 'thread_version_789';

      // Create both version threads
      const firstThread: Thread = {
        id: firstVersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      const secondThread: Thread = {
        id: secondVersionId,
        createdAt: new Date(),
        updatedAt: new Date(),
        events: [],
      };
      persistence.saveThread(firstThread);
      persistence.saveThread(secondThread);

      persistence.createVersion(canonicalId, firstVersionId, 'First version');
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      persistence.createVersion(canonicalId, secondVersionId, 'Second version');

      const history = persistence.getVersionHistory(canonicalId);
      expect(history).toHaveLength(2);
      expect(history[0].versionId).toBe(secondVersionId); // Most recent first
      expect(history[0].reason).toBe('Second version');
      expect(history[1].versionId).toBe(firstVersionId);
      expect(history[1].reason).toBe('First version');
    });

    it('should load current version when accessing canonical ID', () => {
      // Create a thread
      const originalThread: Thread = {
        id: 'thread_version_456',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:30:00Z'),
        events: [],
      };
      persistence.saveThread(originalThread);

      // Create version mapping
      const canonicalId = 'thread_canonical_123';
      persistence.createVersion(canonicalId, 'thread_version_456', 'Shadow creation');

      // Load using canonical ID should return the version
      const loaded = persistence.loadThread(canonicalId);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('thread_version_456');
      expect(loaded!.createdAt).toEqual(originalThread.createdAt);
    });

    it('should load normally for non-versioned threads', () => {
      const thread: Thread = {
        id: 'normal_thread_123',
        createdAt: new Date('2025-01-01T10:00:00Z'),
        updatedAt: new Date('2025-01-01T10:30:00Z'),
        events: [],
      };
      persistence.saveThread(thread);

      const loaded = persistence.loadThread('normal_thread_123');
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('normal_thread_123');
    });
  });
});

describe('Enhanced ThreadManager', () => {
  let tempDbPath: string;
  let threadManager: ThreadManager;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
    threadManager = new ThreadManager(tempDbPath);
  });

  afterEach(() => {
    threadManager.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('existing API compatibility', () => {
    it('should preserve createThread behavior', () => {
      const thread = threadManager.createThread('test_123');

      expect(thread.id).toBe('test_123');
      expect(thread.events).toEqual([]);
      expect(thread.createdAt).toBeInstanceOf(Date);
      expect(thread.updatedAt).toBeInstanceOf(Date);
    });

    it('should preserve getThread behavior', () => {
      threadManager.createThread('test_123');

      const thread = threadManager.getThread('test_123');
      expect(thread).not.toBeUndefined();
      expect(thread!.id).toBe('test_123');

      const nonExistent = threadManager.getThread('non_existent');
      expect(nonExistent).toBeUndefined();
    });

    it('should preserve addEvent behavior', () => {
      threadManager.createThread('test_123');

      const event = threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');

      expect(event.threadId).toBe('test_123');
      expect(event.type).toBe('USER_MESSAGE');
      expect(event.data).toBe('Hello');
      expect(event.id).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });

    it('should preserve getEvents behavior', () => {
      threadManager.createThread('test_123');
      threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');
      threadManager.addEvent('test_123', 'AGENT_MESSAGE', 'Hi there');

      const events = threadManager.getEvents('test_123');
      expect(events).toHaveLength(2);
      expect(events[0].data).toBe('Hello');
      expect(events[1].data).toBe('Hi there');
    });
  });

  describe('persistence integration', () => {
    it('should save events to database immediately', () => {
      threadManager.createThread('test_123');
      threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');

      // Create new manager to verify persistence (events saved immediately)
      threadManager.close();
      const newManager = new ThreadManager(tempDbPath);

      const loadedThread = newManager.loadThread('test_123');
      expect(loadedThread.events).toHaveLength(1);
      expect(loadedThread.events[0].data).toBe('Hello');

      newManager.close();
    });

    it('should load thread from database', () => {
      // Create and save thread with first manager
      threadManager.createThread('test_123');
      threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');
      threadManager.addEvent('test_123', 'AGENT_MESSAGE', 'Hi');
      threadManager.saveCurrentThread();
      threadManager.close();

      // Load with new manager
      const newManager = new ThreadManager(tempDbPath);
      const thread = newManager.loadThread('test_123');

      expect(thread.id).toBe('test_123');
      expect(thread.events).toHaveLength(2);
      expect(thread.events[0].data).toBe('Hello');
      expect(thread.events[1].data).toBe('Hi');

      newManager.close();
    });

    it('should set current thread from database', () => {
      // Create and save thread
      threadManager.createThread('test_123');
      threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');
      threadManager.saveCurrentThread();

      // Create new thread and switch to database thread
      threadManager.createThread('test_456');
      threadManager.setCurrentThread('test_123');

      expect(threadManager.getCurrentThreadId()).toBe('test_123');

      const events = threadManager.getEvents('test_123');
      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('Hello');
    });

    it('should get latest thread ID', async () => {
      threadManager.createThread('test_old');
      threadManager.saveCurrentThread();

      // Wait a moment to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      threadManager.createThread('test_new');
      threadManager.addEvent('test_new', 'USER_MESSAGE', 'Latest');
      threadManager.saveCurrentThread();

      const latestId = threadManager.getLatestThreadId();
      expect(latestId).toBe('test_new');
    });
  });

  describe('error handling', () => {
    it('should throw error when adding event to non-existent thread', () => {
      expect(() => {
        threadManager.addEvent('non_existent', 'USER_MESSAGE', 'Hello');
      }).toThrow('Thread non_existent not found');
    });

    it('should throw error when loading non-existent thread', () => {
      expect(() => threadManager.loadThread('non_existent')).toThrow(
        'Thread non_existent not found in database'
      );
    });

    it('should handle database connection issues gracefully', () => {
      // Close database to simulate connection issue
      threadManager.close();

      // Should not throw when adding events (they just won't be persisted)
      threadManager.createThread('test_123');
      const event = threadManager.addEvent('test_123', 'USER_MESSAGE', 'Hello');
      expect(event.data).toBe('Hello');
    });
  });

  describe('thread compaction', () => {
    it('should create compacted thread and update version mapping', () => {
      const originalThreadId = 'lace_20250101_abc123';
      threadManager.createThread(originalThreadId);
      threadManager.addEvent(originalThreadId, 'USER_MESSAGE', 'Original message');

      const compactedThreadId = threadManager.createShadowThread('Compaction needed');

      expect(compactedThreadId).not.toBe(originalThreadId);
      expect(compactedThreadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadManager.getCurrentThreadId()).toBe(compactedThreadId);

      // Verify compacted thread has the events (may be compacted)
      const compactedEvents = threadManager.getEvents(compactedThreadId);
      expect(compactedEvents.length).toBeGreaterThan(0);
      // With default compaction strategy, 1 event should be preserved
      expect(compactedEvents).toHaveLength(1);
      expect(compactedEvents[0].data).toBe('Original message');
    });

    it('should maintain canonical ID mapping', () => {
      const originalThreadId = 'lace_20250101_abc123';
      threadManager.createThread(originalThreadId);

      const compactedThreadId = threadManager.createShadowThread('First compaction');
      const secondCompactedThreadId = threadManager.createShadowThread('Second compaction');

      // All should resolve to the same canonical ID
      expect(threadManager.getCanonicalId(originalThreadId)).toBe(originalThreadId);
      expect(threadManager.getCanonicalId(compactedThreadId)).toBe(originalThreadId);
      expect(threadManager.getCanonicalId(secondCompactedThreadId)).toBe(originalThreadId);
    });

    it('should throw error when no current thread', () => {
      expect(() => threadManager.createShadowThread('Test')).toThrow(
        'No current thread to compact'
      );
    });

    it('should compact events when creating compacted thread', () => {
      const originalThreadId = 'lace_20250101_abc123';
      threadManager.createThread(originalThreadId);

      // Add enough events to trigger compaction
      for (let i = 0; i < 15; i++) {
        threadManager.addEvent(originalThreadId, 'USER_MESSAGE', `Message ${i}`);
      }

      const compactedThreadId = threadManager.createShadowThread('Test compaction');
      const compactedEvents = threadManager.getEvents(compactedThreadId);

      // Should have all user messages preserved since we now preserve all user/agent messages
      // With 15 USER_MESSAGE events, all should be preserved (no summary needed)
      expect(compactedEvents.length).toBe(15); // All user messages preserved

      // All events should be user messages (no summary created since all events are preserved)
      expect(compactedEvents.every((e) => e.type === 'USER_MESSAGE')).toBe(true);
    });

    it('should detect when compaction is needed', async () => {
      const originalThreadId = 'lace_20250101_abc123';
      threadManager.createThread(originalThreadId);

      // Small thread shouldn't need compaction
      threadManager.addEvent(originalThreadId, 'USER_MESSAGE', 'Short message');
      expect(await threadManager.needsCompaction()).toBe(false);

      // Large thread should need compaction
      const longMessage = 'Very long message. '.repeat(1000);
      for (let i = 0; i < 10; i++) {
        threadManager.addEvent(originalThreadId, 'USER_MESSAGE', longMessage);
      }
      expect(await threadManager.needsCompaction()).toBe(true);
    });

    it('should compact automatically when needed', async () => {
      const originalThreadId = 'lace_20250101_abc123';
      threadManager.createThread(originalThreadId);

      // Add content that doesn't need compaction
      threadManager.addEvent(originalThreadId, 'USER_MESSAGE', 'Short message');
      const compacted1 = await threadManager.compactIfNeeded();
      expect(compacted1).toBe(false);
      expect(threadManager.getCurrentThreadId()).toBe(originalThreadId);

      // Add content that needs compaction
      const longMessage = 'Very long message. '.repeat(1000);
      for (let i = 0; i < 10; i++) {
        threadManager.addEvent(originalThreadId, 'USER_MESSAGE', longMessage);
      }
      const compacted2 = await threadManager.compactIfNeeded();
      expect(compacted2).toBe(true);
      expect(threadManager.getCurrentThreadId()).not.toBe(originalThreadId);
    });
  });
});

describe('Session Management', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  describe('ThreadManager session management', () => {
    it('should start new session by default', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log to suppress output during test
      });

      const threadManager = new ThreadManager(tempDbPath);
      const sessionInfo = threadManager.resumeOrCreate();
      const { threadId } = sessionInfo;

      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(threadManager.getCurrentThreadId()).toBe(threadId);
      expect(sessionInfo.isResumed).toBe(false);

      threadManager.close();
      vi.restoreAllMocks();
    });

    it('should continue latest session', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log to suppress output during test
      });

      // Create a session first
      const firstManager = new ThreadManager(tempDbPath);
      const firstSessionInfo = firstManager.resumeOrCreate();
      const { threadId: firstId } = firstSessionInfo;
      firstManager.addEvent(firstId, 'USER_MESSAGE', 'First session');
      firstManager.saveCurrentThread();
      firstManager.close();

      // Continue session
      const secondManager = new ThreadManager(tempDbPath);
      const latestThreadId = secondManager.getLatestThreadId();
      const sessionInfo = secondManager.resumeOrCreate(latestThreadId || undefined);
      const { threadId } = sessionInfo;

      expect(threadId).toBe(firstId);
      expect(sessionInfo.isResumed).toBe(true);
      expect(secondManager.getEvents(threadId)).toHaveLength(1);
      expect(secondManager.getEvents(threadId)[0].data).toBe('First session');

      secondManager.close();
      vi.restoreAllMocks();
    });

    it('should continue specific session by ID', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log to suppress output during test
      });

      // Create multiple sessions
      const manager1 = new ThreadManager(tempDbPath);
      const sessionInfo1 = manager1.resumeOrCreate();
      const { threadId: id1 } = sessionInfo1;
      manager1.addEvent(id1, 'USER_MESSAGE', 'First session');
      manager1.saveCurrentThread();
      manager1.close();

      const manager2 = new ThreadManager(tempDbPath);
      const sessionInfo2 = manager2.resumeOrCreate();
      const { threadId: id2 } = sessionInfo2;
      manager2.addEvent(id2, 'USER_MESSAGE', 'Second session');
      manager2.saveCurrentThread();
      manager2.close();

      // Continue first session specifically
      const manager3 = new ThreadManager(tempDbPath);
      const sessionInfo3 = manager3.resumeOrCreate(id1);
      const { threadId } = sessionInfo3;

      expect(threadId).toBe(id1);
      expect(sessionInfo3.isResumed).toBe(true);
      expect(manager3.getEvents(threadId)[0].data).toBe('First session');

      manager3.close();
      vi.restoreAllMocks();
    });

    it('should start new session if continue fails', () => {
      vi.spyOn(console, 'log').mockImplementation(() => {
        // Mock console.log to suppress output during test
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {
        // Mock console.warn to suppress output during test
      });

      // Try to continue non-existent session
      const threadManager = new ThreadManager(tempDbPath);
      const sessionInfo = threadManager.resumeOrCreate('lace_invalid_id');
      const { threadId } = sessionInfo;

      expect(threadId).not.toBe('lace_invalid_id');
      expect(threadId).toMatch(/^lace_\d{8}_[a-z0-9]{6}$/);
      expect(sessionInfo.isResumed).toBe(false);
      expect(sessionInfo.resumeError).toContain('Could not resume lace_invalid_id');

      threadManager.close();
      vi.restoreAllMocks();
    });
  });

  describe('ThreadManager shutdown', () => {
    it('should save current session on shutdown', () => {
      const threadManager = new ThreadManager(tempDbPath);
      const sessionInfo = threadManager.resumeOrCreate();
      const { threadId } = sessionInfo;
      threadManager.addEvent(threadId, 'USER_MESSAGE', 'Test message');

      threadManager.close();

      // Verify session was saved
      const newManager = new ThreadManager(tempDbPath);
      const loadedThread = newManager.loadThread(threadId);
      expect(loadedThread.events).toHaveLength(1);
      expect(loadedThread.events[0].data).toBe('Test message');

      newManager.close();
      vi.restoreAllMocks();
    });
  });
});

describe('Integration Tests', () => {
  let tempDbPath: string;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `lace-test-${Date.now()}.db`);
  });

  afterEach(() => {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('should handle complete conversation workflow', () => {
    // Start session
    const threadManager = new ThreadManager(tempDbPath);
    const threadId = `lace_${Date.now()}_test`;
    threadManager.createThread(threadId);

    // Simulate conversation
    threadManager.addEvent(threadId, 'USER_MESSAGE', 'List files in current directory');
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', "I'll help you list the files");
    threadManager.addEvent(threadId, 'TOOL_CALL', {
      name: 'bash',
      arguments: { command: 'ls -la' },
      id: 'call_123',
    });
    threadManager.addEvent(threadId, 'TOOL_RESULT', {
      id: 'call_123',
      content: [{ type: 'text', text: 'file1.txt\nfile2.txt\n' }],
      isError: false,
    });
    threadManager.addEvent(threadId, 'AGENT_MESSAGE', 'Here are the files in your directory');

    threadManager.close();

    // Resume session
    const newManager = new ThreadManager(tempDbPath);
    const resumedThread = newManager.loadThread(threadId);

    // Verify full conversation was preserved
    expect(resumedThread.events).toHaveLength(5);
    expect(resumedThread.events[0].type).toBe('USER_MESSAGE');
    expect(resumedThread.events[1].type).toBe('AGENT_MESSAGE');
    expect(resumedThread.events[2].type).toBe('TOOL_CALL');
    expect(resumedThread.events[3].type).toBe('TOOL_RESULT');
    expect(resumedThread.events[4].type).toBe('AGENT_MESSAGE');

    // Continue conversation
    newManager.setCurrentThread(threadId);
    newManager.addEvent(threadId, 'USER_MESSAGE', "What's in file1.txt?");

    const finalEvents = newManager.getEvents(threadId);
    expect(finalEvents).toHaveLength(6);
    expect(finalEvents[5].data).toBe("What's in file1.txt?");

    newManager.close();
  });

  it('should handle multiple concurrent sessions', () => {
    const manager1 = new ThreadManager(tempDbPath);
    const manager2 = new ThreadManager(tempDbPath);

    // Create different sessions
    const thread1 = 'lace_session_1';
    const thread2 = 'lace_session_2';

    manager1.createThread(thread1);
    manager2.createThread(thread2);

    // Add events to both
    manager1.addEvent(thread1, 'USER_MESSAGE', 'Session 1 message');
    manager2.addEvent(thread2, 'USER_MESSAGE', 'Session 2 message');

    manager1.saveCurrentThread();
    manager2.saveCurrentThread();

    // Verify isolation
    const events1 = manager1.getEvents(thread1);
    const events2 = manager2.getEvents(thread2);

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0].data).toBe('Session 1 message');
    expect(events2[0].data).toBe('Session 2 message');

    manager1.close();
    manager2.close();
  });

  it('should handle large conversations efficiently', { timeout: 10000 }, () => {
    const threadManager = new ThreadManager(tempDbPath);
    const threadId = 'lace_large_test';
    threadManager.createThread(threadId);

    // Add many events
    const eventCount = 1000;
    for (let i = 0; i < eventCount; i++) {
      const type = i % 2 === 0 ? 'USER_MESSAGE' : 'AGENT_MESSAGE';
      threadManager.addEvent(threadId, type, `Message ${i}`);
    }

    threadManager.saveCurrentThread();

    // Verify all events preserved
    const events = threadManager.getEvents(threadId);
    expect(events).toHaveLength(eventCount);
    expect(events[0].data).toBe('Message 0');
    expect(events[eventCount - 1].data).toBe(`Message ${eventCount - 1}`);

    // Test loading performance
    const startTime = Date.now();
    threadManager.setCurrentThread(threadId);
    const loadTime = Date.now() - startTime;

    // Should load reasonably quickly (adjust threshold as needed)
    expect(loadTime).toBeLessThan(1000); // 1 second

    threadManager.close();
  });
});
