// ABOUTME: Kernel primitive for one-shot LLM queries with owned provider lifecycle
// ABOUTME: Creates a provider, calls createResponse, and always cleans up (success or error)

import type { ProviderMessage, ProviderResponse } from '@lace/agent/providers/base-provider';
import { createProviderForTurn as defaultCreateProviderForTurn } from '@lace/agent/providers/turn-factory';

type CreateProviderForTurn = typeof defaultCreateProviderForTurn;

/**
 * Execute a single LLM request against a chosen model, owning the provider
 * lifecycle entirely. The provider is created, used, and cleaned up in one
 * call — callers never hold a provider reference.
 *
 * @param opts.connectionId - Provider connection identifier
 * @param opts.model - Model identifier passed through to createResponse
 * @param opts.messages - Conversation messages to send
 * @param opts.signal - Optional AbortSignal (forwarded to createResponse when supported)
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
    const r = await provider.createResponse(opts.messages, [], opts.model, opts.signal);
    return { text: r.content, usage: r.usage };
  } finally {
    await provider.cleanup?.();
  }
}
