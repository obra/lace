// ABOUTME: Core interfaces for the compaction event system
// ABOUTME: Defines strategy pattern and event types for conversation compaction

import type { LaceEvent } from '~/threads/types';
import type { AIProvider } from '~/providers/base-provider';
import type { ToolExecutor } from '~/tools/executor';
import type { Agent } from '~/agents/agent';

/**
 * Data structure stored in COMPACTION events
 *
 * This contains the compaction results and metadata about the compaction process.
 */
export interface CompactionData {
  /** The ID of the strategy that performed this compaction */
  strategyId: string;
  /** Number of original events that were replaced by this compaction */
  originalEventCount: number;
  /** The replacement events that represent the compacted conversation */
  compactedEvents: LaceEvent[];
  /** Optional strategy-specific metadata about the compaction process */
  metadata?: Record<string, unknown>;
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
   * @returns A LaceEvent with type 'COMPACTION' containing CompactionData
   */
  compact(events: LaceEvent[], context: CompactionContext): Promise<LaceEvent>;
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
