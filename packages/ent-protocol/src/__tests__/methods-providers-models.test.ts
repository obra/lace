import { describe, expect, it } from 'vitest';
import {
  EntProvidersRefreshRequestSchema,
  EntModelsListResponseSchema,
  EntModelsEnableRequestSchema,
  EntModelsDisableRequestSchema,
  EntProvidersCatalogRequestSchema,
  EntProvidersCatalogResponseSchema,
  EntProvidersRefreshResponseSchema,
  EntModelsEnableResponseSchema,
} from '../schemas/methods';

const baseRequest = { jsonrpc: '2.0', id: 1 } as const;

describe('Ent protocol provider/model management schemas', () => {
  it('accepts ent/providers/refresh with and without providerId', () => {
    expect(() =>
      EntProvidersRefreshRequestSchema.parse({
        ...baseRequest,
        method: 'ent/providers/refresh',
        params: { providerId: 'openai' },
      })
    ).not.toThrow();

    expect(() =>
      EntProvidersRefreshRequestSchema.parse({
        ...baseRequest,
        method: 'ent/providers/refresh',
      })
    ).not.toThrow();
  });

  it('validates ent/models/enable params', () => {
    expect(() =>
      EntModelsEnableRequestSchema.parse({
        ...baseRequest,
        method: 'ent/models/enable',
        params: { providerId: 'openai', modelIds: ['gpt-4o'] },
      })
    ).not.toThrow();

    expect(() =>
      EntModelsEnableRequestSchema.parse({
        ...baseRequest,
        method: 'ent/models/enable',
        params: { providerId: '', modelIds: [] },
      })
    ).toThrow();
  });

  it('validates ent/models/disable params', () => {
    expect(() =>
      EntModelsDisableRequestSchema.parse({
        ...baseRequest,
        method: 'ent/models/disable',
        params: { providerId: 'anthropic', modelIds: ['claude-3-opus'] },
      })
    ).not.toThrow();
  });

  it('accepts response shapes', () => {
    expect(() =>
      EntProvidersRefreshResponseSchema.parse({
        ...baseRequest,
        result: { ok: true, refreshedAt: new Date().toISOString() },
      })
    ).not.toThrow();

    expect(() =>
      EntModelsListResponseSchema.parse({
        ...baseRequest,
        result: {
          providerId: 'openai',
          connectionId: 'conn_123',
          models: [
            {
              modelId: 'gpt-4o',
              name: 'GPT-4o',
              providerId: 'openai',
              contextWindow: 128000,
              maxOutput: 16384,
              disabled: true,
              disabledState: 'disabled',
            },
          ],
        },
      })
    ).not.toThrow();

    expect(() =>
      EntModelsEnableResponseSchema.parse({
        ...baseRequest,
        result: {
          providerId: 'openai',
          enabled: ['gpt-4o'],
          disabled: ['gpt-3.5-turbo'],
        },
      })
    ).not.toThrow();
  });

  it('accepts ent/providers/catalog request and response shapes', () => {
    expect(() =>
      EntProvidersCatalogRequestSchema.parse({
        ...baseRequest,
        method: 'ent/providers/catalog',
      })
    ).not.toThrow();

    expect(() =>
      EntProvidersCatalogResponseSchema.parse({
        ...baseRequest,
        result: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              type: 'openai',
              default_large_model_id: 'gpt-4o',
              default_small_model_id: 'gpt-4o-mini',
              models: [
                {
                  id: 'gpt-4o',
                  name: 'GPT-4o',
                  context_window: 128000,
                  default_max_tokens: 16384,
                  cost_per_1m_in: 0,
                  cost_per_1m_out: 0,
                },
              ],
            },
          ],
        },
      })
    ).not.toThrow();
  });
});
