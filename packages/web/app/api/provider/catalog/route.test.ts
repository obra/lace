// ABOUTME: Tests for provider catalog API endpoint (GET /api/provider/catalog)
// ABOUTME: Verifies catalog listing with models and metadata from Catwalk data

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from './route';
import { parseResponse } from '@/lib/serialization';
import type { CatalogResponse } from './route';
import { setupWebTest } from '@/test-utils/web-test-setup';

describe('Provider Catalog API', () => {
  setupWebTest();

  describe('GET /api/provider/catalog', () => {
    it('should return catalog providers with models and metadata', async () => {
      // The real ProviderRegistry will load actual catalog data from files
      const mockRequest = {} as NextRequest;
      const response = await GET(mockRequest);
      const data = await parseResponse<CatalogResponse>(response);

      expect(response.status).toBe(200);
      expect(data.providers).toBeDefined();
      expect(Array.isArray(data.providers)).toBe(true);

      // Check that we have at least the standard providers
      const anthropic = data.providers.find((p) => p.id === 'anthropic');
      const openai = data.providers.find((p) => p.id === 'openai');

      expect(anthropic).toBeDefined();
      expect(anthropic?.name).toBe('Anthropic');
      expect(anthropic?.models.length).toBeGreaterThan(0);

      expect(openai).toBeDefined();
      expect(openai?.name).toBe('OpenAI');
      expect(openai?.models.length).toBeGreaterThan(0);

      // Check model structure
      if (anthropic?.models[0]) {
        expect(anthropic.models[0]).toHaveProperty('id');
        expect(anthropic.models[0]).toHaveProperty('name');
        expect(anthropic.models[0]).toHaveProperty('context_window');
        expect(anthropic.models[0]).toHaveProperty('default_max_tokens');
      }
    });
  });
});
