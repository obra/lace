// ABOUTME: Tests for Anthropic API client
// ABOUTME: Validates model fetching and pagination handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicClient } from '../client';

describe('AnthropicClient', () => {
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchModels', () => {
    it('fetches models with correct headers', async () => {
      const mockResponse = {
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
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new AnthropicClient();
      const result = await client.fetchModels(mockApiKey);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': mockApiKey,
            'anthropic-version': '2023-06-01',
          }),
        })
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('claude-sonnet-4-20250514');
    });

    it('uses custom base URL when provided', async () => {
      const mockResponse = {
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new AnthropicClient('https://custom.api.com/v1');
      await client.fetchModels(mockApiKey);

      expect(fetchSpy).toHaveBeenCalledWith('https://custom.api.com/v1/models', expect.anything());
    });

    it('throws on API error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      } as Response);

      const client = new AnthropicClient();
      await expect(client.fetchModels(mockApiKey)).rejects.toThrow(
        'Anthropic API error: 401 - Unauthorized'
      );
    });

    it('validates response with Zod schema', async () => {
      const invalidResponse = {
        data: [{ id: 'model-1' }], // missing required fields
        has_more: false,
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidResponse),
      } as Response);

      const client = new AnthropicClient();
      await expect(client.fetchModels(mockApiKey)).rejects.toThrow();
    });
  });

  describe('fetchAllModels', () => {
    it('fetches all pages when has_more is true', async () => {
      const page1 = {
        data: [
          {
            id: 'model-1',
            type: 'model',
            display_name: 'Model 1',
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
        has_more: true,
        first_id: 'model-1',
        last_id: 'model-1',
      };
      const page2 = {
        data: [
          {
            id: 'model-2',
            type: 'model',
            display_name: 'Model 2',
            created_at: '2025-01-02T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'model-2',
        last_id: 'model-2',
      };

      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(page1),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(page2),
        } as Response);

      const client = new AnthropicClient();
      const result = await client.fetchAllModels(mockApiKey);

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Second call should include after_id parameter
      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('after_id=model-1'),
        expect.anything()
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('model-1');
      expect(result[1].id).toBe('model-2');
    });

    it('returns all models when single page', async () => {
      const singlePage = {
        data: [
          {
            id: 'model-1',
            type: 'model',
            display_name: 'Model 1',
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
        has_more: false,
        first_id: 'model-1',
        last_id: 'model-1',
      };

      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(singlePage),
      } as Response);

      const client = new AnthropicClient();
      const result = await client.fetchAllModels(mockApiKey);

      expect(result).toHaveLength(1);
    });

    it('uses high limit for efficient fetching', async () => {
      const mockResponse = {
        data: [],
        has_more: false,
        first_id: null,
        last_id: null,
      };

      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const client = new AnthropicClient();
      await client.fetchAllModels(mockApiKey);

      // Should use limit=1000 to minimize API calls
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('limit=1000'),
        expect.anything()
      );
    });
  });
});
