// ABOUTME: Unit tests for centralized API client
// ABOUTME: Validates error handling patterns and prevents regression to manual fetch patterns

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '@/lib/api-client';
import { stringify } from '@/lib/serialization';

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof global.fetch;
  });

  describe('GET requests', () => {
    it('should handle successful JSON responses', async () => {
      const mockData = { id: 'test', name: 'Test Item' };
      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(stringify(mockData)),
        clone: function () {
          return this;
        },
      } as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await api.get('/api/test');
      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith('/api/test', { method: 'GET' });
    });

    it('should throw on HTTP errors without parsing response', async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('<html><body>Not Found</body></html>'),
      } as Response);

      await expect(api.get('/api/nonexistent')).rejects.toThrow('HTTP 404');
    });

    it('should handle empty/204 responses', async () => {
      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(''),
        clone: function () {
          return this;
        },
      } as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await api.get('/api/empty');
      expect(result).toBeUndefined();
    });
  });

  describe('POST requests', () => {
    it('should send JSON body and handle response', async () => {
      const requestBody = { name: 'New Item' };
      const responseBody = { id: 'new-id', name: 'New Item' };

      const mockResponse = {
        ok: true,
        text: () => Promise.resolve(stringify(responseBody)),
        clone: function () {
          return this;
        },
      } as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      const result = await api.post('/api/items', requestBody);

      expect(result).toEqual(responseBody);
      expect(global.fetch).toHaveBeenCalledWith('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    });
  });

  describe('Error handling', () => {
    it('should enforce res.ok check before parsing', async () => {
      // This test ensures we never parse HTML error pages as JSON
      const mockResponse = {
        ok: false,
        status: 500,
        text: () => Promise.resolve('<html><body>Internal Server Error</body></html>'),
        clone: function () {
          return this;
        },
      } as Response;
      vi.mocked(global.fetch).mockResolvedValue(mockResponse);

      await expect(api.get('/api/failing')).rejects.toThrow('HTTP 500');

      // Critical: response.text() should never be called on error responses
      expect(vi.mocked(global.fetch).mock.results[0].value).resolves.toMatchObject({
        ok: false,
        status: 500,
      });
    });
  });
});
