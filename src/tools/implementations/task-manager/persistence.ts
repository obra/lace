// ABOUTME: SQLite persistence layer for task management with multi-agent support
// ABOUTME: Handles task CRUD, note management, and thread-based filtering with concurrency support

import Database from 'better-sqlite3';
import { Task, TaskNote } from './types.js';
import { ThreadId, AssigneeId } from '../../../threads/types.js';

export class TaskPersistence {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Set busy timeout (5 seconds)
    this.db.pragma('busy_timeout = 5000');

    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Create tasks table
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
      )
    `);

    // Create task notes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        author TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_thread_id ON tasks(thread_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes(task_id);
    `);
  }

  async saveTask(task: Task): Promise<void> {
    return this.withRetry(() => {
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
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);

    const row = stmt.get(taskId) as any;
    if (!row) return null;

    // Load notes for this task
    const notesStmt = this.db.prepare(`
      SELECT * FROM task_notes 
      WHERE task_id = ? 
      ORDER BY timestamp ASC
    `);

    const noteRows = notesStmt.all(taskId) as any[];
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
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to as AssigneeId | undefined,
      createdBy: row.created_by as ThreadId,
      threadId: row.thread_id as ThreadId,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      notes,
    };
  }

  loadTasksByThread(threadId: ThreadId): Task[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE thread_id = ? 
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(threadId) as any[];
    return rows.map((row) => this.loadTask(row.id)!).filter((task) => task !== null);
  }

  loadTasksByAssignee(assignee: AssigneeId): Task[] {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks 
      WHERE assigned_to = ? 
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(assignee) as any[];
    return rows.map((row) => this.loadTask(row.id)!).filter((task) => task !== null);
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    return this.withRetry(() => {
      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];

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

  // Retry wrapper for write operations to handle SQLITE_BUSY
  private withRetry<T>(operation: () => T, maxRetries = 3): T {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return operation();
      } catch (error: any) {
        if (error.code === 'SQLITE_BUSY' && i < maxRetries - 1) {
          lastError = error;
          // Exponential backoff
          const delay = Math.min(100 * Math.pow(2, i), 1000);
          const end = Date.now() + delay;
          while (Date.now() < end); // Simple sleep
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  close(): void {
    this.db.close();
  }
}
