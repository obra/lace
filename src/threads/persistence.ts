// ABOUTME: SQLite persistence layer for thread and event storage
// ABOUTME: Handles database schema, CRUD operations, and data serialization

import Database from 'better-sqlite3';
import { Thread, ThreadEvent, EventType } from './types.js';

export class ThreadPersistence {
  private db: Database.Database | null = null;
  private _closed: boolean = false;
  private _disabled: boolean = false;

  constructor(dbPath: string) {
    try {
      this.db = new Database(dbPath);
      this.initializeSchema();
    } catch (error) {
      console.error(
        `Failed to initialize database at ${dbPath}:`,
        error instanceof Error ? error.message : String(error)
      );
      console.error('Thread persistence disabled - data will only be stored in memory');
      this._disabled = true;
    }
  }

  private initializeSchema(): void {
    if (!this.db) return;
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
  }

  saveThread(thread: Thread): void {
    if (this._closed || this._disabled || !this.db) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO threads (id, created_at, updated_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(thread.id, thread.createdAt.toISOString(), thread.updatedAt.toISOString());
  }

  loadThread(threadId: string): Thread | null {
    if (this._disabled || !this.db) return null;

    const threadStmt = this.db.prepare(`
      SELECT * FROM threads WHERE id = ?
    `);

    const threadRow = threadStmt.get(threadId) as
      | { id: string; created_at: string; updated_at: string }
      | undefined;
    if (!threadRow) return null;

    const events = this.loadEvents(threadId);

    return {
      id: threadRow.id,
      createdAt: new Date(threadRow.created_at),
      updatedAt: new Date(threadRow.updated_at),
      events,
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
          data: JSON.parse(row.data),
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
      SELECT DISTINCT thread_id FROM events 
      WHERE thread_id LIKE ? 
      ORDER BY thread_id ASC
    `);

    const pattern = `${parentThreadId}.%`;
    const rows = stmt.all(pattern) as Array<{ thread_id: string }>;
    return rows.map((row) => row.thread_id);
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
