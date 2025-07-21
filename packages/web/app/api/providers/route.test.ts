// ABOUTME: Tests for provider discovery API endpoint (GET /api/providers)
// ABOUTME: Verifies provider listing with models and configuration status

import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { GET, type ProviderWithModels } from '@/app/api/providers/route';
import type { ProviderInfo, ModelInfo } from '@/lib/server/core-types';
import { setupTestPersistence, teardownTestPersistence } from '~/test-setup-dir/persistence-helper';
// ProviderRegistry is mocked but not directly used in tests

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

describe('Provider Discovery API', () => {
  let mockRegistry: {
    getAvailableProviders: MockedFunction<
      () => Array<{ info: ProviderInfo; models: ModelInfo[]; configured: boolean }>
    >;
    _providers: Map<string, unknown>;
    registerProvider: MockedFunction<(name: string, provider: unknown) => void>;
    getProvider: MockedFunction<(name: string) => unknown>;
    getAllProviders: MockedFunction<() => unknown[]>;
    getAvailableModelsByProvider: MockedFunction<(providerName: string) => unknown[]>;
    isProviderConfigured: MockedFunction<(providerName: string) => boolean>;
  };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    setupTestPersistence();
    vi.clearAllMocks();
    mockRegistry = {
      getAvailableProviders: vi.fn(),
      _providers: new Map(),
      registerProvider: vi.fn(),
      getProvider: vi.fn(),
      getAllProviders: vi.fn(),
      getAvailableModelsByProvider: vi.fn(),
      isProviderConfigured: vi.fn(),
    };

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { ProviderRegistry } = await import('@/lib/server/lace-imports');
    vi.mocked(ProviderRegistry.createWithAutoDiscovery).mockReturnValue(
      mockRegistry as unknown as typeof ProviderRegistry.prototype
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('GET /api/providers', () => {
    it('should list all available providers with their models', async () => {
      const mockProviders: Array<{
        info: ProviderInfo;
        models: ModelInfo[];
        configured: boolean;
      }> = [
        {
          info: {
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
          info: {
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

      mockRegistry.getAvailableProviders.mockReturnValue(mockProviders);

      const response = await GET();
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data.providers).toHaveLength(2);
      expect(data.providers[0]).toMatchObject({
        name: 'anthropic',
        displayName: 'Anthropic Claude',
        requiresApiKey: true,
        configured: true,
      });
      expect(data.providers[0]?.models).toContainEqual(
        expect.objectContaining({
          id: 'claude-3-5-sonnet-20241022',
          displayName: 'Claude 3.5 Sonnet',
        })
      );
      expect(data.providers[1]).toMatchObject({
        name: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        configured: false,
        configurationHint: 'Set OPENAI_API_KEY environment variable',
      });
      expect(data.providers[1]?.models).toContainEqual(
        expect.objectContaining({
          id: 'gpt-4-turbo',
          displayName: 'GPT-4 Turbo',
        })
      );
    });

    it('should handle empty provider list', async () => {
      mockRegistry.getAvailableProviders.mockReturnValue([]);

      const response = await GET();
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data).toEqual({ providers: [] });
    });

    it('should include configuration hints for unconfigured providers', async () => {
      const mockProviders = [
        {
          info: {
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

      mockRegistry.getAvailableProviders.mockReturnValue(mockProviders);

      const response = await GET();
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      expect(data.providers[0]).toMatchObject({
        name: 'anthropic',
        configured: false,
        configurationHint: 'Set ANTHROPIC_API_KEY environment variable',
      } as Partial<ProviderWithModels>);
    });

    it('should handle provider discovery errors gracefully', async () => {
      mockRegistry.getAvailableProviders.mockImplementation(() => {
        throw new Error('Failed to discover providers');
      });

      const response = await GET();
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(500);
      expect(data).toMatchObject({
        error: 'Failed to discover providers',
      });
    });

    it('should mark providers with default models correctly', async () => {
      const mockProviders = [
        {
          info: {
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

      mockRegistry.getAvailableProviders.mockReturnValue(mockProviders);

      const response = await GET();
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      const provider = data.providers[0];
      expect(provider).toBeDefined();
      const defaultModel = provider.models.find((m) => m.isDefault);
      expect(defaultModel).toBeDefined();
      expect(defaultModel?.id).toBe('claude-3-5-sonnet-20241022');
    });

    it('should include model capabilities when available', async () => {
      const mockProviders = [
        {
          info: {
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

      mockRegistry.getAvailableProviders.mockReturnValue(mockProviders);

      const response = await GET();
      const data = (await response.json()) as ProvidersResponse;

      expect(response.status).toBe(200);
      const provider = data.providers[0];
      expect(provider).toBeDefined();
      const model = provider.models[0];
      expect(model).toBeDefined();
      expect(model?.capabilities).toEqual(['vision', 'function-calling', 'json-mode']);
    });
  });
});
