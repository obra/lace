// ABOUTME: Enhanced thread management with SQLite persistence support
// ABOUTME: Maintains backward compatibility while adding session persistence and auto-save

import { ThreadPersistence } from './persistence.js';
import { Thread, ThreadEvent, EventType, ToolCallData, ToolResultData } from './types.js';

export class ThreadManager {
  private _currentThread: Thread | null = null;
  private _persistence: ThreadPersistence;
  private _autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string) {
    this._persistence = new ThreadPersistence(dbPath);
  }

  // Existing API (preserved for backward compatibility)
  createThread(threadId: string): Thread {
    const thread: Thread = {
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };

    this._currentThread = thread;

    // Save thread to database immediately (synchronous for createThread)
    try {
      // Use synchronous version to maintain createThread signature
      this._persistence.saveThread(thread);
    } catch (error) {
      console.error('Failed to save thread:', error);
    }

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
    try {
      this._persistence.saveEvent(event);
    } catch (error) {
      console.error('Failed to save event:', error);
    }

    return event;
  }

  getEvents(threadId: string): ThreadEvent[] {
    const thread = this.getThread(threadId);
    return thread?.events || [];
  }

  // New persistence methods
  async loadThread(threadId: string): Promise<Thread> {
    const thread = this._persistence.loadThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found in database`);
    }
    return thread;
  }

  async saveCurrentThread(): Promise<void> {
    if (!this._currentThread) return;

    this._persistence.saveThread(this._currentThread);
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
      try {
        await this.saveCurrentThread();
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
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
    try {
      await this.saveCurrentThread();
    } catch {
      // Ignore save errors on close
    }
    this._persistence.close();
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
