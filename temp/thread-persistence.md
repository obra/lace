# Thread Persistence Design

## Overview
Minimal thread persistence implementation to enable resumable Lace sessions with SQLite storage.

## Database Schema

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  data JSONB NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE INDEX idx_events_thread_timestamp ON events(thread_id, timestamp);
CREATE INDEX idx_threads_updated ON threads(updated_at DESC);
```

## Core Types (Extensions)

```typescript
// Extend existing Thread type for persistence metadata
export interface ThreadMetadata {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  eventCount: number;
}
```

## ThreadPersistence Class

```typescript
import Database from 'better-sqlite3';
import { Thread, ThreadEvent } from '../types.js';

export class ThreadPersistence {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeSchema();
  }

  private initializeSchema(): void {
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

  async saveThread(thread: Thread): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO threads (id, created_at, updated_at)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(
      thread.id,
      thread.createdAt.toISOString(),
      thread.updatedAt.toISOString()
    );
  }

  async loadThread(threadId: string): Promise<Thread | null> {
    const threadStmt = this.db.prepare(`
      SELECT * FROM threads WHERE id = ?
    `);
    
    const threadRow = threadStmt.get(threadId);
    if (!threadRow) return null;

    const events = await this.loadEvents(threadId);

    return {
      id: threadRow.id,
      createdAt: new Date(threadRow.created_at),
      updatedAt: new Date(threadRow.updated_at),
      events
    };
  }

  async saveEvent(event: ThreadEvent): Promise<void> {
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

  async loadEvents(threadId: string): Promise<ThreadEvent[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM events 
      WHERE thread_id = ? 
      ORDER BY timestamp ASC
    `);
    
    const rows = stmt.all(threadId);
    
    return rows.map(row => ({
      id: row.id,
      threadId: row.thread_id,
      type: row.type,
      timestamp: new Date(row.timestamp),
      data: JSON.parse(row.data)
    }));
  }

  async getLatestThreadId(): Promise<string | null> {
    const stmt = this.db.prepare(`
      SELECT id FROM threads 
      ORDER BY updated_at DESC 
      LIMIT 1
    `);
    
    const row = stmt.get();
    return row ? row.id : null;
  }

  close(): void {
    this.db.close();
  }
}
```

## Enhanced ThreadManager

```typescript
import { ThreadPersistence } from './persistence.js';
import { Thread, ThreadEvent, EventType } from './types.js';

export class ThreadManager {
  private _currentThread: Thread | null = null;
  private _persistence: ThreadPersistence;
  private _autoSaveInterval: NodeJS.Timeout | null = null;

  constructor(dbPath: string) {
    this._persistence = new ThreadPersistence(dbPath);
  }

  // Existing API (preserved)
  createThread(threadId: string): Thread {
    const thread: Thread = {
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };
    
    this._currentThread = thread;
    return thread;
  }

  getThread(threadId: string): Thread | undefined {
    if (this._currentThread?.id === threadId) {
      return this._currentThread;
    }
    return undefined;
  }

  addEvent(
    threadId: string,
    type: EventType,
    data: string | ToolCallData | ToolResultData
  ): ThreadEvent {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const event: ThreadEvent = {
      id: generateEventId(),
      threadId,
      type,
      timestamp: new Date(),
      data,
    };

    thread.events.push(event);
    thread.updatedAt = new Date();

    // Auto-save event to persistence
    this._persistence.saveEvent(event).catch(error => {
      console.error('Failed to save event:', error);
    });

    return event;
  }

  getEvents(threadId: string): ThreadEvent[] {
    const thread = this.getThread(threadId);
    return thread?.events || [];
  }

  // New persistence methods
  async loadThread(threadId: string): Promise<Thread> {
    const thread = await this._persistence.loadThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found in database`);
    }
    return thread;
  }

  async saveCurrentThread(): Promise<void> {
    if (!this._currentThread) return;
    
    await this._persistence.saveThread(this._currentThread);
  }

  async setCurrentThread(threadId: string): Promise<void> {
    // Save current thread before switching
    await this.saveCurrentThread();
    
    // Load new thread
    this._currentThread = await this.loadThread(threadId);
  }

  async getLatestThreadId(): Promise<string | null> {
    return this._persistence.getLatestThreadId();
  }

  getCurrentThreadId(): string | null {
    return this._currentThread?.id || null;
  }

  // Auto-save management
  enableAutoSave(intervalMs: number = 30000): void {
    this.disableAutoSave();
    
    this._autoSaveInterval = setInterval(async () => {
      await this.saveCurrentThread();
    }, intervalMs);
  }

  disableAutoSave(): void {
    if (this._autoSaveInterval) {
      clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = null;
    }
  }

  // Cleanup
  async close(): Promise<void> {
    this.disableAutoSave();
    await this.saveCurrentThread();
    this._persistence.close();
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

## Thread ID Generation

```typescript
export function generateThreadId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `lace_${date}_${random}`;
}
```

## CLI Integration

```typescript
import { ThreadManager } from './thread-manager.js';
import { generateThreadId } from './utils.js';
import { getLaceDbPath } from '../config/lace-dir.js';

export async function startSession(args: string[]): Promise<{ threadManager: ThreadManager, threadId: string }> {
  const threadManager = new ThreadManager(getLaceDbPath());
  
  if (args.includes('--continue')) {
    const sessionIdArg = args.find(arg => arg.startsWith('lace_'));
    const threadId = sessionIdArg || await threadManager.getLatestThreadId();
    
    if (threadId) {
      try {
        await threadManager.setCurrentThread(threadId);
        console.log(`Continuing conversation ${threadId}`);
        return { threadManager, threadId };
      } catch (error) {
        console.warn(`Could not resume ${threadId}, starting new session`);
      }
    }
  }
  
  // Start new session
  const threadId = generateThreadId();
  threadManager.createThread(threadId);
  threadManager.enableAutoSave();
  console.log(`Starting conversation ${threadId}`);
  
  return { threadManager, threadId };
}

export async function handleGracefulShutdown(threadManager: ThreadManager): Promise<void> {
  await threadManager.close();
}
```

## Usage

```bash
# Start new session
lace

# Continue latest session  
lace --continue

# Continue specific session
lace --continue lace_20250615_abc123
```

## Implementation Notes

- Uses `better-sqlite3` for SQLite database access
- Auto-saves current thread every 30 seconds
- Saves individual events immediately when added
- Graceful degradation if database is unavailable
- Preserves existing ThreadManager API for backward compatibility
- Thread metadata automatically maintained (created_at, updated_at)