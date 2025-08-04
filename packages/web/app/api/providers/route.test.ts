// ABOUTME: Tests for provider discovery API endpoint (GET /api/providers)
// ABOUTME: Verifies API returns configured provider instances instead of auto-discovered providers

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from './route';
import { setupTestPersistence, teardownTestPersistence } from '~/test-utils/persistence-helper';
import { setupTestProviderInstances, cleanupTestProviderInstances } from '~/test-utils/provider-instances';
import { parseResponse } from '@/lib/serialization';

// Mock server-only module
vi.mock('server-only', () => ({}));

describe('Provider Discovery API', () => {
  let testProviderInstances: {
    anthropicInstanceId: string;
    openaiInstanceId: string;
  };
  let createdInstanceIds: string[] = [];

  beforeEach(async () => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Set up environment
    process.env.LACE_DB_PATH = ':memory:';

    // Create test provider instances
    testProviderInstances = await setupTestProviderInstances();
    createdInstanceIds = [testProviderInstances.anthropicInstanceId, testProviderInstances.openaiInstanceId];
  });

  afterEach(async () => {
    // Clean up provider instances
    await cleanupTestProviderInstances(createdInstanceIds);
    teardownTestPersistence();
  });

  describe('GET /api/providers', () => {
    it('should return configured provider instances instead of auto-discovered providers', async () => {
      const response = await GET();
      
      expect(response.status).toBe(200);
      
      const data = await parseResponse<{ providers: Array<{ 
        id: string; 
        name: string; 
        type: string;
        models: Array<{ id: string; name: string }>;
        configured: boolean;
        instanceId?: string;
      }> }>(response);
      
      // Should return providers with configured instances
      expect(data.providers.length).toBeGreaterThan(0);
      
      // All returned providers should be configured
      data.providers.forEach(provider => {
        expect(provider.configured).toBe(true);
        expect(provider.instanceId).toBeDefined();
        expect(provider.instanceId).toEqual(expect.stringMatching(/^test-/));
      });
      
      // Should have unique provider types (no duplicates for same type)
      const providerTypes = data.providers.map(p => p.type);
      const uniqueTypes = [...new Set(providerTypes)];
      expect(providerTypes).toHaveLength(uniqueTypes.length);
      
      // Should NOT include providers without configured instances (like lmstudio, ollama)
      const lmstudioProvider = data.providers.find(p => p.type === 'lmstudio');
      expect(lmstudioProvider).toBeUndefined();
      
      const ollamaProvider = data.providers.find(p => p.type === 'ollama');
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
      
      const data = await parseResponse<{ providers: Array<{ 
        models: Array<{ id: string; name: string }>;
      }> }>(response);
      
      // Each provider should have its models listed
      data.providers.forEach(provider => {
        expect(provider.models).toBeInstanceOf(Array);
        expect(provider.models.length).toBeGreaterThan(0);
        
        provider.models.forEach(model => {
          expect(model.id).toEqual(expect.any(String));
          expect(model.name).toEqual(expect.any(String));
        });
      });
    });
  });
});
