// ABOUTME: Type definitions for thread compaction strategies
// ABOUTME: Defines interface for analyzing and compacting thread events

import { Thread, ThreadEvent } from '../types.js';

export interface CompactionStrategy {
  // Analyze thread and determine if compaction needed
  shouldCompact(thread: Thread): boolean;
  
  // Create compacted version of events
  compact(events: ThreadEvent[]): ThreadEvent[];
}

export interface CompactionConfig {
  maxTokens?: number;
  preserveRecentEvents?: number;
  preserveTaskEvents?: boolean;
}