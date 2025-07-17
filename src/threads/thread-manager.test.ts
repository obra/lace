// ABOUTME: Test suite for ThreadManager session support functionality
// ABOUTME: Tests session creation, thread management, and project integration

import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadManager } from '~/threads/thread-manager';
import { SessionData } from '~/persistence/database';

describe('ThreadManager session support', () => {
  let manager: ThreadManager;
  let sessionId: string;

  beforeEach(() => {
    manager = new ThreadManager(':memory:');

    // Ensure migrations have completed by checking the database
    const db = manager['_persistence'].database;
    if (!db) throw new Error('Database not initialized');

    // Check current schema version
    const versionResult = db
      .prepare('SELECT MAX(version) as version FROM schema_version')
      .get() as { version: number | null };
    const currentVersion = versionResult.version || 0;

    // Verify the schema has the required columns
    const columns = db.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
    const hasSessionId = columns.some((col) => col.name === 'session_id');
    const hasProjectId = columns.some((col) => col.name === 'project_id');

    if (!hasSessionId || !hasProjectId) {
      throw new Error(
        `Database schema not properly migrated. Version: ${currentVersion}, has session_id: ${hasSessionId}, has project_id: ${hasProjectId}`
      );
    }

    // Create a project first
    manager.createProject({
      id: 'project1',
      name: 'Test Project',
      description: 'A test project',
      workingDirectory: '/project/path',
      configuration: {},
      isArchived: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    });

    // Create a session first
    const session: SessionData = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    manager.createSession(session);
    sessionId = session.id;
  });

  it('should create thread with session_id', () => {
    const threadId = manager.createThread(undefined, sessionId);
    const thread = manager.getThread(threadId);

    expect(thread).toBeDefined();
    expect(thread!.sessionId).toBe(sessionId);
  });

  it('should get threads by session', () => {
    const thread1Id = manager.createThread(undefined, sessionId);
    const thread2Id = manager.createThread(undefined, sessionId);

    const threads = manager.getThreadsBySession(sessionId);

    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.id)).toContain(thread1Id);
    expect(threads.map((t) => t.id)).toContain(thread2Id);
  });

  it('should get sessions by project', () => {
    const session2: SessionData = {
      id: 'session2',
      projectId: 'project1',
      name: 'Session 2',
      description: '',
      configuration: {},
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    manager.createSession(session2);

    const sessions = manager.getSessionsByProject('project1');

    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.id)).toContain('session1');
    expect(sessions.map((s) => s.id)).toContain('session2');
  });

  it('should not return threads marked as sessions (legacy)', () => {
    // Create old-style session thread for backwards compatibility test
    const legacySessionId = manager.createThread();
    manager.updateThreadMetadata(legacySessionId, { isSession: true });

    const threads = manager.getAllThreads();
    const legacyThread = threads.find((t) => t.id === legacySessionId);

    // Should be filtered out of getAllThreads() to avoid confusion
    expect(legacyThread).toBeUndefined();
    expect(manager.getThreadsBySession(legacySessionId)).toHaveLength(0);
  });
});
