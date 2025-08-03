// ABOUTME: Tests for provider catalog API endpoint (GET /api/provider/catalog)
// ABOUTME: Verifies catalog listing with models and metadata from Catwalk data

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { parseResponse } from '@/lib/serialization';
import type { CatalogProvider } from '~/providers/catalog/types';

// Mock the ProviderRegistry
vi.mock('@/lib/server/lace-imports', () => ({
  ProviderRegistry: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    getCatalogProviders: vi.fn(),
  })),
}));

describe('Provider Catalog API', () => {
  let mockRegistry: {
    initialize: ReturnType<typeof vi.fn>;
    getCatalogProviders: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    const { ProviderRegistry } = await import('@/lib/server/lace-imports');
    mockRegistry = {
      initialize: vi.fn(),
      getCatalogProviders: vi.fn(),
    };
    vi.mocked(ProviderRegistry).mockImplementation(() => mockRegistry as unknown as InstanceType<typeof ProviderRegistry>);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /api/provider/catalog', () => {
    it('should return catalog providers with models and metadata', async () => {
      const mockCatalogProviders: CatalogProvider[] = [
        {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          default_large_model_id: 'claude-3-5-sonnet-20241022',
          default_small_model_id: 'claude-3-5-haiku-20241022',
          models: [
            {
              id: 'claude-3-5-sonnet-20241022',
              name: 'Claude 3.5 Sonnet',
              cost_per_1m_in: 3.0,
              cost_per_1m_out: 15.0,
              context_window: 200000,
              default_max_tokens: 8192,
              can_reason: true,
              supports_attachments: true,
            },
            {
              id: 'claude-3-5-haiku-20241022',
              name: 'Claude 3.5 Haiku',
              cost_per_1m_in: 0.25,
              cost_per_1m_out: 1.25,
              context_window: 200000,
              default_max_tokens: 4096,
            },
          ],
        },
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
              cost_per_1m_in: 2.5,
              cost_per_1m_out: 10.0,
              context_window: 128000,
              default_max_tokens: 4096,
              supports_attachments: true,
            },
          ],
        },
      ];

      mockRegistry.getCatalogProviders.mockReturnValue(mockCatalogProviders);

      // Create a mock request object (required parameter)
      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.providers).toHaveLength(2);
      
      // Check Anthropic provider
      expect(data.providers[0]).toMatchObject({
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        default_large_model_id: 'claude-3-5-sonnet-20241022',
        default_small_model_id: 'claude-3-5-haiku-20241022',
      });
      expect(data.providers[0].models).toHaveLength(2);
      expect(data.providers[0].models[0]).toMatchObject({
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        cost_per_1m_in: 3.0,
        cost_per_1m_out: 15.0,
        can_reason: true,
      });

      // Check OpenAI provider
      expect(data.providers[1]).toMatchObject({
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
      });
      expect(data.providers[1].models).toHaveLength(1);
    });

    it('should handle empty catalog gracefully', async () => {
      mockRegistry.getCatalogProviders.mockReturnValue([]);

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse(response);

      expect(response.status).toBe(200);
      expect(data.providers).toEqual([]);
    });

    it('should handle initialization errors', async () => {
      mockRegistry.initialize.mockRejectedValue(new Error('Failed to load catalog'));

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to load catalog');
    });

    it('should handle catalog provider retrieval errors', async () => {
      mockRegistry.getCatalogProviders.mockImplementation(() => {
        throw new Error('Catalog access failed');
      });

      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe('Catalog access failed');
    });
  });
});