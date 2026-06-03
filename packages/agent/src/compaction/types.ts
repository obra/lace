// ABOUTME: Core interfaces for the compaction system
// ABOUTME: Defines context type for track-based conversation compaction

import type { ProviderMessage, ProviderResponse } from '@lace/agent/providers/base-provider';
import type { TypedDurableEvent, ContextCompactedEventData } from '@lace/agent/storage/event-types';

/**
 * Context information provided to compaction functions.
 * The kernel default (track-based) is domain-neutral and deterministic — no model
 * access. Custom strategies may use ctx.query for LLM calls.
 */
export interface CompactionContext {
  /** The ID of the thread being compacted */
  threadId: string;
  /** Filesystem path to the session directory */
  sessionDir?: string;
  /**
   * One-shot LLM query bound by the call site to the session connection.
   * The binder converts {prompt} → messages and defaults `model` to
   * the session modelId. Strategies that don't need an LLM ignore it.
   * Absent when connectionId or modelId is unavailable at the call site.
   */
  query?: (opts: {
    messages?: ProviderMessage[];
    prompt?: string;
    model?: string;
    signal?: AbortSignal;
  }) => Promise<{ text: string; usage?: ProviderResponse['usage'] }>;
  /**
   * Free-text steering hint forwarded from the compact caller:
   * - compact_session / ent.session.compact passes the request's `guidance` field
   * - /compact passes the remainder of the command line
   * - auto-fired (runner post-turn) leaves this absent
   * Built-in strategies (track-based) ignore it; custom strategies may use it.
   */
  guidance?: string;
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
