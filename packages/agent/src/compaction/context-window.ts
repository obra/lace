// ABOUTME: Resolves the running model's context window for compaction call sites
// ABOUTME: that hold a connection + model id but no live provider reference.

import type { AIProvider } from '@lace/agent/providers/base-provider';
import { createProviderForTurn as defaultCreateProviderForTurn } from '@lace/agent/providers/turn-factory';
import { resolveModelAlias } from '@lace/agent/providers/catalog/alias-resolver';
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
    // Resolve the id the same way the factory did before looking it up. The
    // factory resolves a bare alias ('opus', 'sonnet') internally but does not
    // hand the resolved id back, and `contextWindowForModel` does an exact match
    // — so passing the alias straight through misses every catalog entry and
    // silently returns the 200K default. On a 1M model that would cut the
    // preserved tail to a fraction of what fits, which is the regression this
    // whole plumbing exists to avoid.
    const models = provider.getAvailableModels();
    const resolvedId = resolveModelAlias(opts.modelId, models);
    const model = models.find((m) => m.id === resolvedId);
    if (!model) {
      // Better to say "I don't know" than to report a default as if it were
      // this model's real window.
      logger.warn('compaction: model is absent from the provider catalog', {
        modelId: opts.modelId,
        resolvedId,
      });
      return undefined;
    }
    return model.contextWindow;
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
