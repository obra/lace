// ABOUTME: Test suite for database persistence layer schema and migrations
// ABOUTME: Tests database schema creation, migrations, and data integrity

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { DatabasePersistence } from '~/persistence/database';

describe('Project and Session database schema', () => {
  it('should create projects table on initialization', () => {
    const db = new DatabasePersistence(':memory:');

    const tables = db
      .database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'")
      .all();

    expect(tables).toContainEqual({ name: 'projects' });
  });

  it('should create sessions table on initialization', () => {
    const db = new DatabasePersistence(':memory:');

    const tables = db
      .database!.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
      .all();

    expect(tables).toContainEqual({ name: 'sessions' });
  });

  it('should have correct projects table schema', () => {
    const db = new DatabasePersistence(':memory:');

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
    const db = new DatabasePersistence(':memory:');

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
    const db = new DatabasePersistence(':memory:');

    const columns = db.database!.prepare('PRAGMA table_info(threads)').all() as { name: string }[];
    const sessionIdColumn = columns.find((c) => c.name === 'session_id');

    expect(sessionIdColumn).toBeDefined();
  });

  it('should create Historical project for migration', () => {
    const db = new DatabasePersistence(':memory:');

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

    // Run migration by creating DatabasePersistence
    new DatabasePersistence(migrationDb);

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
  });
});
