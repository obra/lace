// ABOUTME: Tests resolveContextWindow — the manual-compaction path's answer to
// ABOUTME: "how big is this model's window", which decides how much history a
// ABOUTME: compaction keeps. Getting it wrong is silent: too small a number just
// ABOUTME: throws away more of the conversation than it needed to.

import { describe, it, expect, vi } from 'vitest';
import { resolveContextWindow } from '../context-window';
import { AIProvider, type ModelInfo } from '@lace/agent/providers/base-provider';

/**
 * Provider whose catalog knows a 1M model under a dated id, so a bare alias has
 * to be resolved to reach it — the shape that made the real bug.
 */
class CatalogProvider extends AIProvider {
  constructor(private readonly models: ModelInfo[]) {
    super();
  }
  get providerName(): string {
    return 'catalog-test';
  }
  getProviderInfo() {
    return { name: 'catalog-test', displayName: 'Catalog Test', requiresApiKey: false };
  }
  isConfigured(): boolean {
    return true;
  }
  override getAvailableModels(): ModelInfo[] {
    return this.models;
  }
  protected async _createResponseImpl() {
    throw new Error('not used');
  }
  protected async _createStreamingResponseImpl() {
    throw new Error('not used');
  }
}

const model = (id: string, contextWindow: number): ModelInfo => ({
  id,
  displayName: id,
  contextWindow,
  maxOutputTokens: 8192,
});

const MODELS = [model('claude-opus-4-5-20251101', 200_000), model('claude-opus-5', 1_000_000)];

function factoryFor(provider: AIProvider) {
  return vi.fn().mockResolvedValue(provider);
}

describe('resolveContextWindow', () => {
  it('returns the window of an exactly-named model', async () => {
    const createProviderForTurn = factoryFor(new CatalogProvider(MODELS));
    const window = await resolveContextWindow(
      { connectionId: 'conn', modelId: 'claude-opus-5' },
      { createProviderForTurn }
    );
    expect(window).toBe(1_000_000);
  });

  it('resolves a bare alias before looking the window up', async () => {
    // The bug this exists to prevent: the factory resolves 'haiku' internally but
    // never hands back what it resolved to, and the catalog lookup is an exact
    // match — so an unresolved alias found nothing and fell through to a 200K
    // default, silently sizing the tail for the wrong model.
    //
    // The window here is deliberately not 200K and not 1M, so neither the old
    // default nor a lucky guess can produce it: only actually resolving the
    // alias reaches this number.
    const createProviderForTurn = factoryFor(
      new CatalogProvider([model('claude-haiku-4-5-20251001', 512_000)])
    );
    const window = await resolveContextWindow(
      { connectionId: 'conn', modelId: 'haiku' },
      { createProviderForTurn }
    );
    expect(window).toBe(512_000);
  });

  it('resolves an alias to the same model the turn factory would build', async () => {
    // Whatever this returns has to describe the model the NEXT REQUEST will use,
    // not merely some model matching the alias — otherwise the budget is sized
    // against a window the session never had. resolveModelAlias ranks by the
    // date embedded in the id, so an undated id loses to a dated one; agreeing
    // with that is the contract, even where the ranking is surprising.
    const createProviderForTurn = factoryFor(new CatalogProvider(MODELS));
    const window = await resolveContextWindow(
      { connectionId: 'conn', modelId: 'opus' },
      { createProviderForTurn }
    );
    expect(window).toBe(200_000); // claude-opus-4-5-20251101 outranks claude-opus-5
  });

  it('says it does not know rather than reporting a default as fact', async () => {
    // A model absent from the catalog must not come back as 200K — the caller
    // applies its own conservative assumption, and a wrong confident number is
    // worse than an admitted absence.
    const createProviderForTurn = factoryFor(new CatalogProvider(MODELS));
    const window = await resolveContextWindow(
      { connectionId: 'conn', modelId: 'some-model-we-never-shipped' },
      { createProviderForTurn }
    );
    expect(window).toBeUndefined();
  });

  it('returns undefined without a connection or model to resolve from', async () => {
    const createProviderForTurn = factoryFor(new CatalogProvider(MODELS));
    expect(
      await resolveContextWindow(
        { connectionId: undefined, modelId: 'claude-opus-5' },
        {
          createProviderForTurn,
        }
      )
    ).toBeUndefined();
    expect(
      await resolveContextWindow(
        { connectionId: 'conn', modelId: undefined },
        {
          createProviderForTurn,
        }
      )
    ).toBeUndefined();
    // No provider is built when there is nothing to build one from.
    expect(createProviderForTurn).not.toHaveBeenCalled();
  });

  it('survives a provider that cannot be created', async () => {
    // Missing credentials or an unknown instance must degrade a compaction, not
    // fail it — the compaction is still worth running on an assumed window.
    const createProviderForTurn = vi.fn().mockRejectedValue(new Error('no such instance'));
    const window = await resolveContextWindow(
      { connectionId: 'conn', modelId: 'claude-opus-5' },
      { createProviderForTurn }
    );
    expect(window).toBeUndefined();
  });

  it('always cleans the provider up, on both the success and failure paths', async () => {
    // It owns the provider's whole lifecycle like oneShotQuery does; leaking one
    // per manual compaction would leak an SDK client per /compact.
    const provider = new CatalogProvider(MODELS);
    const cleanup = vi.fn().mockResolvedValue(undefined);
    (provider as unknown as { cleanup: () => Promise<void> }).cleanup = cleanup;

    await resolveContextWindow(
      { connectionId: 'conn', modelId: 'claude-opus-5' },
      { createProviderForTurn: factoryFor(provider) }
    );
    expect(cleanup).toHaveBeenCalledTimes(1);

    const exploding = new CatalogProvider(MODELS);
    (exploding as unknown as { getAvailableModels: () => never }).getAvailableModels = () => {
      throw new Error('catalog blew up');
    };
    const cleanup2 = vi.fn().mockResolvedValue(undefined);
    (exploding as unknown as { cleanup: () => Promise<void> }).cleanup = cleanup2;

    expect(
      await resolveContextWindow(
        { connectionId: 'conn', modelId: 'claude-opus-5' },
        { createProviderForTurn: factoryFor(exploding) }
      )
    ).toBeUndefined();
    expect(cleanup2).toHaveBeenCalledTimes(1);
  });
});
