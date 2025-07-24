// ABOUTME: Core interfaces for the compaction event system
// ABOUTME: Defines strategy pattern and event types for conversation compaction

import type { ThreadEvent } from '~/threads/types';
import type { AIProvider } from '~/providers/base-provider';
import type { ToolExecutor } from '~/tools/executor';

export interface CompactionData {
  strategyId: string;
  originalEventCount: number;
  compactedEvents: ThreadEvent[];
  metadata?: Record<string, unknown>;
}

// CompactionEvent is just a regular ThreadEvent with COMPACTION type and CompactionData

export interface CompactionStrategy {
  id: string;
  compact(events: ThreadEvent[], context: CompactionContext): Promise<ThreadEvent>;
}

export interface CompactionContext {
  threadId: string;
  provider?: AIProvider;
  toolExecutor?: ToolExecutor;
}
