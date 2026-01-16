// ABOUTME: Tests for Anthropic dynamic provider catalog filtering
// ABOUTME: Validates model discovery, caching, and fallback behavior

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicDynamicProvider } from '../dynamic-provider';
import type { CatalogProvider } from '../../catalog/types';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  };
});

// Mock lace-dir config
vi.mock('@lace/agent/config/lace-dir', () => ({
  getLaceDir: () => '/tmp/lace-test',
}));

describe('AnthropicDynamicProvider', () => {
  const mockApiKey = 'test-api-key';

  const staticCatalog: CatalogProvider = {
    name: 'Anthropic',
    id: 'anthropic',
    type: 'anthropic',
    api_key: '$ANTHROPIC_API_KEY',
    default_large_model_id: 'claude-sonnet-4-20250514',
    default_small_model_id: 'claude-3-5-haiku-20241022',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        cost_per_1m_in: 3,
        cost_per_1m_out: 15,
        context_window: 200000,
        default_max_tokens: 50000,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        name: 'Claude 3.5 Haiku',
        cost_per_1m_in: 0.8,
        cost_per_1m_out: 4,
        context_window: 200000,
        default_max_tokens: 5000,
      },
      {
        id: 'claude-opus-4-20250514',
        name: 'Claude Opus 4',
        cost_per_1m_in: 15,
        cost_per_1m_out: 75,
        context_window: 200000,
        default_max_tokens: 32000,
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: cache miss
    vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.promises.writeFile).mockResolvedValue();
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getCatalog', () => {
    it('filters static catalog to only include available models from API', async () => {
      // API returns only 2 of the 3 models
      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
          {
            id: 'claude-3-5-haiku-20241022',
            type: 'model',
            display_name: 'Claude 3.5 Haiku',
            created_at: '2024-10-22T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-3-5-haiku-20241022',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      // Should only have 2 models (opus not in API response)
      expect(result.models).toHaveLength(2);
      expect(result.models.map((m) => m.id)).toContain('claude-sonnet-4-20250514');
      expect(result.models.map((m) => m.id)).toContain('claude-3-5-haiku-20241022');
      expect(result.models.map((m) => m.id)).not.toContain('claude-opus-4-20250514');
    });

    it('preserves rich metadata from static catalog', async () => {
      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-sonnet-4-20250514',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      const model = result.models.find((m) => m.id === 'claude-sonnet-4-20250514');
      expect(model).toBeDefined();
      expect(model?.cost_per_1m_in).toBe(3);
      expect(model?.cost_per_1m_out).toBe(15);
      expect(model?.context_window).toBe(200000);
    });

    it('includes new models from API not in static catalog', async () => {
      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
          {
            id: 'claude-5-opus-20260101',
            type: 'model',
            display_name: 'Claude 5 Opus',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-5-opus-20260101',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      expect(result.models).toHaveLength(2);
      const newModel = result.models.find((m) => m.id === 'claude-5-opus-20260101');
      expect(newModel).toBeDefined();
      // New model uses display_name from API
      expect(newModel?.name).toBe('Claude 5 Opus');
      // New model gets conservative defaults
      expect(newModel?.context_window).toBe(200000);
    });

    it('uses cached catalog when fresh', async () => {
      const cachedProvider: CatalogProvider = {
        ...staticCatalog,
        models: [staticCatalog.models[0]],
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({
          _meta: {
            fetchedAt: new Date().toISOString(), // Fresh cache
            version: '1.0',
            availableModelCount: 1,
            source: 'https://api.anthropic.com/v1/models',
          },
          provider: cachedProvider,
        })
      );

      const fetchSpy = vi.spyOn(global, 'fetch');

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      // Should use cache, not fetch
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.models).toHaveLength(1);
    });

    it('fetches fresh when cache is stale', async () => {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 2); // 2 days ago

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({
          _meta: {
            fetchedAt: staleDate.toISOString(),
            version: '1.0',
            availableModelCount: 1,
            source: 'https://api.anthropic.com/v1/models',
          },
          provider: { ...staticCatalog, models: [] },
        })
      );

      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-sonnet-4-20250514',
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      // Should fetch fresh data
      expect(fetchSpy).toHaveBeenCalled();
      expect(result.models).toHaveLength(1);
    });

    it('falls back to static catalog on API error', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      // Should return full static catalog as fallback
      expect(result.models).toHaveLength(3);
    });

    it('falls back to stale cache before static catalog on API error', async () => {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - 2);

      const cachedProvider: CatalogProvider = {
        ...staticCatalog,
        models: [staticCatalog.models[0]], // Only 1 model
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({
          _meta: {
            fetchedAt: staleDate.toISOString(),
            version: '1.0',
            availableModelCount: 1,
            source: 'https://api.anthropic.com/v1/models',
          },
          provider: cachedProvider,
        })
      );

      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog);

      // Should return stale cache (1 model) not full static (3 models)
      expect(result.models).toHaveLength(1);
    });

    it('saves fetched catalog to cache', async () => {
      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-sonnet-4-20250514',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      await provider.getCatalog(mockApiKey, staticCatalog);

      expect(fs.promises.mkdir).toHaveBeenCalled();
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('anthropic-test-instance.json'),
        expect.any(String)
      );
    });

    it('forces refresh when requested', async () => {
      const cachedProvider: CatalogProvider = {
        ...staticCatalog,
        models: [],
      };

      vi.mocked(fs.promises.readFile).mockResolvedValue(
        JSON.stringify({
          _meta: {
            fetchedAt: new Date().toISOString(), // Fresh cache
            version: '1.0',
            availableModelCount: 0,
            source: 'https://api.anthropic.com/v1/models',
          },
          provider: cachedProvider,
        })
      );

      const apiResponse = {
        data: [
          {
            id: 'claude-sonnet-4-20250514',
            type: 'model',
            display_name: 'Claude Sonnet 4',
            created_at: '2025-05-14T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'claude-sonnet-4-20250514',
        last_id: 'claude-sonnet-4-20250514',
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(apiResponse),
      } as Response);

      const provider = new AnthropicDynamicProvider('test-instance');
      const result = await provider.getCatalog(mockApiKey, staticCatalog, true);

      // Should fetch despite fresh cache
      expect(fetchSpy).toHaveBeenCalled();
      expect(result.models).toHaveLength(1);
    });
  });
});
