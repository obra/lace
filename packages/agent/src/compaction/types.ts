// ABOUTME: Core interfaces for the compaction system
// ABOUTME: Defines context type for track-based conversation compaction

import type { AIProvider } from '@lace/agent/providers/base-provider';

export interface CompactionAgent {
  generateSummary(summaryRequest: string): Promise<string>;
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
  /**
   * Provider's model id to use when an LLM fallback is needed (oversize tracks).
   * When omitted, the LLM fallback path is skipped — only the deterministic
   * block is returned.
   */
  modelId?: string;
}
