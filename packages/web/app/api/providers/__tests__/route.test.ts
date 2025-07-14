// ABOUTME: Tests for provider discovery API endpoint (GET /api/providers)
// ABOUTME: Verifies provider listing with models and configuration status

import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, type ProviderWithModels } from '@/app/api/providers/route';
import type { ProviderInfo, ModelInfo } from '@/lib/server/lace-imports';
import { ProviderRegistry } from '@/lib/server/lace-imports';

// Response type for tests
interface ProvidersResponse {
  providers: ProviderWithModels[];
  error?: string;
}

// Mock the module
vi.mock('@/lib/server/lace-imports', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: vi.fn(),
  },
}));

// Get typed reference to the mock
const mockCreateWithAutoDiscovery = ProviderRegistry.createWithAutoDiscovery as MockedFunction<
  typeof ProviderRegistry.createWithAutoDiscovery
>;

describe('Provider Discovery API', () => {
  let mockRegistry: {
    getAvailableProviders: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegistry = {
      getAvailableProviders: vi.fn(),
    };
    mockCreateWithAutoDiscovery.mockResolvedValue(mockRegistry);
  });

  describe('GET /api/providers', () => {
    it('should list all available providers with their models', async () => {
      const mockProviders: Array<{
        provider: ProviderInfo;
        models: ModelInfo[];
        configured: boolean;
      }> = [
        {
          provider: {
            name: 'anthropic',
            displayName: 'Anthropic Claude',
            requiresApiKey: true,
            configurationHint: 'Set ANTHROPIC_API_KEY environment variable',
          },
          models: [
            {
              id: 'claude-3-5-sonnet-20241022',
              displayName: 'Claude 3.5 Sonnet',
              description: 'Most capable model for complex tasks',
              contextWindow: 200000,
              maxOutputTokens: 8192,
              capabilities: ['vision', 'function-calling'],
              isDefault: true,
            },
            {
              id: 'claude-3-haiku-20240307',
              displayName: 'Claude 3 Haiku',
              description: 'Fast and efficient for simple tasks',
              contextWindow: 200000,
              maxOutputTokens: 4096,
              capabilities: ['function-calling'],
            },
          ],
          configured: true,
        },
        {
          provider: {
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
            configurationHint: 'Set OPENAI_API_KEY environment variable',
          },
          models: [
            {
              id: 'gpt-4-turbo',
              displayName: 'GPT-4 Turbo',
              description: 'Most capable GPT-4 model',
              contextWindow: 128000,
              maxOutputTokens: 4096,
              capabilities: ['vision', 'function-calling'],
              isDefault: true,
            },
          ],
          configured: false,
        },
      ];

      mockRegistry.getAvailableProviders.mockResolvedValue(mockProviders);

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        providers: [
          expect.objectContaining({
            name: 'anthropic',
            displayName: 'Anthropic Claude',
            requiresApiKey: true,
            configured: true,
            models: expect.arrayContaining([
              expect.objectContaining({
                id: 'claude-3-5-sonnet-20241022',
                displayName: 'Claude 3.5 Sonnet',
              }),
            ]),
          }),
          expect.objectContaining({
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
            configured: false,
            configurationHint: 'Set OPENAI_API_KEY environment variable',
            models: expect.arrayContaining([
              expect.objectContaining({
                id: 'gpt-4-turbo',
                displayName: 'GPT-4 Turbo',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle empty provider list', async () => {
      mockRegistry.getAvailableProviders.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data).toEqual({ providers: [] });
    });

    it('should include configuration hints for unconfigured providers', async () => {
      const mockProviders = [
        {
          provider: {
            name: 'anthropic',
            displayName: 'Anthropic Claude',
            requiresApiKey: true,
            configurationHint: 'Set ANTHROPIC_API_KEY environment variable',
          },
          models: [
            {
              id: 'claude-3-haiku-20240307',
              displayName: 'Claude 3 Haiku',
              contextWindow: 200000,
              maxOutputTokens: 4096,
            },
          ],
          configured: false,
        },
      ];

      mockRegistry.getAvailableProviders.mockResolvedValue(mockProviders);

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data.providers[0]).toMatchObject({
        name: 'anthropic',
        configured: false,
        configurationHint: 'Set ANTHROPIC_API_KEY environment variable',
      });
    });

    it('should handle provider discovery errors gracefully', async () => {
      mockRegistry.getAvailableProviders.mockRejectedValue(
        new Error('Failed to discover providers')
      );

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data).toMatchObject({
        error: 'Failed to retrieve providers',
      });
    });

    it('should mark providers with default models correctly', async () => {
      const mockProviders = [
        {
          provider: {
            name: 'anthropic',
            displayName: 'Anthropic Claude',
            requiresApiKey: true,
          },
          models: [
            {
              id: 'claude-3-5-sonnet-20241022',
              displayName: 'Claude 3.5 Sonnet',
              contextWindow: 200000,
              maxOutputTokens: 8192,
              isDefault: true,
            },
            {
              id: 'claude-3-opus-20240229',
              displayName: 'Claude 3 Opus',
              contextWindow: 200000,
              maxOutputTokens: 4096,
              isDefault: false,
            },
          ],
          configured: true,
        },
      ];

      mockRegistry.getAvailableProviders.mockResolvedValue(mockProviders);

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      const defaultModel = (data.providers[0] as ProviderWithModels).models.find(
        (m) => m.isDefault
      );
      expect(defaultModel).toBeDefined();
      expect(defaultModel.id).toBe('claude-3-5-sonnet-20241022');
    });

    it('should include model capabilities when available', async () => {
      const mockProviders = [
        {
          provider: {
            name: 'openai',
            displayName: 'OpenAI',
            requiresApiKey: true,
          },
          models: [
            {
              id: 'gpt-4-vision-preview',
              displayName: 'GPT-4 Vision',
              contextWindow: 128000,
              maxOutputTokens: 4096,
              capabilities: ['vision', 'function-calling', 'json-mode'],
            },
          ],
          configured: true,
        },
      ];

      mockRegistry.getAvailableProviders.mockResolvedValue(mockProviders);

      const request = new NextRequest('http://localhost:3000/api/providers');
      const response = await GET(request);
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data.providers[0].models[0].capabilities).toEqual([
        'vision',
        'function-calling',
        'json-mode',
      ]);
    });
  });
});
