import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenRouterDynamicProvider } from './dynamic-provider';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

describe('OpenRouter Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-test-'));
    process.env.LACE_DIR = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true });
    delete process.env.LACE_DIR;
  });

  it('should handle full refresh cycle with mock data', async () => {
    // Mock implementation for testing without API key
    const mockResponse = {
      data: Array.from({ length: 150 }, (_, i) => ({
        id: `provider-${i % 10}/model-${i}`,
        name: `Model ${i}`,
        context_length: 4096 * ((i % 10) + 1),
        pricing: {
          prompt: (0.001 * ((i % 5) + 1)).toString(),
          completion: (0.002 * ((i % 5) + 1)).toString(),
        },
        supported_parameters: i % 3 === 0 ? ['tools'] : [],
      })),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new OpenRouterDynamicProvider('test');

    // First fetch
    const catalog1 = await provider.getCatalog('mock-api-key');
    expect(catalog1.models.length).toBe(150);

    // Should use cache on second call
    vi.clearAllMocks();
    const catalog2 = await provider.getCatalog('mock-api-key');
    expect(catalog2).toEqual(catalog1);
    expect(fetch).not.toHaveBeenCalled(); // Verify cache was used

    // Apply filters
    const filtered = await provider.getCatalogWithConfig('mock-api-key', {
      enableNewModels: true,
      disabledProviders: ['provider-1', 'provider-2'],
      disabledModels: [],
      filters: {
        requiredParameters: ['tools'],
        maxPromptCostPerMillion: 3000, // 0.003 * 1M
      },
    });

    expect(filtered.models.length).toBeLessThan(catalog1.models.length);

    // Verify no models from disabled providers
    const remainingProviders = filtered.models.map((m) => m.id.split('/')[0]);
    expect(remainingProviders).not.toContain('provider-1');
    expect(remainingProviders).not.toContain('provider-2');
  });

  it.skipIf(!process.env.OPENROUTER_TEST_KEY)(
    'should handle real API integration',
    async () => {
      const apiKey = process.env.OPENROUTER_TEST_KEY!;

      // This test actually hits the OpenRouter API
      vi.restoreAllMocks(); // Use real fetch

      const provider = new OpenRouterDynamicProvider('real-test');

      // First fetch with real API
      const catalog1 = await provider.getCatalog(apiKey);
      expect(catalog1.models.length).toBeGreaterThan(100);
      expect(catalog1.id).toBe('openrouter');
      expect(catalog1.type).toBe('openai');
      expect(catalog1.api_endpoint).toBe('https://openrouter.ai/api/v1');

      // Verify model structure
      const firstModel = catalog1.models[0];
      expect(firstModel).toHaveProperty('id');
      expect(firstModel).toHaveProperty('name');
      expect(firstModel).toHaveProperty('cost_per_1m_in');
      expect(firstModel).toHaveProperty('cost_per_1m_out');
      expect(firstModel).toHaveProperty('context_window');

      // Should use cache on second call
      const catalog2 = await provider.getCatalog(apiKey);
      expect(catalog2).toEqual(catalog1);

      // Test filtering with real data
      const filtered = await provider.getCatalogWithConfig(apiKey, {
        enableNewModels: true,
        disabledProviders: ['bytedance', 'meituan'], // Known providers to filter
        disabledModels: [],
        filters: {
          requiredParameters: ['tools'],
          maxPromptCostPerMillion: 10,
          minContextLength: 32000,
        },
      });

      expect(filtered.models.length).toBeLessThan(catalog1.models.length);
      expect(filtered.models.length).toBeGreaterThan(0);

      // Verify all remaining models meet criteria
      filtered.models.forEach((model) => {
        expect(model.cost_per_1m_in).toBeLessThanOrEqual(10);
        expect(model.context_window).toBeGreaterThanOrEqual(32000);
      });
    },
    { timeout: 15000 } // Longer timeout for real API
  );

  it('should handle cache persistence across provider instances', async () => {
    const mockResponse = {
      data: [
        {
          id: 'test/model-1',
          name: 'Test Model 1',
          context_length: 8192,
          pricing: { prompt: '0.001', completion: '0.002' },
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    // First provider instance
    const provider1 = new OpenRouterDynamicProvider('test-instance');
    await provider1.getCatalog('api-key');

    // Second provider instance with same ID should use cache
    vi.clearAllMocks();
    const provider2 = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider2.getCatalog('api-key');

    expect(fetch).not.toHaveBeenCalled();
    expect(catalog.models).toHaveLength(1);
  });

  it('should handle API errors gracefully', async () => {
    // Simulate network error
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const provider = new OpenRouterDynamicProvider('error-test');

    await expect(provider.getCatalog('api-key')).rejects.toThrow('Network error');
  });

  it('should handle malformed API responses', async () => {
    // Simulate invalid response structure
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: 'structure' }),
    });

    const provider = new OpenRouterDynamicProvider('malformed-test');

    await expect(provider.getCatalog('api-key')).rejects.toThrow();
  });
});
