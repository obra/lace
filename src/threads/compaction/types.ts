// ABOUTME: Type definitions for thread compaction strategies
// ABOUTME: Defines interface for analyzing and compacting thread events

import { Thread, ThreadEvent } from '../types.js';

export interface CompactionStrategy {
  // Analyze thread and determine if compaction needed (async for provider-aware token counting)
  shouldCompact(thread: Thread): Promise<boolean>;

  // Create compacted version of events
  compact(events: ThreadEvent[]): ThreadEvent[];
}

export interface CompactionConfig {
  maxTokens?: number;
  preserveRecentEvents?: number;
  preserveTaskEvents?: boolean;
}
