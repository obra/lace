// ABOUTME: Consolidated SQLite persistence layer for threads, events, and tasks
// ABOUTME: Handles database schema, CRUD operations, and data serialization for all entities

// Common SQLite interface that both better-sqlite3 and bun:sqlite implement
interface SQLiteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  pragma(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

// Type for the Database constructor
type DatabaseConstructor = new (path: string) => SQLiteDatabase;

// Dynamic import to handle both Node.js and Bun runtimes
let Database: DatabaseConstructor;
if (process?.versions?.bun) {
  // Running in Bun - use built-in SQLite
  // Use string concatenation to prevent webpack from analyzing this import
  const bunSqlite = (await import('bun' + ':sqlite')) as { Database: DatabaseConstructor };
  Database = bunSqlite.Database;
} else {
  // Running in Node.js - use better-sqlite3
  const betterSqlite3 = await import('better-sqlite3');
  Database = betterSqlite3.default as DatabaseConstructor;
}

import { getLaceDbPath } from '~/config/lace-dir';
import {
  Thread,
  LaceEvent,
  LaceEventType,
  ThreadId,
  AssigneeId,
  AgentMessageData,
} from '~/threads/types';
import type { ToolCall, ToolResult } from '~/tools/types';
import {
  Task,
  TaskNote,
  TaskStatus,
  TaskPriority,
} from '~/tools/implementations/task-manager/types';
import { logger } from '~/utils/logger';
import type { CompactionData } from '~/threads/compaction/types';
import type { ToolApprovalRequestData, ToolApprovalResponseData } from '~/threads/types';

// Helper function to create properly typed LaceEvent from database row
function createLaceEventFromDb(
  id: string,
  threadId: string,
  type: LaceEventType,
  timestamp: Date,
  data: unknown
): LaceEvent {
  const baseEvent = { id, threadId, timestamp };

  switch (type) {
    case 'USER_MESSAGE':
    case 'LOCAL_SYSTEM_MESSAGE':
    case 'SYSTEM_PROMPT':
    case 'USER_SYSTEM_PROMPT':
      return { ...baseEvent, type, data: data as string };

    case 'AGENT_MESSAGE':
      return { ...baseEvent, type, data: data as AgentMessageData };

    case 'TOOL_CALL':
      return { ...baseEvent, type, data: data as ToolCall };

    case 'TOOL_RESULT':
      return { ...baseEvent, type, data: data as ToolResult };

    case 'COMPACTION':
      return { ...baseEvent, type, data: data as CompactionData };

    case 'TOOL_APPROVAL_REQUEST':
      return { ...baseEvent, type, data: data as ToolApprovalRequestData };

    case 'TOOL_APPROVAL_RESPONSE':
      return { ...baseEvent, type, data: data as ToolApprovalResponseData };

    // Transient event types - these should never be persisted to database
    // but we need cases for TypeScript exhaustive checking
    case 'AGENT_TOKEN':
      throw new Error('AGENT_TOKEN events are transient and should not be persisted');

    case 'AGENT_STREAMING':
      throw new Error('AGENT_STREAMING events are transient and should not be persisted');

    case 'AGENT_STATE_CHANGE':
      throw new Error('AGENT_STATE_CHANGE events are transient and should not be persisted');

    case 'COMPACTION_START':
      throw new Error('COMPACTION_START events are transient and should not be persisted');

    case 'COMPACTION_COMPLETE':
      throw new Error('COMPACTION_COMPLETE events are transient and should not be persisted');

    // Task events are transient
    case 'TASK_CREATED':
    case 'TASK_UPDATED':
    case 'TASK_DELETED':
    case 'TASK_NOTE_ADDED':
      throw new Error(`${type} events are transient and should not be persisted`);

    // Agent lifecycle events are transient
    case 'AGENT_SPAWNED':
      throw new Error('AGENT_SPAWNED events are transient and should not be persisted');

    // Project events are transient
    case 'PROJECT_CREATED':
    case 'PROJECT_UPDATED':
    case 'PROJECT_DELETED':
      throw new Error(`${type} events are transient and should not be persisted`);

    // System events are transient
    case 'SYSTEM_NOTIFICATION':
      throw new Error('SYSTEM_NOTIFICATION events are transient and should not be persisted');

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown event type: ${String(_exhaustive)}`);
    }
  }
}

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
  private db: SQLiteDatabase | null = null;
  private _closed: boolean = false;
  private _disabled: boolean = false;

  get database(): SQLiteDatabase | null {
    return this.db;
  }

  constructor(dbPath: string | SQLiteDatabase) {
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

    if (currentVersion < 10) {
      this.migrateToV10();
    }
    if (currentVersion < 11) {
      this.migrateToV11();
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

  private migrateToV10(): void {
    if (!this.db) return;

    // Clean schema without shadow thread complexity
    this.db.exec(`
      -- Core thread storage
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT DEFAULT NULL
      );

      -- Event storage
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data JSONB NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id)
      );

      -- Task management
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

      -- Project management
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        working_directory TEXT NOT NULL,
        configuration TEXT DEFAULT '{}',
        is_archived BOOLEAN DEFAULT FALSE,
        created_at TEXT DEFAULT (datetime('now')),
        last_used_at TEXT DEFAULT (datetime('now'))
      );

      -- Session management
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
      );

      -- Essential indexes only
      CREATE INDEX IF NOT EXISTS idx_events_thread_timestamp ON events(thread_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes(task_id);
      
      -- Approval query optimization indexes
      CREATE INDEX IF NOT EXISTS idx_approval_tool_call_id 
      ON events ((data->>'toolCallId')) 
      WHERE type IN ('TOOL_APPROVAL_REQUEST', 'TOOL_APPROVAL_RESPONSE');
      
      CREATE INDEX IF NOT EXISTS idx_tool_call_id
      ON events ((data->>'id'))
      WHERE type = 'TOOL_CALL';
    `);

    this.setSchemaVersion(10);
  }

  private migrateToV11(): void {
    if (!this.db) return;

    // Add unique constraint for tool approval responses to prevent race conditions
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_tool_approval
      ON events(thread_id, type, json_extract(data, '$.toolCallId'))  
      WHERE type = 'TOOL_APPROVAL_RESPONSE';
    `);

    this.setSchemaVersion(11);
  }

  transaction<T>(fn: () => T): T {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return this.db.transaction(fn)();
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
    if (this._disabled || !this.db || this._closed) return null;

    const actualThreadId = threadId;

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

  saveEvent(event: LaceEvent): boolean {
    if (this._closed || this._disabled || !this.db) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO events (id, thread_id, type, timestamp, data)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(
        event.id,
        event.threadId,
        event.type,
        event.timestamp!.toISOString(),
        JSON.stringify(event.data)
      );

      // Update thread's updated_at timestamp
      const updateThreadStmt = this.db.prepare(`
        UPDATE threads SET updated_at = ? WHERE id = ?
      `);
      updateThreadStmt.run(new Date().toISOString(), event.threadId);

      return true; // Event was successfully saved
    } catch (error: unknown) {
      // Handle constraint violations for duplicate approval responses idempotently
      if (this.isConstraintViolation(error) && event.type === 'TOOL_APPROVAL_RESPONSE') {
        // Silently ignore duplicate approval responses - this is the desired idempotent behavior
        logger.debug('DATABASE: Duplicate approval response ignored', {
          eventId: event.id,
          toolCallId: (event.data as { toolCallId?: string }).toolCallId,
        });
        return false; // Event was ignored due to duplicate
      }

      // Re-throw other errors (including constraint violations for non-approval events)
      throw error;
    }
  }

  private isConstraintViolation(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('UNIQUE constraint failed') ||
        error.message.includes('SQLITE_CONSTRAINT_UNIQUE'))
    );
  }

  loadEvents(threadId: string): LaceEvent[] {
    if (this._disabled || !this.db || this._closed) return [];

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

    // Load events from database for thread

    return rows.map((row) => {
      try {
        return createLaceEventFromDb(
          row.id,
          row.thread_id,
          row.type as LaceEventType,
          new Date(row.timestamp),
          JSON.parse(row.data) as unknown
        );
      } catch (error) {
        throw new Error(
          `Failed to parse event data for event ${row.id}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  getLatestThreadId(): string | null {
    if (this._disabled || !this.db || this._closed) return null;

    const stmt = this.db.prepare(`
      SELECT id FROM threads 
      ORDER BY updated_at DESC 
      LIMIT 1
    `);

    const row = stmt.get() as { id: string } | undefined;
    return row ? row.id : null;
  }

  getDelegateThreadsFor(parentThreadId: string): string[] {
    if (this._disabled || !this.db || this._closed) return [];

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
    if (this._disabled || !this.db || this._closed) return [];

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
    if (this._disabled || !this.db || this._closed) return null;

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
    if (this._disabled || !this.db || this._closed) return [];

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
    if (this._disabled || !this.db || this._closed) return [];

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
    if (this._disabled || !this.db || this._closed || taskIds.length === 0) return new Map();

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
    if (this._disabled || !this.db || this._closed) return null;

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
    if (this._disabled || !this.db || this._closed) return [];

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
    if (this._disabled || !this.db || this._closed) return null;

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
    if (this._disabled || !this.db || this._closed) return [];

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

  // ===============================
  // Approval-related methods
  // ===============================

  getPendingApprovals(threadId: string): Array<{
    toolCallId: string;
    toolCall: unknown;
    requestedAt: Date;
  }> {
    if (this._disabled || !this.db || this._closed) return [];

    const stmt = this.db.prepare(`
      SELECT 
        req.data->>'toolCallId' as tool_call_id,
        tc.data as tool_call_data,
        req.timestamp as requested_at
      FROM events req
      JOIN events tc ON tc.data->>'id' = req.data->>'toolCallId'  
      WHERE req.type = 'TOOL_APPROVAL_REQUEST'
        AND req.thread_id = ?
        AND tc.type = 'TOOL_CALL'
        AND NOT EXISTS (
          SELECT 1 FROM events resp 
          WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
            AND resp.data->>'toolCallId' = req.data->>'toolCallId'
        )
      ORDER BY req.timestamp ASC
    `);

    const rows = stmt.all(threadId) as Array<{
      tool_call_id: string;
      tool_call_data: string;
      requested_at: string;
    }>;

    return rows.map((row) => ({
      toolCallId: row.tool_call_id,
      toolCall: JSON.parse(row.tool_call_data) as unknown,
      requestedAt: new Date(row.requested_at),
    }));
  }

  getApprovalDecision(toolCallId: string): string | null {
    if (this._disabled || !this.db || this._closed) return null;

    const stmt = this.db.prepare(`
      SELECT resp.data->>'decision' as decision
      FROM events resp
      WHERE resp.type = 'TOOL_APPROVAL_RESPONSE'
        AND resp.data->>'toolCallId' = ?
      LIMIT 1
    `);

    const row = stmt.get(toolCallId) as { decision: string } | undefined;
    return row?.decision || null;
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

function initializePersistence(dbPath?: string): void {
  const finalDbPath = dbPath || getLaceDbPath();
  if (globalPersistence) {
    globalPersistence.close();
  }
  globalPersistence = new DatabasePersistence(finalDbPath);
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
