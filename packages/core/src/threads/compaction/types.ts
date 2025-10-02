// ABOUTME: Core interfaces for the compaction event system
// ABOUTME: Defines strategy pattern and event types for conversation compaction

import type { LaceEvent } from '~/threads/types';
import type { AIProvider } from '~/providers/base-provider';
import type { ToolExecutor } from '~/tools/executor';
import type { Agent } from '~/agents/agent';

/**
 * Data structure stored in COMPACTION events
 *
 * This contains metadata about the compaction process. Compacted events are
 * now stored as first-class database rows with visibleToModel flags, not
 * nested inside this data structure.
 */
export interface CompactionData {
  /** The ID of the strategy that performed this compaction */
  strategyId: string;
  /** Number of original events that were replaced by this compaction */
  originalEventCount: number;
  /** Number of events created by the compaction (stored separately as real events) */
  compactedEventCount: number;
  /** Optional strategy-specific metadata about the compaction process */
  metadata?: Record<string, unknown>;
}

/**
 * Result returned by compaction strategies
 *
 * Strategies now return both the COMPACTION metadata event and the actual
 * replacement events that will be persisted as separate database rows.
 */
export interface CompactionResult {
  /** The COMPACTION event containing metadata about the compaction */
  compactionEvent: LaceEvent;
  /** The replacement events to be persisted as first-class database rows */
  compactedEvents: LaceEvent[];
}

/**
 * Interface for compaction strategies that reduce conversation size
 *
 * Compaction strategies implement different approaches to reducing the size
 * of conversation histories while preserving essential information.
 */
export interface CompactionStrategy {
  /** Unique identifier for this strategy */
  id: string;

  /**
   * Compact a sequence of events into a more efficient representation
   *
   * @param events - The events to compact (all events before the compaction point)
   * @param context - Additional context for the compaction process
   * @returns CompactionResult with metadata event and replacement events
   */
  compact(events: LaceEvent[], context: CompactionContext): Promise<CompactionResult>;
}

/**
 * Context information provided to compaction strategies
 */
export interface CompactionContext {
  /** The ID of the thread being compacted */
  threadId: string;
  /** Optional AI provider for strategies that need AI assistance (deprecated - use agent instead) */
  provider?: AIProvider;
  /** Optional Agent instance for in-conversation summarization */
  agent?: Agent;
  /** Optional tool executor for strategies that need to use tools */
  toolExecutor?: ToolExecutor;
}
