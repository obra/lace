// ABOUTME: Enhanced thread management with SQLite persistence support
// ABOUTME: Maintains backward compatibility with immediate event persistence

import { EventEmitter } from 'events';
import { ThreadPersistence } from './persistence.js';
import { Thread, ThreadEvent, EventType } from './types.js';
import { ToolCall, ToolResult } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import { SummarizeStrategy } from './compaction/index.js';

export interface ThreadSessionInfo {
  threadId: string;
  isResumed: boolean;
  resumeError?: string;
}

export class ThreadManager extends EventEmitter {
  private _currentThread: Thread | null = null;
  private _persistence: ThreadPersistence;
  private _compactionStrategy: SummarizeStrategy;

  constructor(dbPath: string) {
    super();
    this._persistence = new ThreadPersistence(dbPath);
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

  async resumeOrCreate(threadId?: string): Promise<ThreadSessionInfo> {
    if (threadId) {
      try {
        await this.setCurrentThread(threadId);
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
      console.error('Failed to save delegate thread:', error);
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
      console.error('Failed to save event:', error);
    }

    // Emit thread_updated event for UI to sync
    this.emit('thread_updated', { threadId, eventType: type });

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
    const delegateThreads = this.getDelegateThreadsFor(mainThreadId);
    for (const delegateThreadId of delegateThreads) {
      const delegateEvents = this._persistence.loadEvents(delegateThreadId);
      allEvents.push(...delegateEvents);
    }

    // Sort chronologically across all threads
    return allEvents.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private getDelegateThreadsFor(mainThreadId: string): string[] {
    // Use the persistence layer's SQL-based filtering instead
    return this._persistence.getDelegateThreadsFor(mainThreadId);
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
    // Rough approximation: 1 token ≈ 4 characters for English text
    // This is a commonly used heuristic, though actual tokenization varies by model
    return Math.ceil(text.length / 4);
  }

  clearEvents(threadId: string): void {
    const thread = this.getThread(threadId);
    if (thread) {
      thread.events.length = 0; // Clear the events array to free memory
    }
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
    const threadId = this._currentThread?.id || null;
    return threadId;
  }

  async createShadowThread(reason: string): Promise<string> {
    if (!this._currentThread) {
      throw new Error('No current thread to create shadow for');
    }

    const currentThreadId = this._currentThread.id;
    const canonicalId = this.getCanonicalId(currentThreadId);
    
    // Generate new shadow thread ID
    const shadowThreadId = this.generateThreadId();
    
    // Compact the events using the compaction strategy
    const compactedEvents = this._compactionStrategy.compact(this._currentThread.events);
    
    // Update thread IDs in compacted events
    const updatedEvents = compactedEvents.map(event => ({
      ...event,
      threadId: shadowThreadId,
    }));
    
    // Create shadow thread with compacted events
    const shadowThread: Thread = {
      id: shadowThreadId,
      createdAt: this._currentThread.createdAt,
      updatedAt: new Date(),
      events: updatedEvents,
    };

    // Save shadow thread
    this._persistence.saveThread(shadowThread);
    
    // Save each compacted event
    for (const event of updatedEvents) {
      this._persistence.saveEvent(event);
    }
    
    // Create version mapping
    this._persistence.createVersion(canonicalId, shadowThreadId, reason);
    
    // Switch to shadow thread
    this._currentThread = shadowThread;
    
    logger.info('Shadow thread created with compaction', {
      originalThreadId: currentThreadId,
      shadowThreadId,
      canonicalId,
      originalEventCount: this._currentThread.events.length,
      compactedEventCount: updatedEvents.length,
      reason,
    });
    
    return shadowThreadId;
  }

  needsCompaction(): boolean {
    if (!this._currentThread) return false;
    return this._compactionStrategy.shouldCompact(this._currentThread);
  }

  async compactIfNeeded(): Promise<boolean> {
    if (!this.needsCompaction()) return false;
    
    await this.createShadowThread('Automatic compaction due to size');
    return true;
  }

  getCanonicalId(threadId: string): string {
    // First check if this threadId is a canonical ID with a current version
    const currentVersion = this._persistence.getCurrentVersion(threadId);
    if (currentVersion) {
      // This thread is already a canonical ID
      return threadId;
    }
    
    // Check if this thread is itself a version of something else
    const canonicalId = this._persistence.findCanonicalIdForVersion(threadId);
    if (canonicalId) {
      return canonicalId;
    }
    
    // If no version mapping exists, this thread IS the canonical ID
    return threadId;
  }

  // Cleanup
  async close(): Promise<void> {
    try {
      await this.saveCurrentThread();
    } catch {
      // Ignore save errors on close
    }
    await this._persistence.close();
  }
}

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
