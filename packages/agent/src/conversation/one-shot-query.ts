// ABOUTME: Kernel primitive for one-shot LLM queries with owned provider lifecycle
// ABOUTME: Creates a provider, streams one response, and always cleans up (success or error)

import type { ProviderMessage, ProviderResponse } from '@lace/agent/providers/base-provider';
import { createProviderForTurn as defaultCreateProviderForTurn } from '@lace/agent/providers/turn-factory';

type CreateProviderForTurn = typeof defaultCreateProviderForTurn;

/**
 * Execute a single LLM request against a chosen model, owning the provider
 * lifecycle entirely. The provider is created, used, and cleaned up in one
 * call — callers never hold a provider reference.
 *
 * Uses the STREAMING provider path. A non-streaming request whose `max_tokens`
 * exceeds the provider's non-streaming ceiling is rejected with a non-retryable
 * 400 ("Streaming is required for operations that may take longer than 10
 * minutes."). One-shot callers pick arbitrary models (e.g. compaction summarize
 * on haiku, whose default max output is large), so streaming is mandatory.
 *
 * @param opts.connectionId - Provider connection identifier
 * @param opts.model - Model identifier passed through to createStreamingResponse
 * @param opts.messages - Conversation messages to send
 * @param opts.signal - Optional AbortSignal (forwarded to createStreamingResponse)
 * @param deps.createProviderForTurn - Injectable factory (defaults to the real import; override in tests)
 */
export async function oneShotQuery(
  opts: {
    connectionId: string;
    model: string;
    messages: ProviderMessage[];
    signal?: AbortSignal;
  },
  deps?: { createProviderForTurn?: CreateProviderForTurn }
): Promise<{ text: string; usage?: ProviderResponse['usage'] }> {
  const factory = deps?.createProviderForTurn ?? defaultCreateProviderForTurn;
  const provider = await factory({ connectionId: opts.connectionId, modelId: opts.model });
  try {
    const r = await provider.createStreamingResponse(opts.messages, [], opts.model, opts.signal);
    return { text: r.content, usage: r.usage };
  } finally {
    await provider.cleanup?.();
  }
}
