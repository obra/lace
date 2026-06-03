// ABOUTME: Core interfaces for the compaction system
// ABOUTME: Defines context type for track-based conversation compaction

import type {
  AIProvider,
  ProviderMessage,
  ProviderResponse,
} from '@lace/agent/providers/base-provider';
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';

export interface CompactionAgent {
  generateSummary(summaryRequest: string): Promise<string>;
}

/**
 * Context information provided to compaction functions
 */
export interface CompactionContext {
  /** The ID of the thread being compacted */
  threadId: string;
  /** Filesystem path to the session directory — present so later resolveModel/guidance steps
   *  don't need to re-touch the call sites. */
  sessionDir: string;
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
  /**
   * One-shot LLM query bound by the call site to the session connection.
   * The binder converts {prompt, system} → messages and defaults `model` to
   * the session modelId. Strategies that don't need an LLM ignore it.
   */
  query?: (opts: {
    messages?: ProviderMessage[];
    prompt?: string;
    model?: string;
    system?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; usage?: ProviderResponse['usage'] }>;
}

export type CompactResult =
  | {
      compactionEvent: {
        type: 'context_compacted';
        data: ContextCompactedEventData;
      };
    }
  | { noop: true };

export interface CompactionStrategy {
  name: string;
  compact(events: TypedDurableEvent[], ctx: CompactionContext): Promise<CompactResult>;
}
