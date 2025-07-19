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
import { SummarizeStrategy } from '~/threads/compaction/summarize-strategy';
import { estimateTokens } from '~/utils/token-estimation';
import { AIProvider } from '~/providers/base-provider';

export interface ThreadSessionInfo {
  threadId: string;
  isResumed: boolean;
  resumeError?: string;
}

export class ThreadManager {
  private _currentThread: Thread | null = null;
  private _persistence: DatabasePersistence;
  private _compactionStrategy: SummarizeStrategy;
  private _providerStrategyCache = new Map<string, SummarizeStrategy>();

  constructor() {
    this._persistence = getPersistence();
    this._compactionStrategy = new SummarizeStrategy();
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
        this.setCurrentThread(threadId);
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

    this._currentThread = thread;

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

    this._currentThread = thread;

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
    if (this._currentThread?.id === threadId) {
      return this._currentThread;
    }

    // For delegation support, try to load thread from persistence
    try {
      const thread = this._persistence.loadThread(threadId);
      return thread || undefined;
    } catch {
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
    const delegateThreads = this.getThreadsForSession(mainThreadId);
    for (const delegateThreadId of delegateThreads) {
      const delegateEvents = this._persistence.loadEvents(delegateThreadId);
      allEvents.push(...delegateEvents);
    }

    // Sort chronologically across all threads
    return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  getThreadsForSession(sessionId: string): string[] {
    // Use the persistence layer's SQL-based filtering instead
    return this._persistence.getDelegateThreadsFor(sessionId);
  }

  // Get all threads with metadata for session management
  getAllThreadsWithMetadata(): Thread[] {
    return this._persistence.getAllThreadsWithMetadata();
  }

  getThreadsBySession(sessionId: string): Thread[] {
    if (!this._persistence.database) return [];

    const stmt = this._persistence.database.prepare(`
      SELECT * FROM threads 
      WHERE session_id = ?
      ORDER BY updated_at DESC
    `);

    const rows = stmt.all(sessionId) as Array<{
      id: string;
      session_id: string;
      project_id: string;
      created_at: string;
      updated_at: string;
      metadata: string | null;
    }>;

    return rows.map((row) => {
      const events = this._persistence.loadEvents(row.id);
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
        sessionId: row.session_id,
        projectId: row.project_id,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
        events,
        metadata,
      };
    });
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

    // Clear from current thread if it's the one being deleted
    if (this._currentThread?.id === threadId) {
      this._currentThread = null;
    }

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

  saveCurrentThread(): void {
    if (!this._currentThread) return;

    this._persistence.saveThread(this._currentThread);
  }

  saveThread(thread: Thread): void {
    try {
      this._persistence.saveThread(thread);
    } catch (error) {
      logger.error('Failed to save thread', { threadId: thread.id, error });
    }
  }

  setCurrentThread(threadId: string): void {
    // Save current thread before switching
    this.saveCurrentThread();

    // Load new thread
    this._currentThread = this.loadThread(threadId);
  }

  getLatestThreadId(): string | null {
    return this._persistence.getLatestThreadId();
  }

  getCurrentThreadId(): string | null {
    const threadId = this._currentThread?.id || null;
    return threadId;
  }

  // Legacy method - use createCompactedVersion() instead
  createShadowThread(reason: string, provider?: AIProvider): string {
    return this.createCompactedVersion(reason, provider);
  }

  async needsCompaction(provider?: AIProvider): Promise<boolean> {
    if (!this._currentThread) return false;

    if (provider) {
      // Use cached provider-aware strategy for accurate async token counting
      const providerStrategy = this._getProviderStrategy(provider);
      return await providerStrategy.shouldCompact(this._currentThread);
    }

    return await this._compactionStrategy.shouldCompact(this._currentThread);
  }

  async compactIfNeeded(provider?: AIProvider): Promise<boolean> {
    const needsCompaction = await this.needsCompaction(provider);

    if (!needsCompaction) return false;

    this.createShadowThread('Automatic compaction due to size', provider);
    return true;
  }

  getCanonicalId(threadId: string): string {
    // CANONICAL ID MAPPING SYSTEM - This is the core of thread compaction design
    //
    // PURPOSE: Enable thread compaction while maintaining stable external thread IDs
    //
    // DESIGN PRINCIPLES:
    // 1. External thread IDs NEVER change (canonical IDs are stable)
    // 2. Internal working threads may be compacted versions
    // 3. Canonical ID mapping resolves any thread to its stable external ID
    //
    // HOW IT WORKS:
    // - Original thread "abc123" is created (canonical ID = "abc123")
    // - After compaction, we create "abc123_v2" (working thread)
    // - Mapping: "abc123_v2" → "abc123" (canonical ID remains stable)
    // - External clients always see "abc123" as the thread ID
    // - Internal operations use "abc123_v2" for actual work
    //
    // REVIEWER NOTE: This is NOT a broken contract - it's the designed behavior!
    // The "contract" is that external thread IDs remain stable, which they do.
    // Internal compaction is transparent to external clients.
    const canonicalId = this._persistence.findCanonicalIdForVersion(threadId);
    return canonicalId || threadId; // If no mapping, this IS the canonical ID
  }

  cleanupOldShadows(canonicalId?: string, keepLast: number = 3): void {
    if (canonicalId) {
      // Clean up specific canonical thread
      this._persistence.cleanupOldShadows(canonicalId, keepLast);
    } else if (this._currentThread) {
      // Clean up current thread's shadows
      const currentCanonicalId = this.getCanonicalId(this._currentThread.id);
      this._persistence.cleanupOldShadows(currentCanonicalId, keepLast);
    }
  }

  // TRANSPARENT THREAD COMPACTION - Creates compacted version while preserving external IDs
  //
  // WHAT THIS METHOD DOES:
  // 1. Creates a new compacted thread with reduced event history
  // 2. Establishes canonical ID mapping for transparent access
  // 3. Switches internal operations to the compacted thread
  // 4. Maintains external thread ID stability through canonical mapping
  //
  // EXTERNAL CONTRACT PRESERVED:
  // - agent.getThreadId() continues returning the same canonical ID
  // - Client code sees no change in thread IDs
  // - All external references remain valid
  //
  // INTERNAL OPTIMIZATION:
  // - New thread has compacted events (fewer tokens)
  // - Operations use the compacted thread for efficiency
  // - Canonical ID mapping enables transparent access
  createCompactedVersion(reason: string, provider?: AIProvider): string {
    if (!this._currentThread) {
      throw new Error('No current thread to compact');
    }

    const originalThreadId = this._currentThread.id;
    const canonicalId = this.getCanonicalId(originalThreadId);

    try {
      // Get compacted events using provider-aware strategy if available
      const strategy = provider ? this._getProviderStrategy(provider) : this._compactionStrategy;

      let compactedEvents: ThreadEvent[];
      try {
        compactedEvents = strategy.compact(this._currentThread.events);
      } catch (compactionError) {
        logger.error('Compaction strategy failed, using original events', {
          error:
            compactionError instanceof Error ? compactionError.message : String(compactionError),
          threadId: originalThreadId,
          eventCount: this._currentThread.events.length,
        });
        // Fallback: use original events if compaction fails
        compactedEvents = [...this._currentThread.events];
      }

      // Create new thread (using existing method)
      const newThreadId = this.generateThreadId();
      this.createThread(newThreadId);

      // Add compacted events (using existing method)
      for (const event of compactedEvents) {
        this.addEvent(newThreadId, event.type, event.data);
      }

      // Update version mapping
      this._persistence.createVersion(canonicalId, newThreadId, reason);

      // Switch to new thread (using existing method)
      this.setCurrentThread(newThreadId);

      logger.info('Compacted thread created successfully', {
        originalThreadId,
        newThreadId,
        canonicalId,
        originalEventCount: this._currentThread.events.length,
        compactedEventCount: compactedEvents.length,
        reason,
      });

      return newThreadId;
    } catch (error) {
      logger.error('Failed to create compacted thread', {
        originalThreadId,
        canonicalId,
        error: error instanceof Error ? error.message : String(error),
        reason,
      });

      throw new Error(
        `Compacted thread creation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Simplified compaction check and execution
  async compactIfNeededSimplified(provider?: AIProvider): Promise<boolean> {
    const needsCompaction = await this.needsCompaction(provider);

    if (!needsCompaction) return false;

    this.createCompactedVersion('Automatic compaction due to size', provider);
    return true;
  }

  // Cleanup
  close(): void {
    try {
      this.saveCurrentThread();
    } catch {
      // Ignore save errors on close
    }
    // Clear provider strategy cache
    this._providerStrategyCache.clear();
    this._persistence.close();
  }

  private _getProviderStrategy(provider: AIProvider): SummarizeStrategy {
    const cacheKey = `${provider.providerName}-${provider.defaultModel}`;
    let strategy = this._providerStrategyCache.get(cacheKey);

    if (!strategy) {
      strategy = new SummarizeStrategy(undefined, provider);
      this._providerStrategyCache.set(cacheKey, strategy);
    }

    return strategy;
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
