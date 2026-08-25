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
   * Reference 'now' (ISO) for recency/staleness — injectable for deterministic
   * compaction; defaults to wall-clock now.
   */
  readonly referenceTimestamp?: string;
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
   * Context window (in tokens) of the model this session runs on, when the
   * call site can resolve it. Strategies size the history they preserve
   * against it: a tail larger than the window leaves the session over the
   * limit the moment compaction finishes, which is the wedge PRI-2906
   * describes. Absent when the caller holds no provider; strategies then
   * assume the provider's own conservative fallback.
   */
  readonly contextWindow?: number;
  /**
   * What the provider reported the session's context actually cost on its most
   * recent API call — the whole input: system prompt, tool schemas, images,
   * history. The number the compaction TRIGGER already computes pressure from.
   *
   * Strategies size their verbatim tail against a local `chars/4` estimate over
   * durable event text, which sees none of that and under-reads real coworker
   * content by an order of magnitude. Handed the same measurement the trigger
   * used, a strategy can calibrate that estimate instead of arguing with the
   * model about how full its own window is (PRI-2947).
   *
   * Absent — never zero — when nobody reported one: a first turn, a legacy
   * transcript, a provider with no usage accounting. A zero would read as "the
   * context is empty" and would suppress compaction for the life of the
   * session. Absent means "we were told nothing", and a strategy handed nothing
   * must fall back to its own estimate rather than to an implied number.
   *
   * Absolute tokens rather than a pressure ratio: `contextWindow` rides
   * alongside, so a strategy that wants the ratio can divide, while the tail
   * budget it is compared against is denominated in tokens.
   */
  readonly measuredContextTokens?: number;
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
