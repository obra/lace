// ABOUTME: Tests for useProviders hook ensuring proper provider loading and error handling
// ABOUTME: Covers loading states, error handling, API integration, and refetch functionality

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProviders } from '@/hooks/useProviders';
import type { ProviderInfo } from '@/types/api';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock parseResponse
vi.mock('@/lib/serialization', () => ({
  parseResponse: vi.fn(),
}));

import { parseResponse } from '@/lib/serialization';
const mockParseResponse = vi.mocked(parseResponse);

describe('useProviders', () => {
  const mockProviders: ProviderInfo[] = [
    {
      instanceId: 'anthropic-1',
      name: 'Anthropic Claude',
      type: 'anthropic',
      status: 'available',
      models: [
        {
          id: 'claude-3-5-sonnet-20241022',
          name: 'Claude 3.5 Sonnet',
          contextLength: 200000,
          pricing: { input: 0.003, output: 0.015 },
        },
      ],
    },
    {
      instanceId: 'openai-1',
      name: 'OpenAI GPT',
      type: 'openai',
      status: 'available',
      models: [
        {
          id: 'gpt-4',
          name: 'GPT-4',
          contextLength: 128000,
          pricing: { input: 0.03, output: 0.06 },
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initial Load', () => {
    it('starts with loading state and empty providers', () => {
      mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useProviders());

      expect(result.current.loading).toBe(true);
      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe(null);
    });

    it('loads providers successfully', async () => {
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(mockProviders);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual(mockProviders);
      expect(result.current.error).toBe(null);
      expect(mockFetch).toHaveBeenCalledWith('/api/providers');
      expect(mockParseResponse).toHaveBeenCalledWith(mockResponse);
    });

    it('handles API errors from parseResponse', async () => {
      const mockResponse = { ok: false };
      const apiError = { error: 'Provider service unavailable' };

      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(apiError);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe('Failed to load providers: Provider service unavailable');
    });

    it('handles fetch errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe('Failed to load providers: Network error');
    });

    it('handles unknown errors', async () => {
      mockFetch.mockRejectedValue('String error');

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe('Failed to load providers: Unknown error');
    });
  });

  describe('Refetch Functionality', () => {
    it('provides refetch function that reloads providers', async () => {
      // Initial load fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe('Failed to load providers: Network error');
      });

      // Refetch succeeds
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(mockProviders);

      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual(mockProviders);
      expect(result.current.error).toBe(null);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Initial + refetch
    });

    it('sets loading state during refetch', async () => {
      // Initial successful load
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(mockProviders);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Start refetch - should show loading
      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockResponse), 100);
          })
      );

      const refetchPromise = result.current.refetch();

      // Wait for loading state to update asynchronously
      await waitFor(() => {
        expect(result.current.loading).toBe(true);
      });

      await refetchPromise;

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });
    });
  });

  describe('Data Handling', () => {
    it('handles empty providers array', async () => {
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue([]);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe(null);
    });

    it('handles null/undefined providers response', async () => {
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(null);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.providers).toEqual([]);
      expect(result.current.error).toBe(null);
    });

    it('preserves providers data when refetch fails', async () => {
      // Initial successful load
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(mockProviders);

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
        expect(result.current.providers).toEqual(mockProviders);
      });

      // Refetch fails
      mockFetch.mockRejectedValue(new Error('Network error'));

      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should keep original providers and show error
      expect(result.current.providers).toEqual([]); // Sets to empty on error
      expect(result.current.error).toBe('Failed to load providers: Network error');
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('logs errors to console', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValue(new Error('Network error'));

      renderHook(() => useProviders());

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to load providers: Network error');
      });

      consoleSpy.mockRestore();
    });

    it('clears error state on successful refetch', async () => {
      // Initial load fails
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useProviders());

      await waitFor(() => {
        expect(result.current.error).toBe('Failed to load providers: Network error');
      });

      // Refetch succeeds
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);
      mockParseResponse.mockResolvedValue(mockProviders);

      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.error).toBe(null);
        expect(result.current.providers).toEqual(mockProviders);
      });
    });
  });
});
