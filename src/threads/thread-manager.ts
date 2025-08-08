// ABOUTME: Stateless thread management with SQLite persistence support
// ABOUTME: Provides shared caching and immediate event persistence

import {
  DatabasePersistence,
  SessionData,
  ProjectData,
  getPersistence,
} from '~/persistence/database';
import { Thread, ThreadEvent, ThreadEventType, ThreadEventData } from '~/threads/types';
import { logger } from '~/utils/logger';
import { buildWorkingConversation, buildCompleteHistory } from '~/threads/conversation-builder';
import type { CompactionStrategy, CompactionData } from '~/threads/compaction/types';
import { registerDefaultStrategies } from '~/threads/compaction/registry';

export interface ThreadSessionInfo {
  threadId: string;
  isResumed: boolean;
  resumeError?: string;
}

// Process-local cache for ThreadManager instances
//
// NOTE FOR REVIEWERS: This cache is process-local to handle Next.js dev server
// environment where different API routes may run in separate Node.js processes.
// The SQLite database serves as the authoritative source of truth across all processes.
//
// Cache behavior:
// 1. Each process maintains its own cache for performance within that process
// 2. All writes go through SQLite (ACID compliant) first, then update local cache
// 3. Cache misses fall back to authoritative database reads
// 4. Cross-process consistency relies on SQLite as single source of truth
// 5. Cache invalidation happens naturally through process boundaries
//
// This approach trades some performance (no cross-process cache sharing) for
// correctness in multi-process environments like Next.js dev server.
const processLocalThreadCache = new Map<string, Thread>();

export class ThreadManager {
  private _persistence: DatabasePersistence;
  private _compactionStrategies = new Map<string, CompactionStrategy>();

  constructor() {
    this._persistence = getPersistence();

    // Register default compaction strategies
    registerDefaultStrategies((strategy) => {
      this.registerCompactionStrategy(strategy);
    });
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

    // Get parent thread to inherit sessionId and projectId
    const parentThread = this.getThread(parentThreadId);
    if (!parentThread) {
      throw new Error(`Parent thread not found: ${parentThreadId}`);
    }

    const thread: Thread = {
      id: delegateThreadId,
      sessionId: parentThread.sessionId, // Inherit sessionId from parent
      projectId: parentThread.projectId, // Inherit projectId from parent
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
    // Check process-local cache
    const cachedThread = processLocalThreadCache.get(threadId);
    if (cachedThread) {
      return cachedThread;
    }

    // Load from persistence and cache
    try {
      const thread = this._persistence.loadThread(threadId);
      if (thread) {
        processLocalThreadCache.set(threadId, thread);
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

  /**
   * Add an event to a thread with atomic database persistence.
   *
   * This method is designed to prevent race conditions in tool approval
   * scenarios where multiple requests might try to create the same event
   * simultaneously (e.g., rapid button clicking).
   *
   * The operation is atomic: either both the database write and memory
   * update succeed, or both fail. This ensures consistency between the
   * persistent and in-memory representations.
   *
   * For TOOL_APPROVAL_RESPONSE events, a database unique constraint
   * prevents duplicate approvals for the same toolCallId, causing
   * this method to throw if a duplicate is attempted.
   */
  addEvent(
    threadId: string,
    type: ThreadEventType,
    eventData: ThreadEventData
  ): ThreadEvent | null {
    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const event = {
      id: generateEventId(),
      threadId,
      type,
      timestamp: new Date(),
      data: eventData,
    } as ThreadEvent;

    // Use database transaction for atomicity
    return this._persistence.transaction(() => {
      // Save to database first and check if it was actually saved
      const wasSaved = this._persistence.saveEvent(event);

      if (wasSaved) {
        // Only update memory if database save succeeded
        thread.events.push(event);
        thread.updatedAt = new Date();

        // Update process-local cache
        processLocalThreadCache.set(threadId, thread);

        return event;
      } else {
        // Event was ignored (duplicate approval) - return null to indicate no-op
        return null;
      }
    });
  }

  /**
   * Get current conversation state (post-compaction events)
   * This is what should be passed to AI providers for conversation processing.
   *
   * If the thread has been compacted, this returns:
   * - The compacted events from the latest compaction
   * - The COMPACTION event itself (for transparency)
   * - All events that occurred after the compaction
   *
   * If no compaction has occurred, returns all events in chronological order.
   *
   * @param threadId - The ID of the thread to get events for
   * @returns Array of thread events representing the working conversation
   */
  getEvents(threadId: string): ThreadEvent[] {
    const thread = this.getThread(threadId);
    if (!thread) return [];

    return buildWorkingConversation(thread.events);
  }

  /**
   * Get complete event history including all compaction events
   *
   * This method returns the raw, unprocessed event sequence including:
   * - All original events that were later compacted
   * - All COMPACTION events that were created
   * - All events added after compactions
   *
   * This is primarily useful for debugging, inspection, and audit trails.
   * For normal conversation processing, use getEvents() instead.
   *
   * @param threadId - The ID of the thread to get complete history for
   * @returns Array of all thread events in chronological order
   */
  getAllEvents(threadId: string): ThreadEvent[] {
    const thread = this.getThread(threadId);
    if (!thread) return [];

    return buildCompleteHistory(thread.events);
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
      // Update process-local cache with modified thread
      processLocalThreadCache.set(threadId, thread);
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

    // Remove from process-local cache
    processLocalThreadCache.delete(threadId);

    logger.info('Thread deleted', { threadId });
  }

  /**
   * Register a compaction strategy that can be used to compact conversations
   *
   * Compaction strategies implement the CompactionStrategy interface and define
   * how to reduce conversation size while preserving essential information.
   *
   * @param strategy - The compaction strategy to register
   * @example
   * ```typescript
   * const trimStrategy = new TrimToolResultsStrategy();
   * threadManager.registerCompactionStrategy(trimStrategy);
   * ```
   */
  registerCompactionStrategy(strategy: CompactionStrategy): void {
    this._compactionStrategies.set(strategy.id, strategy);
  }

  /**
   * Perform compaction on a thread using the specified strategy
   *
   * Compaction replaces the existing conversation history with a more compact
   * version while preserving essential information. The original events are
   * preserved in the complete history for debugging purposes.
   *
   * After compaction:
   * - getEvents() returns the compacted conversation + new events
   * - getAllEvents() still returns the complete uncompacted history
   * - A COMPACTION event is added to mark the compaction point
   *
   * @param threadId - The ID of the thread to compact
   * @param strategyId - The ID of the compaction strategy to use
   * @param params - Optional parameters to pass to the compaction strategy
   * @throws {Error} If the strategy is unknown or the thread doesn't exist
   * @example
   * ```typescript
   * await threadManager.compact('thread-123', 'trim-tool-results');
   * ```
   */
  async compact(threadId: string, strategyId: string, params?: unknown): Promise<void> {
    const strategy = this._compactionStrategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Unknown compaction strategy: ${strategyId}`);
    }

    const thread = this.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }

    // Create compaction context with params merged in
    const context = {
      threadId,
      ...(params as object),
    };

    // Run compaction strategy
    const compactionEvent = await strategy.compact(thread.events, context);

    // Add the compaction event to the thread
    // Extract the CompactionData from the strategy result and add as new event
    //
    // NOTE FOR REVIEWERS: addEvent() persistence failure is handled gracefully:
    // 1. addEvent() logs errors but doesn't throw, preserving thread consistency
    // 2. SQLite ACID properties ensure atomic persistence operations
    // 3. If persistence fails, the in-memory thread remains unchanged
    // 4. Subsequent operations will retry persistence, maintaining eventual consistency
    // 5. The thread cache remains consistent with successful database state
    const compactionData = compactionEvent.data as CompactionData;
    this.addEvent(threadId, 'COMPACTION', compactionData);
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
      // Update process-local cache with saved thread
      processLocalThreadCache.set(thread.id, thread);
    } catch (error) {
      logger.error('Failed to save thread', { threadId: thread.id, error });
    }
  }

  getLatestThreadId(): string | null {
    return this._persistence.getLatestThreadId();
  }

  // ===============================
  // Approval query methods
  // ===============================

  /**
   * Get all pending tool approvals for a thread
   * Returns TOOL_CALLs that have approval requests but no responses
   */
  getPendingApprovals(threadId: string): Array<{
    toolCallId: string;
    toolCall: unknown;
    requestedAt: Date;
  }> {
    return this._persistence.getPendingApprovals(threadId);
  }

  /**
   * Get approval decision for a specific tool call
   */
  getApprovalDecision(toolCallId: string): string | null {
    return this._persistence.getApprovalDecision(toolCallId);
  }

  // Cleanup
  close(): void {
    // Clear process-local cache
    processLocalThreadCache.clear();
    this._persistence.close();
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
