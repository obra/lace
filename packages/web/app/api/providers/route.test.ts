// ABOUTME: Tests for provider discovery API endpoint (GET /api/providers)
// ABOUTME: Verifies API returns configured provider instances instead of auto-discovered providers

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from './route';
import { setupWebTest } from '@/test-utils/web-test-setup';
import {
  createTestProviderInstance,
  cleanupTestProviderInstances,
} from '@/lib/server/lace-imports';
import { parseResponse } from '@/lib/serialization';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Provider Discovery API', () => {
  const _tempLaceDir = setupWebTest();
  let anthropicInstanceId: string;
  let openaiInstanceId: string;
  let createdInstanceIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up environment
    process.env.LACE_DB_PATH = ':memory:';

    // Create individual provider instances for test isolation
    anthropicInstanceId = await createTestProviderInstance({
      catalogId: 'anthropic',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
      displayName: 'Test Anthropic',
      apiKey: 'test-anthropic-key',
    });

    openaiInstanceId = await createTestProviderInstance({
      catalogId: 'openai',
      models: ['gpt-4o', 'gpt-4o-mini'],
      displayName: 'Test OpenAI',
      apiKey: 'test-openai-key',
    });

    createdInstanceIds = [anthropicInstanceId, openaiInstanceId];
  });

  afterEach(async () => {
    // Clean up provider instances
    await cleanupTestProviderInstances(createdInstanceIds);
    vi.clearAllMocks();
  });

  describe('GET /api/providers', () => {
    it('should return configured provider instances instead of auto-discovered providers', async () => {
      const response = await GET();

      expect(response.status).toBe(200);

      const data = await parseResponse<{
        providers: Array<{
          id: string;
          name: string;
          type: string;
          models: Array<{ id: string; name: string }>;
          configured: boolean;
          instanceId?: string;
        }>;
      }>(response);

      // Should return providers with configured instances
      expect(data.length).toBeGreaterThan(0);

      // All returned providers should be configured
      data.forEach((provider) => {
        expect(provider.configured).toBe(true);
        expect(provider.instanceId).toBeDefined();
        expect(provider.instanceId).toEqual(expect.stringMatching(/^test-/));
      });

      // Should have unique provider types (no duplicates for same type)
      const providerTypes = data.map((p) => p.type);
      const uniqueTypes = [...new Set(providerTypes)];
      expect(providerTypes).toHaveLength(uniqueTypes.length);

      // Should NOT include providers without configured instances (like lmstudio, ollama)
      const lmstudioProvider = data.find((p) => p.type === 'lmstudio');
      expect(lmstudioProvider).toBeUndefined();

      const ollamaProvider = data.find((p) => p.type === 'ollama');
      expect(ollamaProvider).toBeUndefined();
    });

    it('should return empty array when no provider instances are configured', async () => {
      // Clean up all instances first
      await cleanupTestProviderInstances(createdInstanceIds);
      createdInstanceIds = [];

      const response = await GET();

      expect(response.status).toBe(200);

      const data = await parseResponse<{ providers: unknown[] }>(response);
      expect(data.providers).toHaveLength(0);
    });

    it('should include model information for each configured provider', async () => {
      const response = await GET();

      if (response.status !== 200) {
        const errorData = await parseResponse<{ error: string }>(response);
        console.error('API Error:', errorData);
      }

      expect(response.status).toBe(200);

      const data = await parseResponse<{
        providers: Array<{
          models: Array<{ id: string; displayName: string }>;
        }>;
      }>(response);

      // Each provider should have its models listed
      data.forEach((provider) => {
        expect(provider.models).toBeInstanceOf(Array);
        expect(provider.models.length).toBeGreaterThan(0);

        provider.models.forEach((model) => {
          expect(model.id).toEqual(expect.any(String));
          expect(model.displayName).toEqual(expect.any(String));
        });
      });
    });
  });
});
