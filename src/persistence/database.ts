// ABOUTME: Consolidated SQLite persistence layer for threads, events, and tasks
// ABOUTME: Handles database schema, CRUD operations, and data serialization for all entities

import Database from 'better-sqlite3';
import { getLaceDbPath } from '~/config/lace-dir';
import {
  Thread,
  ThreadEvent,
  EventType,
  VersionHistoryEntry,
  ThreadId,
  AssigneeId,
} from '~/threads/types';
import type { ToolCall, ToolResult } from '~/tools/types';
import {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
} from '~/tools/implementations/task-manager/types';
import { logger } from '~/utils/logger';

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  workingDirectory: string;
  configuration: Record<string, unknown>;
  isArchived: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface SessionData {
  id: string;
  projectId: string;
  name: string;
  description: string;
  configuration: Record<string, unknown>;
  status: 'active' | 'archived' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}

export class DatabasePersistence {
  private db: Database.Database | null = null;
  private _closed: boolean = false;
  private _disabled: boolean = false;

  get database(): Database.Database | null {
    return this.db;
  }

  constructor(dbPath: string | Database.Database) {
    try {
      if (typeof dbPath === 'string') {
        this.db = new Database(dbPath);
        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
      } else {
        this.db = dbPath;
      }
      this.initializeSchema();
    } catch (error) {
      logger.error('Failed to initialize database', {
        dbPath,
        error: error instanceof Error ? error.message : String(error),
      });
      logger.warn('Database persistence disabled - data will only be stored in memory');
      this._disabled = true;
    }
  }

  private initializeSchema(): void {
    if (!this.db) return;

    // Create schema version table first
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);

    // Run migrations
    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.db) return;

    const currentVersion = this.getSchemaVersion();

    if (currentVersion < 1) {
      this.migrateToV1();
    }

    if (currentVersion < 2) {
      this.migrateToV2();
    }

    if (currentVersion < 3) {
      this.migrateToV3();
    }

    if (currentVersion < 4) {
      this.migrateToV4();
    }

    if (currentVersion < 5) {
      this.migrateToV5();
    }

    if (currentVersion < 6) {
      this.migrateToV6();
    }
  }

  private getSchemaVersion(): number {
    if (!this.db) return 0;

    try {
      const result = this.db
        .prepare('SELECT MAX(version) as version FROM schema_version')
        .get() as { version: number | null };
      return result.version || 0;
    } catch {
      return 0;
    }
  }

  private setSchemaVersion(version: number): void {
    if (!this.db) return;
    this.db
      .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(version, new Date().toISOString());
  }

  private migrateToV1(): void {
    if (!this.db) return;

    // Create basic threads and events tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data JSONB NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );

      CREATE INDEX IF NOT EXISTS idx_events_thread_timestamp 
      ON events(thread_id, timestamp);
      
      CREATE INDEX IF NOT EXISTS idx_threads_updated 
      ON threads(updated_at DESC);
    `);

    this.setSchemaVersion(1);
  }

  private migrateToV2(): void {
    if (!this.db) return;

    // Create thread versioning tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_versions (
        canonical_id TEXT PRIMARY KEY,
        current_version_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (current_version_id) REFERENCES threads(id)
      );

      CREATE TABLE IF NOT EXISTS version_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        FOREIGN KEY (canonical_id) REFERENCES thread_versions(canonical_id)
      );

      CREATE INDEX IF NOT EXISTS idx_version_history_canonical 
      ON version_history(canonical_id, created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_version_history_version 
      ON version_history(version_id);
    `);

    this.setSchemaVersion(2);
  }

  private migrateToV3(): void {
    if (!this.db) return;

    // Create task management tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        prompt TEXT NOT NULL,
        status TEXT CHECK(status IN ('pending', 'in_progress', 'completed', 'blocked')) DEFAULT 'pending',
        priority TEXT CHECK(priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
        assigned_to TEXT,
        created_by TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS task_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes(task_id);
    `);

    this.setSchemaVersion(3);
  }

  private migrateToV4(): void {
    if (!this.db) return;

    // Add metadata column to threads table for session persistence
    this.db.exec(`
      ALTER TABLE threads ADD COLUMN metadata TEXT DEFAULT NULL;
    `);

    this.setSchemaVersion(4);
  }

  private migrateToV5(): void {
    if (!this.db) return;

    // Create projects table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        working_directory TEXT NOT NULL,
        configuration TEXT DEFAULT '{}',
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TEXT DEFAULT (datetime('now')),
        last_used_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create "Historical" project for migration
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
      VALUES ('historical', 'Historical', 'Legacy sessions before project support', ?, '{}', FALSE, datetime('now'), datetime('now'))
    `
      )
      .run(process.cwd());

    this.setSchemaVersion(5);
  }

  private migrateToV6(): void {
    if (!this.db) return;

    // Create sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        configuration TEXT DEFAULT '{}',
        status TEXT CHECK(status IN ('active', 'archived', 'completed')) DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    // Add session_id to threads table
    const hasSessionId =
      (
        this.db
          .prepare(
            "SELECT COUNT(*) as count FROM pragma_table_info('threads') WHERE name='session_id'"
          )
          .get() as { count: number }
      ).count > 0;

    if (!hasSessionId) {
      this.db.exec('ALTER TABLE threads ADD COLUMN session_id TEXT');
    }

    // Add project_id to threads table
    const hasProjectId =
      (
        this.db
          .prepare(
            "SELECT COUNT(*) as count FROM pragma_table_info('threads') WHERE name='project_id'"
          )
          .get() as { count: number }
      ).count > 0;

    if (!hasProjectId) {
      this.db.exec('ALTER TABLE threads ADD COLUMN project_id TEXT');
    }

    // Migrate existing session threads to sessions table
    const sessionThreads = this.db
      .prepare(
        `
      SELECT id, created_at, updated_at, metadata
      FROM threads 
      WHERE metadata IS NOT NULL 
      AND json_extract(metadata, '$.isSession') = 1
    `
      )
      .all() as Array<{
      id: string;
      created_at: string;
      updated_at: string;
      metadata: string;
    }>;

    for (const sessionThread of sessionThreads) {
      const metadata = JSON.parse(sessionThread.metadata) as {
        isSession?: boolean;
        name?: string;
        description?: string;
        configuration?: Record<string, unknown>;
        [key: string]: unknown;
      };

      // Create session record
      this.db
        .prepare(
          `
        INSERT OR IGNORE INTO sessions (id, project_id, name, description, configuration, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          sessionThread.id,
          'historical',
          metadata.name || 'Untitled Session',
          metadata.description || '',
          JSON.stringify(metadata.configuration || {}),
          sessionThread.created_at,
          sessionThread.updated_at
        );

      // Update thread to reference session and remove isSession metadata
      const cleanMetadata = { ...metadata };
      delete cleanMetadata.isSession;
      delete cleanMetadata.name;
      delete cleanMetadata.description;
      delete cleanMetadata.configuration;

      this.db
        .prepare(
          `
        UPDATE threads 
        SET session_id = ?, metadata = ?
        WHERE id = ?
      `
        )
        .run(
          sessionThread.id,
          Object.keys(cleanMetadata).length > 0 ? JSON.stringify(cleanMetadata) : null,
          sessionThread.id
        );
    }

    this.setSchemaVersion(6);
  }

  // ===============================
  // Thread-related methods
  // ===============================

  saveThread(thread: Thread): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO threads (id, session_id, project_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const metadataJson = thread.metadata ? JSON.stringify(thread.metadata) : null;
    stmt.run(
      thread.id,
      thread.sessionId || null,
      thread.projectId || null,
      thread.createdAt.toISOString(),
      thread.updatedAt.toISOString(),
      metadataJson
    );
  }

  loadThread(threadId: string): Thread | null {
    if (this._disabled || !this.db) return null;

    // Check if this is a canonical ID with a current version
    const currentVersionId = this.getCurrentVersion(threadId);
    const actualThreadId = currentVersionId || threadId;

    const threadStmt = this.db.prepare(`
      SELECT * FROM threads WHERE id = ?
    `);

    const threadRow = threadStmt.get(actualThreadId) as
      | {
          id: string;
          session_id: string | null;
          project_id: string | null;
          created_at: string;
          updated_at: string;
          metadata: string | null;
        }
      | undefined;
    if (!threadRow) return null;

    const events = this.loadEvents(actualThreadId);

    let metadata: Thread['metadata'] = undefined;
    if (threadRow.metadata) {
      try {
        metadata = JSON.parse(threadRow.metadata) as Record<string, unknown>;
      } catch (error) {
        logger.warn('Failed to parse thread metadata', { threadId: actualThreadId, error });
      }
    }

    return {
      id: threadRow.id,
      sessionId: threadRow.session_id || undefined,
      projectId: threadRow.project_id || undefined,
      createdAt: new Date(threadRow.created_at),
      updatedAt: new Date(threadRow.updated_at),
      events,
      metadata,
    };
  }

  saveEvent(event: ThreadEvent): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO events (id, thread_id, type, timestamp, data)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.threadId,
      event.type,
      event.timestamp.toISOString(),
      JSON.stringify(event.data)
    );

    // Update thread's updated_at timestamp
    const updateThreadStmt = this.db.prepare(`
      UPDATE threads SET updated_at = ? WHERE id = ?
    `);
    updateThreadStmt.run(new Date().toISOString(), event.threadId);
  }

  loadEvents(threadId: string): ThreadEvent[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE thread_id = ? 
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(threadId) as Array<{
      id: string;
      thread_id: string;
      type: string;
      timestamp: string;
      data: string;
    }>;

    return rows.map((row) => {
      try {
        return {
          id: row.id,
          threadId: row.thread_id,
          type: row.type as EventType,
          timestamp: new Date(row.timestamp),
          data: JSON.parse(row.data) as string | ToolCall | ToolResult,
        };
      } catch (error) {
        throw new Error(
          `Failed to parse event data for event ${row.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  getLatestThreadId(): string | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT id FROM threads 
      ORDER BY updated_at DESC 
      LIMIT 1
    `);

    const row = stmt.get() as { id: string } | undefined;
    return row ? row.id : null;
  }

  getDelegateThreadsFor(parentThreadId: string): string[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT DISTINCT id FROM threads 
      WHERE id LIKE ? 
      ORDER BY id ASC
    `);

    const pattern = `${parentThreadId}.%`;
    const rows = stmt.all(pattern) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getAllThreadsWithMetadata(): Thread[] {
    return this.executeThreadQuery('', '');
  }

  private executeThreadQuery(whereClause: string, param: string): Thread[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT id, session_id, project_id, created_at, updated_at, metadata FROM threads
      ${whereClause}
      ORDER BY updated_at DESC
    `);

    const rows = (whereClause ? stmt.all(param) : stmt.all()) as Array<{
      id: string;
      session_id: string | null;
      project_id: string | null;
      created_at: string;
      updated_at: string;
      metadata: string | null;
    }>;

    return rows.map((row) => {
      let metadata: Thread['metadata'] = undefined;
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata) as Record<string, unknown>;
        } catch (error) {
          logger.warn('Failed to parse thread metadata', { threadId: row.id, error });
        }
      }

      return {
        id: row.id,
        sessionId: row.session_id || undefined,
        projectId: row.project_id || undefined,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        events: [], // Don't load events for listing operations
        metadata,
      };
    });
  }

  getThreadsBySession(sessionId: string): Thread[] {
    return this.executeThreadQuery('WHERE session_id = ?', sessionId);
  }

  getCurrentVersion(canonicalId: string): string | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT current_version_id FROM thread_versions WHERE canonical_id = ?
    `);

    const row = stmt.get(canonicalId) as { current_version_id: string } | undefined;
    return row ? row.current_version_id : null;
  }

  createVersion(canonicalId: string, newVersionId: string, reason: string): void {
    if (this._closed || this._disabled || !this.db) return;

    const transaction = this.db.transaction(() => {
      // Insert or update the current version
      const upsertStmt = this.db!.prepare(`
        INSERT OR REPLACE INTO thread_versions (canonical_id, current_version_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      upsertStmt.run(canonicalId, newVersionId);

      // Add to version history
      const historyStmt = this.db!.prepare(`
        INSERT INTO version_history (canonical_id, version_id, created_at, reason)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      `);
      historyStmt.run(canonicalId, newVersionId, reason);
    });

    transaction();
  }

  getVersionHistory(canonicalId: string): VersionHistoryEntry[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM version_history 
      WHERE canonical_id = ? 
      ORDER BY id DESC
    `);

    const rows = stmt.all(canonicalId) as Array<{
      id: number;
      canonical_id: string;
      version_id: string;
      created_at: string;
      reason: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      canonicalId: row.canonical_id,
      versionId: row.version_id,
      createdAt: new Date(row.created_at),
      reason: row.reason,
    }));
  }

  findCanonicalIdForVersion(versionId: string): string | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT canonical_id FROM version_history 
      WHERE version_id = ? 
      LIMIT 1
    `);

    const row = stmt.get(versionId) as { canonical_id: string } | undefined;
    return row ? row.canonical_id : null;
  }

  // Execute multiple operations in a single transaction for atomic compacted thread creation
  createShadowThreadTransaction(
    shadowThread: Thread,
    events: ThreadEvent[],
    canonicalId: string,
    reason: string
  ): void {
    if (this._closed || this._disabled || !this.db) return;

    const transaction = this.db.transaction(() => {
      // 1. Save the compacted thread
      const threadStmt = this.db!.prepare(`
        INSERT OR REPLACE INTO threads (id, created_at, updated_at)
        VALUES (?, ?, ?)
      `);
      threadStmt.run(
        shadowThread.id,
        shadowThread.createdAt.toISOString(),
        shadowThread.updatedAt.toISOString()
      );

      // 2. Save all events
      const eventStmt = this.db!.prepare(`
        INSERT OR REPLACE INTO events (id, thread_id, type, timestamp, data)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        eventStmt.run(
          event.id,
          event.threadId,
          event.type,
          event.timestamp.toISOString(),
          JSON.stringify(event.data)
        );
      }

      // 3. Update version mapping
      const versionStmt = this.db!.prepare(`
        INSERT OR REPLACE INTO thread_versions (canonical_id, current_version_id, created_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      versionStmt.run(canonicalId, shadowThread.id);

      // 4. Add to version history
      const historyStmt = this.db!.prepare(`
        INSERT INTO version_history (canonical_id, version_id, created_at, reason)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      `);
      historyStmt.run(canonicalId, shadowThread.id, reason);
    });

    // Execute all operations atomically
    transaction();
  }

  // Clean up old compacted threads to prevent unbounded growth
  cleanupOldShadows(canonicalId: string, keepLast: number = 3): void {
    if (this._closed || this._disabled || !this.db) return;

    const transaction = this.db.transaction(() => {
      // Get all version IDs for this canonical thread, ordered by creation date (newest first)
      const versionsStmt = this.db!.prepare(`
        SELECT version_id FROM version_history 
        WHERE canonical_id = ? 
        ORDER BY id DESC
      `);

      const versions = versionsStmt.all(canonicalId) as Array<{ version_id: string }>;

      if (versions.length <= keepLast) {
        return; // Nothing to clean up
      }

      // Keep the most recent N versions, delete the rest
      const versionsToDelete = versions.slice(keepLast).map((v) => v.version_id);

      if (versionsToDelete.length === 0) return;

      // Delete events for old compacted threads
      const deleteEventsStmt = this.db!.prepare(`
        DELETE FROM events WHERE thread_id = ?
      `);

      // Delete old compacted threads
      const deleteThreadStmt = this.db!.prepare(`
        DELETE FROM threads WHERE id = ?
      `);

      // Delete old version history entries (but keep the current version mapping)
      const deleteHistoryStmt = this.db!.prepare(`
        DELETE FROM version_history WHERE version_id = ?
      `);

      for (const versionId of versionsToDelete) {
        deleteEventsStmt.run(versionId);
        deleteThreadStmt.run(versionId);
        deleteHistoryStmt.run(versionId);
      }

      logger.info('Cleaned up old compacted threads', {
        versionsDeleted: versionsToDelete.length,
        canonicalId,
      });
    });

    transaction();
  }

  // ===============================
  // Task-related methods
  // ===============================

  async saveTask(task: Task): Promise<void> {
    return this.withRetry(() => {
      if (this._closed || this._disabled || !this.db) return;

      const stmt = this.db.prepare(`
        INSERT INTO tasks (id, title, description, prompt, status, priority, 
                          assigned_to, created_by, thread_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        task.id,
        task.title,
        task.description,
        task.prompt,
        task.status,
        task.priority,
        task.assignedTo || null,
        task.createdBy,
        task.threadId,
        task.createdAt.toISOString(),
        task.updatedAt.toISOString()
      );
    });
  }

  loadTask(taskId: string): Task | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);

    const row = stmt.get(taskId) as
      | {
          id: string;
          title: string;
          description: string;
          prompt: string;
          status: string;
          priority: string;
          assigned_to: string | null;
          created_by: string;
          thread_id: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;

    // Load notes for this task
    const notesStmt = this.db.prepare(`
      SELECT * FROM task_notes 
      WHERE task_id = ? 
      ORDER BY timestamp ASC
    `);

    const noteRows = notesStmt.all(taskId) as Array<{
      id: number;
      task_id: string;
      author: string;
      content: string;
      timestamp: string;
    }>;
    const notes: TaskNote[] = noteRows.map((noteRow) => ({
      id: String(noteRow.id),
      author: noteRow.author as ThreadId,
      content: noteRow.content,
      timestamp: new Date(noteRow.timestamp),
    }));

    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      prompt: row.prompt,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      assignedTo: row.assigned_to as AssigneeId | undefined,
      createdBy: row.created_by as ThreadId,
      threadId: row.thread_id as ThreadId,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      notes,
    };
  }

  loadTasksByThread(threadId: ThreadId): Task[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE thread_id = ? 
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(threadId) as Array<{
      id: string;
      title: string;
      description: string;
      prompt: string;
      status: string;
      priority: string;
      assigned_to: string | null;
      created_by: string;
      thread_id: string;
      created_at: string;
      updated_at: string;
    }>;

    // Load notes for all tasks in batch
    const taskIds = rows.map((row) => row.id);
    const notesMap = this.loadNotesBatch(taskIds);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      prompt: row.prompt,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      assignedTo: row.assigned_to as AssigneeId | undefined,
      createdBy: row.created_by as ThreadId,
      threadId: row.thread_id as ThreadId,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      notes: notesMap.get(row.id) || [],
    }));
  }

  loadTasksByAssignee(assignee: AssigneeId): Task[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_to = ? 
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(assignee) as Array<{
      id: string;
      title: string;
      description: string;
      prompt: string;
      status: string;
      priority: string;
      assigned_to: string | null;
      created_by: string;
      thread_id: string;
      created_at: string;
      updated_at: string;
    }>;

    // Load notes for all tasks in batch
    const taskIds = rows.map((row) => row.id);
    const notesMap = this.loadNotesBatch(taskIds);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description || '',
      prompt: row.prompt,
      status: row.status as TaskStatus,
      priority: row.priority as TaskPriority,
      assignedTo: row.assigned_to as AssigneeId | undefined,
      createdBy: row.created_by as ThreadId,
      threadId: row.thread_id as ThreadId,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      notes: notesMap.get(row.id) || [],
    }));
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    return this.withRetry(() => {
      if (this._closed || this._disabled || !this.db) return;

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: (string | number | null)[] = [];

      if (updates.title !== undefined) {
        updateFields.push('title = ?');
        values.push(updates.title);
      }
      if (updates.description !== undefined) {
        updateFields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.prompt !== undefined) {
        updateFields.push('prompt = ?');
        values.push(updates.prompt);
      }
      if (updates.status !== undefined) {
        updateFields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.priority !== undefined) {
        updateFields.push('priority = ?');
        values.push(updates.priority);
      }
      if (updates.assignedTo !== undefined) {
        updateFields.push('assigned_to = ?');
        values.push(updates.assignedTo);
      }

      // Always update timestamp
      updateFields.push('updated_at = ?');
      values.push(new Date().toISOString());

      // Add task ID at the end
      values.push(taskId);

      const query = `
        UPDATE tasks 
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `;

      const stmt = this.db.prepare(query);
      const result = stmt.run(...values);

      if (result.changes === 0) {
        throw new Error(`Task ${taskId} not found`);
      }
    });
  }

  async addNote(taskId: string, note: Omit<TaskNote, 'id'>): Promise<void> {
    return this.withRetry(() => {
      if (this._closed || this._disabled || !this.db) return;

      // First check if task exists
      const taskCheck = this.db.prepare('SELECT id FROM tasks WHERE id = ?');
      const task = taskCheck.get(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const stmt = this.db.prepare(`
        INSERT INTO task_notes (task_id, author, content, timestamp)
        VALUES (?, ?, ?, ?)
      `);

      stmt.run(taskId, note.author, note.content, note.timestamp.toISOString());

      // Update task's updated_at timestamp
      const updateStmt = this.db.prepare(`
        UPDATE tasks SET updated_at = ? WHERE id = ?
      `);
      updateStmt.run(new Date().toISOString(), taskId);
    });
  }

  // Batch load notes for multiple tasks to avoid N+1 queries
  private loadNotesBatch(taskIds: string[]): Map<string, TaskNote[]> {
    if (this._disabled || !this.db || taskIds.length === 0) return new Map();

    const placeholders = taskIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT * FROM task_notes 
      WHERE task_id IN (${placeholders})
      ORDER BY task_id, timestamp ASC
    `);

    const noteRows = stmt.all(...taskIds) as Array<{
      id: number;
      task_id: string;
      author: string;
      content: string;
      timestamp: string;
    }>;

    const notesMap = new Map<string, TaskNote[]>();

    for (const noteRow of noteRows) {
      const taskId = noteRow.task_id;
      if (!notesMap.has(taskId)) {
        notesMap.set(taskId, []);
      }

      notesMap.get(taskId)!.push({
        id: String(noteRow.id),
        author: noteRow.author as ThreadId,
        content: noteRow.content,
        timestamp: new Date(noteRow.timestamp),
      });
    }

    return notesMap;
  }

  async deleteTask(taskId: string): Promise<void> {
    return this.withRetry(() => {
      if (this._closed || this._disabled || !this.db) return;

      const stmt = this.db.prepare(`
        DELETE FROM tasks WHERE id = ?
      `);

      const result = stmt.run(taskId);

      if (result.changes === 0) {
        throw new Error(`Task ${taskId} not found`);
      }
    });
  }

  // Retry wrapper for write operations to handle SQLITE_BUSY
  private async withRetry<T>(operation: () => T, maxRetries = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return operation();
      } catch (error: unknown) {
        if ((error as { code?: string }).code === 'SQLITE_BUSY' && i < maxRetries - 1) {
          lastError = error;
          // Exponential backoff with proper async delay
          const delay = Math.min(100 * Math.pow(2, i), 1000);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  // ===============================
  // Session-related methods
  // ===============================

  saveSession(session: SessionData): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (id, project_id, name, description, configuration, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.projectId,
      session.name,
      session.description,
      JSON.stringify(session.configuration),
      session.status,
      session.createdAt.toISOString(),
      session.updatedAt.toISOString()
    );
  }

  loadSession(sessionId: string): SessionData | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);

    const row = stmt.get(sessionId) as
      | {
          id: string;
          project_id: string;
          name: string;
          description: string;
          configuration: string;
          status: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      configuration: JSON.parse(row.configuration) as Record<string, unknown>,
      status: row.status as 'active' | 'archived' | 'completed',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  loadSessionsByProject(projectId: string): SessionData[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ? 
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all(projectId) as Array<{
      id: ThreadId;
      project_id: string;
      name: string;
      description: string;
      configuration: string;
      status: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description,
      configuration: JSON.parse(row.configuration) as Record<string, unknown>,
      status: row.status as 'active' | 'archived' | 'completed',
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  updateSession(sessionId: string, updates: Partial<SessionData>): void {
    if (this._closed || this._disabled || !this.db) return;

    const updateFields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.configuration !== undefined) {
      updateFields.push('configuration = ?');
      values.push(JSON.stringify(updates.configuration));
    }
    if (updates.status !== undefined) {
      updateFields.push('status = ?');
      values.push(updates.status);
    }

    // Update timestamp - use provided updatedAt or current time
    updateFields.push('updated_at = ?');
    values.push(updates.updatedAt ? updates.updatedAt.toISOString() : new Date().toISOString());

    values.push(sessionId);

    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...values);
    if (result.changes === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }
  }

  deleteSession(sessionId: string): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      DELETE FROM sessions WHERE id = ?
    `);

    const result = stmt.run(sessionId);
    if (result.changes === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }
  }

  // Project persistence methods
  saveProject(project: ProjectData): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      project.id,
      project.name,
      project.description,
      project.workingDirectory,
      JSON.stringify(project.configuration),
      project.isArchived ? 1 : 0,
      project.createdAt.toISOString(),
      project.lastUsedAt.toISOString()
    );
  }

  loadProject(projectId: string): ProjectData | null {
    if (this._disabled || !this.db) return null;

    const stmt = this.db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `);

    const row = stmt.get(projectId) as
      | {
          id: string;
          name: string;
          description: string;
          working_directory: string;
          configuration: string;
          is_archived: number;
          created_at: string;
          last_used_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      workingDirectory: row.working_directory,
      configuration: JSON.parse(row.configuration) as Record<string, unknown>,
      isArchived: Boolean(row.is_archived),
      createdAt: new Date(row.created_at),
      lastUsedAt: new Date(row.last_used_at),
    };
  }

  loadAllProjects(): ProjectData[] {
    if (this._disabled || !this.db) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM projects ORDER BY last_used_at DESC
    `);

    const rows = stmt.all() as Array<{
      id: string;
      name: string;
      description: string;
      working_directory: string;
      configuration: string;
      is_archived: number;
      created_at: string;
      last_used_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      workingDirectory: row.working_directory,
      configuration: JSON.parse(row.configuration) as Record<string, unknown>,
      isArchived: Boolean(row.is_archived),
      createdAt: new Date(row.created_at),
      lastUsedAt: new Date(row.last_used_at),
    }));
  }

  updateProject(projectId: string, updates: Partial<ProjectData>): void {
    if (this._closed || this._disabled || !this.db) return;

    const updateFields: string[] = [];
    const values: (string | number)[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      updateFields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.workingDirectory !== undefined) {
      updateFields.push('working_directory = ?');
      values.push(updates.workingDirectory);
    }
    if (updates.configuration !== undefined) {
      updateFields.push('configuration = ?');
      values.push(JSON.stringify(updates.configuration));
    }
    if (updates.isArchived !== undefined) {
      updateFields.push('is_archived = ?');
      values.push(updates.isArchived ? 1 : 0);
    }

    // Always update last_used_at
    updateFields.push('last_used_at = ?');
    values.push(new Date().toISOString());

    values.push(projectId);

    const stmt = this.db.prepare(`
      UPDATE projects 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `);

    const result = stmt.run(...values);
    if (result.changes === 0) {
      throw new Error(`Project ${projectId} not found`);
    }
  }

  deleteProject(projectId: string): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      DELETE FROM projects WHERE id = ?
    `);

    const result = stmt.run(projectId);
    if (result.changes === 0) {
      throw new Error(`Project ${projectId} not found`);
    }
  }

  close(): void {
    if (!this._closed) {
      this._closed = true;
      if (this.db) {
        this.db.close();
      }
    }
  }
}

// Global persistence instance
let globalPersistence: DatabasePersistence | null = null;

export function initializePersistence(dbPath?: string): void {
  if (globalPersistence) {
    globalPersistence.close();
  }
  globalPersistence = new DatabasePersistence(dbPath || getLaceDbPath());
}

export function getPersistence(): DatabasePersistence {
  if (!globalPersistence) {
    // Auto-initialize with default path if not already initialized
    logger.info('Auto-initializing database persistence with default path');
    initializePersistence();
  }
  return globalPersistence!;
}

export function resetPersistence(): void {
  if (globalPersistence) {
    globalPersistence.close();
    globalPersistence = null;
  }
}
