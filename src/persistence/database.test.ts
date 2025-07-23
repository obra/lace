// ABOUTME: Test suite for database persistence layer schema and migrations
// ABOUTME: Tests database schema creation, migrations, and data integrity

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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

  it('should create Historical project for migration', () => {
    const db = getPersistence();

    const project = db
      .database!.prepare("SELECT * FROM projects WHERE id = 'historical'")
      .get() as {
      name: string;
      working_directory: string;
    };

    expect(project).toBeDefined();
    expect(project.name).toBe('Historical');
    expect(project.working_directory).toBe(process.cwd());
  });

  it('should migrate existing session threads to sessions table', () => {
    // Create separate database for migration test
    const migrationDb = new Database(':memory:');

    // Create old schema without migration
    migrationDb.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT
      );
      
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    // Insert old session thread with isSession metadata
    migrationDb
      .prepare(
        `
      INSERT INTO threads (id, created_at, updated_at, metadata)
      VALUES ('old_session', '2023-01-01T00:00:00Z', '2023-01-01T00:00:00Z', '{"isSession": true, "name": "Old Session"}')
    `
      )
      .run();

    // Set schema version to 4 (before projects and sessions migration)
    migrationDb
      .prepare('INSERT INTO schema_version (version, applied_at) VALUES (4, ?)')
      .run(new Date().toISOString());

    // Run migration by creating DatabasePersistence with the migration database
    const migrationPersistence = new DatabasePersistence(migrationDb);

    // Check session was created in sessions table
    const session = migrationDb
      .prepare("SELECT * FROM sessions WHERE id = 'old_session'")
      .get() as {
      name: string;
      project_id: string;
    };
    expect(session).toBeDefined();
    expect(session.name).toBe('Old Session');
    expect(session.project_id).toBe('historical');

    // Check thread was updated with session_id
    const thread = migrationDb.prepare("SELECT * FROM threads WHERE id = 'old_session'").get() as {
      session_id: string;
      metadata: string | null;
    };
    expect(thread.session_id).toBe('old_session');
    if (thread.metadata) {
      expect(JSON.parse(thread.metadata)).not.toHaveProperty('isSession');
    }

    // Clean up migration database
    migrationPersistence.close();
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
