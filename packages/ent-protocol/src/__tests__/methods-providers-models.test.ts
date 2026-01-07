import { describe, expect, it } from 'vitest';
import {
  EntProvidersRefreshRequestSchema,
  EntModelsEnableRequestSchema,
  EntModelsDisableRequestSchema,
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
});
