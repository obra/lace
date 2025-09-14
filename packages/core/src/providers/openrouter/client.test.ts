import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenRouterClient } from './client';
import fixtureData from './fixtures/models-response-test.json';

describe('OpenRouterClient', () => {
  describe('with real API response structure', () => {
    beforeEach(() => {
      // Mock fetch to return our fixture data
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fixtureData,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should parse real OpenRouter response correctly', async () => {
      const client = new OpenRouterClient();
      const result = await client.fetchModels();

      expect(result.data).toHaveLength(10);

      // Test actual structure from real data
      const firstModel = result.data[0];
      expect(firstModel).toHaveProperty('id');
      expect(firstModel).toHaveProperty('name');
      expect(firstModel).toHaveProperty('context_length');
      expect(firstModel).toHaveProperty('pricing');
      expect(firstModel.pricing).toHaveProperty('prompt');
      expect(firstModel.pricing).toHaveProperty('completion');
    });

    it('should work without API key', async () => {
      const client = new OpenRouterClient();
      const result = await client.fetchModels(); // No API key

      expect(fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: {}, // No auth header
        })
      );
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should include API key when provided', async () => {
      const client = new OpenRouterClient();
      await client.fetchModels('test-api-key');

      expect(fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-api-key' },
        })
      );
    });

    it('should handle API errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const client = new OpenRouterClient();
      await expect(client.fetchModels()).rejects.toThrow('OpenRouter API error: 500');
    });

    it('should validate response schema', async () => {
      // Test with invalid response structure
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ invalidStructure: true }),
      });

      const client = new OpenRouterClient();
      await expect(client.fetchModels()).rejects.toThrow();
    });
  });

  describe('with live API (integration)', () => {
    it.skipIf(!process.env.TEST_LIVE_API)(
      'should fetch real data from OpenRouter API',
      async () => {
        // This test actually hits the API
        vi.restoreAllMocks(); // Use real fetch

        const client = new OpenRouterClient();
        const result = await client.fetchModels();

        expect(result.data.length).toBeGreaterThan(100);
        expect(result.data[0]).toHaveProperty('id');
        expect(result.data[0]).toHaveProperty('pricing');
      },
      { timeout: 10000 }
    );
  });
});
