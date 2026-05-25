// ABOUTME: Core interfaces for the compaction system
// ABOUTME: Defines context type for track-based conversation compaction

import type { AIProvider } from '@lace/agent/providers/base-provider';
import type { ToolExecutor } from '@lace/agent/tools/executor';

export interface CompactionAgent {
  generateSummary(summaryRequest: string, events: unknown[]): Promise<string>;
}

/**
 * Context information provided to compaction functions
 */
export interface CompactionContext {
  /** The ID of the thread being compacted */
  threadId: string;
  /** Optional AI provider for large-track summarization */
  provider?: AIProvider;
  /** Optional Agent instance for in-conversation summarization */
  agent?: CompactionAgent;
  /** Optional tool executor for strategies that need to use tools */
  toolExecutor?: ToolExecutor;
}
