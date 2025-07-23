// ABOUTME: Tthread management with SQLite persistence support - PRIVATE AND INTERNAL. ONLY ACCESS THROUGH AGENT
// ABOUTME: Maintains backward compatibility with immediate event persistence

import {
  DatabasePersistence,
  SessionData,
  ProjectData,
  getPersistence,
} from '~/persistence/database';
import { Thread, ThreadEvent, EventType } from '~/threads/types';
import { ToolCall, ToolResult } from '~/tools/types';
import { logger } from '~/utils/logger';
import { estimateTokens } from '~/utils/token-estimation';

export interface ThreadSessionInfo {
  threadId: string;
  isResumed: boolean;
  resumeError?: string;
}

// Shared cache across all ThreadManager instances to ensure consistency
const sharedThreadCache = new Map<string, Thread>();

export class ThreadManager {
  private _persistence: DatabasePersistence;

  constructor() {
    this._persistence = getPersistence();
  }

  generateThreadId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `lace_${date}_${random}`;
  }

  generateDelegateThreadId(parentThreadId: string): string {
    const existingDelegates = this._persistence.getDelegateThreadsFor(parentThreadId);

    // Find highest counter for immediate children only
    let maxCounter = 0;
    const pattern = new RegExp(`^${escapeRegex(parentThreadId)}\\.(\\d+)$`);

    for (const delegateId of existingDelegates) {
      const match = delegateId.match(pattern);
      if (match) {
        const counter = parseInt(match[1], 10);
        maxCounter = Math.max(maxCounter, counter);
      }
    }

    return `${parentThreadId}.${maxCounter + 1}`;
  }

  resumeOrCreate(threadId?: string): ThreadSessionInfo {
    if (threadId) {
      try {
        // Just verify thread exists
        const thread = this.loadThread(threadId);
        if (!thread) {
          throw new Error(`Thread ${threadId} not found`);
        }
        return { threadId, isResumed: true };
      } catch (error) {
        // Fall through to create new
        const resumeError = error instanceof Error ? error.message : 'Unknown error';
        const newThreadId = this.generateThreadId();
        this.createThread(newThreadId);
        return {
          threadId: newThreadId,
          isResumed: false,
          resumeError: `Could not resume ${threadId}: ${resumeError}`,
        };
      }
    }

    // Create new thread
    const newThreadId = this.generateThreadId();
    this.createThread(newThreadId);
    return { threadId: newThreadId, isResumed: false };
  }

  // ===============================
  // Project coordination methods (minimal)
  // ===============================

  // Only keep project methods that ThreadManager actually needs for coordination
  getProject(projectId: string): ProjectData | null {
    return this._persistence.loadProject(projectId);
  }

  // ===============================
  // Session management methods
  // ===============================

  createSession(session: SessionData): void {
    this._persistence.saveSession(session);
    logger.info('Session created', { sessionId: session.id, projectId: session.projectId });
  }

  getSession(sessionId: string): SessionData | null {
    return this._persistence.loadSession(sessionId);
  }

  getSessionsByProject(projectId: string): SessionData[] {
    return this._persistence.loadSessionsByProject(projectId);
  }

  getAllSessions(): SessionData[] {
    // Get all sessions from the database
    if (!this._persistence.database) return [];

    const stmt = this._persistence.database.prepare(`
      SELECT * FROM sessions ORDER BY updated_at DESC
    `);

    const rows = stmt.all() as Array<{
      id: string;
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
    this._persistence.updateSession(sessionId, updates);
    logger.info('Session updated', { sessionId, updates });
  }

  deleteSession(sessionId: string): void {
    // First delete all threads in this session
    const threads = this.getThreadsBySession(sessionId);
    for (const thread of threads) {
      this.deleteThread(thread.id);
    }

    // Then delete the session
    this._persistence.deleteSession(sessionId);
    logger.info('Session deleted', { sessionId });
  }

  // ===============================
  // Thread management methods (updated)
  // ===============================

  // Existing API (preserved for backward compatibility)
  createThread(threadId?: string, sessionId?: string, projectId?: string): string {
    const actualThreadId = threadId || this.generateThreadId();
    const now = new Date();

    const thread: Thread = {
      id: actualThreadId,
      sessionId,
      projectId,
      createdAt: now,
      updatedAt: now,
      events: [],
    };

    // Save thread to database immediately (synchronous for createThread)
    try {
      // Use synchronous version to maintain createThread signature
      this._persistence.saveThread(thread);
    } catch (error) {
      logger.error('Failed to save thread', { error });
    }

    logger.info('Thread created', { threadId: actualThreadId, sessionId, projectId });
    return actualThreadId;
  }

  // Create thread with metadata for session management
  createThreadWithMetadata(threadId: string, metadata: Thread['metadata']): Thread {
    const thread: Thread = {
      id: threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
      metadata,
    };

    // Save thread to database immediately
    try {
      this._persistence.saveThread(thread);
    } catch (error) {
      logger.error('Failed to save thread with metadata', { threadId, error });
    }

    return thread;
  }

  // Create a delegate thread for the given parent without making it current
  createDelegateThreadFor(parentThreadId: string): Thread {
    const delegateThreadId = this.generateDelegateThreadId(parentThreadId);

    const thread: Thread = {
      id: delegateThreadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      events: [],
    };

    // Save thread to database without changing current thread
    try {
      this._persistence.saveThread(thread);
    } catch (error) {
      logger.error('Failed to save delegate thread', { error });
    }

    return thread;
  }

  getThread(threadId: string): Thread | undefined {
    // Check shared cache
    const cachedThread = sharedThreadCache.get(threadId);
    if (cachedThread) {
      return cachedThread;
    }

    // Load from persistence and cache
    try {
      const thread = this._persistence.loadThread(threadId);
      if (thread) {
        sharedThreadCache.set(threadId, thread);
        return thread;
      }
      return undefined;
    } catch (error) {
      logger.debug('Failed to load thread from persistence', {
        requestedThreadId: threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  addEvent(threadId: string, type: EventType, data: string | ToolCall | ToolResult): ThreadEvent {
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

    // Save event to persistence immediately
    try {
      this._persistence.saveEvent(event);
      // Update shared cache with modified thread
      sharedThreadCache.set(threadId, thread);
    } catch (error) {
      logger.error('Failed to save event', { error });
    }

    // Event emission removed - Agent will handle event emission for UI synchronization

    return event;
  }

  getEvents(threadId: string): ThreadEvent[] {
    const thread = this.getThread(threadId);
    return thread?.events || [];
  }

  getMainAndDelegateEvents(mainThreadId: string): ThreadEvent[] {
    const allEvents: ThreadEvent[] = [];

    // Get main thread events
    allEvents.push(...this.getEvents(mainThreadId));

    // Get delegate thread events
    const delegateThreads = this.listThreadIdsForSession(mainThreadId);
    for (const delegateThreadId of delegateThreads) {
      const delegateEvents = this._persistence.loadEvents(delegateThreadId);
      allEvents.push(...delegateEvents);
    }

    // Sort chronologically across all threads
    return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   * Get thread IDs for all delegate threads belonging to a session.
   * Returns only the IDs, not full thread objects. Use getThreadsBySession()
   * if you need full Thread objects with events.
   */
  listThreadIdsForSession(sessionId: string): string[] {
    // Use the persistence layer's SQL-based filtering instead
    return this._persistence.getDelegateThreadsFor(sessionId);
  }

  // Get all threads with metadata for session management
  getAllThreadsWithMetadata(): Thread[] {
    return this._persistence.getAllThreadsWithMetadata();
  }

  /**
   * Get full Thread objects (with events loaded) for all threads belonging to a session.
   * This is more expensive than listThreadIdsForSession() as it loads all events.
   */
  getThreadsBySession(sessionId: string): Thread[] {
    // Get threads without events first
    const threadsWithoutEvents = this._persistence.getThreadsBySession(sessionId);

    // Load events for each thread
    return threadsWithoutEvents.map((thread) => ({
      ...thread,
      events: this._persistence.loadEvents(thread.id),
    }));
  }

  // Update existing methods to not treat threads as sessions
  getAllThreads(): Thread[] {
    const threads = this._persistence.getAllThreadsWithMetadata();

    // Filter out legacy session threads to avoid confusion
    return threads.filter((thread) => !thread.metadata?.isSession);
  }

  updateThreadMetadata(threadId: string, metadata: Record<string, unknown>): void {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    thread.metadata = metadata;
    thread.updatedAt = new Date();

    try {
      this._persistence.saveThread(thread);
      // Update shared cache with modified thread
      sharedThreadCache.set(threadId, thread);
    } catch (error) {
      logger.error('Failed to update thread metadata', { threadId, error });
    }
  }

  deleteThread(threadId: string): void {
    // Delete all events for this thread
    if (this._persistence.database) {
      this._persistence.database.prepare('DELETE FROM events WHERE thread_id = ?').run(threadId);
      this._persistence.database.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
    }

    // Remove from shared cache
    sharedThreadCache.delete(threadId);

    logger.info('Thread deleted', { threadId });
  }

  compact(threadId: string): void {
    const thread = this.getThread(threadId);
    if (!thread) return;

    let compactedCount = 0;
    let totalTokensSaved = 0;

    // Modify the actual events in memory - that's it
    for (const event of thread.events) {
      if (event.type === 'TOOL_RESULT') {
        const toolResult = event.data as ToolResult;
        const originalText = toolResult.content?.[0]?.text || '';
        const originalTokens = this._estimateTokens(originalText);

        const truncatedText = this._truncateToolResult(originalText);
        if (toolResult.content && toolResult.content[0]) {
          toolResult.content[0].text = truncatedText;
        }
        const newTokens = this._estimateTokens(truncatedText);

        if (newTokens < originalTokens) {
          compactedCount++;
          totalTokensSaved += originalTokens - newTokens;
        }
      }
    }

    logger.info('Thread compacted', {
      threadId,
      toolResultsCompacted: compactedCount,
      approximateTokensSaved: totalTokensSaved,
    });

    // Add informational message to thread (shown to user but not sent to model)
    const tokenMessage =
      totalTokensSaved > 0 ? ` to save about ${totalTokensSaved} tokens` : ' to save tokens';

    const event: ThreadEvent = {
      id: generateEventId(),
      threadId,
      type: 'LOCAL_SYSTEM_MESSAGE',
      timestamp: new Date(),
      data: `🗜️ Compacted ${compactedCount} tool results${tokenMessage}.`,
    };

    thread.events.push(event);
    thread.updatedAt = new Date();

    // Save the compaction event to persistence
    try {
      this._persistence.saveEvent(event);
    } catch (error) {
      logger.error('Failed to save compaction event', { error });
    }
  }

  private _truncateToolResult(output: string): string {
    const words = output.split(/\s+/);
    if (words.length <= 200) return output;

    const truncated = words.slice(0, 200).join(' ');
    const remaining = words.length - 200;
    return `${truncated}... [truncated ${remaining} more words of tool output]`;
  }

  private _estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  clearEvents(threadId: string): void {
    const thread = this.getThread(threadId);
    if (thread) {
      thread.events.length = 0; // Clear the events array to free memory
    }
  }

  // New persistence methods
  loadThread(threadId: string): Thread {
    const thread = this._persistence.loadThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found in database`);
    }
    return thread;
  }

  saveThread(thread: Thread): void {
    try {
      this._persistence.saveThread(thread);
      // Update shared cache with saved thread
      sharedThreadCache.set(thread.id, thread);
    } catch (error) {
      logger.error('Failed to save thread', { threadId: thread.id, error });
    }
  }

  getLatestThreadId(): string | null {
    return this._persistence.getLatestThreadId();
  }

  // Cleanup
  close(): void {
    // Clear caches
    sharedThreadCache.clear();
    this._persistence.close();
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
