// ABOUTME: SQLite persistence layer for thread and event storage
// ABOUTME: Handles database schema, CRUD operations, and data serialization

import Database from 'better-sqlite3';
import { Thread, ThreadEvent, EventType, VersionHistoryEntry } from './types.js';

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

    // Check if this is a canonical ID with a current version
    const currentVersionId = this.getCurrentVersion(threadId);
    const actualThreadId = currentVersionId || threadId;

    const threadStmt = this.db.prepare(`
      SELECT * FROM threads WHERE id = ?
    `);

    const threadRow = threadStmt.get(actualThreadId) as
      | { id: string; created_at: string; updated_at: string }
      | undefined;
    if (!threadRow) return null;

    const events = this.loadEvents(actualThreadId);

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

  close(): void {
    if (!this._closed) {
      this._closed = true;
      if (this.db) {
        this.db.close();
      }
    }
  }
}
