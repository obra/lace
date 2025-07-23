// ABOUTME: Test suite for database persistence layer schema and migrations
// ABOUTME: Tests database schema creation, migrations, and data integrity

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabasePersistence, getPersistence } from '~/persistence/database';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { vi } from 'vitest';

describe('Project and Session database schema', () => {
  beforeEach(() => {
    setupTestPersistence();
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.restoreAllMocks();
  });

  it('should create projects table on initialization', () => {
    const db = getPersistence();

    const tables = db
      .database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .all();

    expect(tables).toContainEqual({ name: 'projects' });
  });

  it('should create sessions table on initialization', () => {
    const db = getPersistence();

    const tables = db
      .database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all();

    expect(tables).toContainEqual({ name: 'sessions' });
  });

  it('should have correct projects table schema', () => {
    const db = getPersistence();

    const columns = db.database!.prepare('PRAGMA table_info(projects)').all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('description');
    expect(columnNames).toContain('working_directory');
    expect(columnNames).toContain('configuration');
    expect(columnNames).toContain('is_archived');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('last_used_at');
  });

  it('should have correct sessions table schema', () => {
    const db = getPersistence();

    const columns = db.database!.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('project_id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('description');
    expect(columnNames).toContain('configuration');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
  });

  it('should add session_id to threads table', () => {
    const db = getPersistence();

    const columns = db.database!.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
    const sessionIdColumn = columns.find((c) => c.name === 'session_id');

    expect(sessionIdColumn).toBeDefined();
  });
});

describe('Session persistence', () => {
  let db: DatabasePersistence;

  beforeEach(() => {
    db = setupTestPersistence();

    // Create projects first to satisfy foreign key constraints
    db.database!.prepare(
      `
      INSERT INTO projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
      VALUES ('project1', 'Test Project', 'A test project', '/test/path', '{}', FALSE, datetime('now'), datetime('now'))
    `
    ).run();

    db.database!.prepare(
      `
      INSERT INTO projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
      VALUES ('project2', 'Test Project 2', 'Another test project', '/test/path2', '{}', FALSE, datetime('now'), datetime('now'))
    `
    ).run();
  });

  afterEach(() => {
    teardownTestPersistence();
    vi.restoreAllMocks();
  });

  it('should save session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
    };

    db.saveSession(session);

    const saved = db.loadSession('session1');
    expect(saved).toEqual(session);
  });

  it('should load session by id', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: 'A test session',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
    };

    db.saveSession(session);
    const loaded = db.loadSession('session1');

    expect(loaded).toEqual(session);
  });

  it('should load sessions by project', () => {
    const session1 = {
      id: 'session1',
      projectId: 'project1',
      name: 'Session 1',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
    };

    const session2 = {
      id: 'session2',
      projectId: 'project1',
      name: 'Session 2',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-02'),
      updatedAt: new Date('2023-01-02'),
    };

    const session3 = {
      id: 'session3',
      projectId: 'project2',
      name: 'Session 3',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-03'),
      updatedAt: new Date('2023-01-03'),
    };

    db.saveSession(session1);
    db.saveSession(session2);
    db.saveSession(session3);

    const project1Sessions = db.loadSessionsByProject('project1');
    expect(project1Sessions).toHaveLength(2);
    expect(project1Sessions.map((s) => s.id)).toContain('session1');
    expect(project1Sessions.map((s) => s.id)).toContain('session2');
  });

  it('should update session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Original Name',
      description: 'Original description',
      configuration: { provider: 'anthropic' },
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
    };

    db.saveSession(session);

    const updates = {
      name: 'Updated Name',
      description: 'Updated description',
      status: 'completed' as const,
      updatedAt: new Date('2023-01-02'),
    };

    db.updateSession('session1', updates);

    const updated = db.loadSession('session1');
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('Updated description');
    expect(updated!.status).toBe('completed');
    expect(updated!.updatedAt).toEqual(new Date('2023-01-02'));
  });

  it('should delete session', () => {
    const session = {
      id: 'session1',
      projectId: 'project1',
      name: 'Test Session',
      description: '',
      configuration: {},
      status: 'active' as const,
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-01'),
    };

    db.saveSession(session);
    expect(db.loadSession('session1')).not.toBeNull();

    db.deleteSession('session1');
    expect(db.loadSession('session1')).toBeNull();
  });
});
