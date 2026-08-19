// ABOUTME: Resolves the running model's context window for compaction call sites
// ABOUTME: that hold a connection + model id but no live provider reference.

import type { AIProvider } from '@lace/agent/providers/base-provider';
import { createProviderForTurn as defaultCreateProviderForTurn } from '@lace/agent/providers/turn-factory';
import { logger } from '@lace/agent/utils/logger';

type CreateProviderForTurn = typeof defaultCreateProviderForTurn;

/**
 * The context window compaction should size its preserved tail against.
 *
 * The runner already holds a live provider and reads this directly. The manual
 * compaction paths (`ent/session/compact`, `/compact`) hold only a connection
 * and a model id, so they resolve it here — through the SAME factory the turn
 * itself uses, so the number is the one the next request will actually be
 * measured against. Reading it out of the static catalog instead would diverge
 * for any model whose window a dynamic catalog synthesizes.
 *
 * Owns the provider's whole lifecycle, like `oneShotQuery`: callers never hold
 * a reference. Returns undefined rather than throwing — a compaction is worth
 * running on an assumed window, and is not worth failing over a lookup.
 */
export async function resolveContextWindow(
  opts: { connectionId?: string; modelId?: string },
  deps?: { createProviderForTurn?: CreateProviderForTurn }
): Promise<number | undefined> {
  if (!opts.connectionId || !opts.modelId) return undefined;

  const factory = deps?.createProviderForTurn ?? defaultCreateProviderForTurn;
  let provider: AIProvider | undefined;
  try {
    provider = await factory({ connectionId: opts.connectionId, modelId: opts.modelId });
    return provider.contextWindowForModel(opts.modelId);
  } catch (err) {
    logger.warn('compaction: could not resolve the model context window', {
      connectionId: opts.connectionId,
      modelId: opts.modelId,
      err: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  } finally {
    await provider?.cleanup?.();
  }
}
