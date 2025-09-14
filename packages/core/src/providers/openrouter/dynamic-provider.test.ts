import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterDynamicProvider } from './dynamic-provider';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// Mock the getLaceDir function
vi.mock('~/config/lace-dir', () => ({
  getLaceDir: vi.fn(() => '/tmp/lace-test'),
}));

describe('OpenRouterDynamicProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'lace-test-'));
    // Update the mock to return our temp directory
    const { getLaceDir } = await import('~/config/lace-dir');
    (getLaceDir as any).mockReturnValue(tempDir);

    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should fetch and cache catalog on first call', async () => {
    const mockResponse = {
      data: [
        {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          context_length: 8192,
          pricing: { prompt: '0.00003', completion: '0.00006' },
          supported_parameters: ['tools'],
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider.getCatalog('test-api-key');

    expect(catalog.models).toHaveLength(1);
    expect(catalog.id).toBe('openrouter');
    expect(catalog.name).toBe('OpenRouter');
    expect(catalog.type).toBe('openai'); // OpenRouter uses OpenAI-compatible API
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-api-key' },
      })
    );
  });

  it('should use cache when fresh', async () => {
    const provider = new OpenRouterDynamicProvider('test-instance');

    // First call - fetches from API
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await provider.getCatalog('test-api-key');

    // Second call - should use cache
    vi.clearAllMocks();
    await provider.getCatalog('test-api-key');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('should apply model filters', async () => {
    const mockResponse = {
      data: [
        {
          id: 'openai/gpt-4',
          name: 'GPT-4',
          context_length: 8192,
          pricing: { prompt: '0.00003', completion: '0.00006' },
          supported_parameters: ['tools'],
        },
        {
          id: 'google/gemini',
          name: 'Gemini',
          context_length: 32000,
          pricing: { prompt: '0.000001', completion: '0.000002' },
          supported_parameters: [],
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const config = {
      enableNewModels: true,
      disabledProviders: ['google'],
      disabledModels: [],
      filters: {},
    };

    const provider = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider.getCatalogWithConfig('test-api-key', config);

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0].id).toBe('openai/gpt-4');
  });

  it('should transform OpenRouter models to catalog format', async () => {
    const mockResponse = {
      data: [
        {
          id: 'openai/gpt-4o',
          name: 'GPT-4o',
          context_length: 128000,
          pricing: { prompt: '0.0000025', completion: '0.00001' },
          supported_parameters: ['tools', 'vision'],
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider.getCatalog('test-api-key');

    const model = catalog.models[0];
    expect(model.id).toBe('openai/gpt-4o');
    expect(model.name).toBe('GPT-4o');
    expect(model.cost_per_1m_in).toBe(2.5); // 0.0000025 * 1M
    expect(model.cost_per_1m_out).toBe(10); // 0.00001 * 1M
    expect(model.context_window).toBe(128000);
    expect(model.supports_attachments).toBe(true); // vision parameter
    expect(model.default_max_tokens).toBe(4096); // min(4096, floor(128000/4))
  });

  it('should handle API errors and fall back to cache', async () => {
    const provider = new OpenRouterDynamicProvider('test-instance');

    // First, populate cache with a successful call
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'test/model',
            name: 'Test',
            context_length: 4096,
            pricing: { prompt: '0.001', completion: '0.002' },
          },
        ],
      }),
    });
    await provider.getCatalog('test-api-key');

    // Now simulate API error
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const catalog = await provider.getCatalog('test-api-key');
    expect(catalog.models).toHaveLength(1); // Should use cached data
  });

  it('should throw error if no cache and API fails', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const provider = new OpenRouterDynamicProvider('test-instance');
    await expect(provider.getCatalog('test-api-key')).rejects.toThrow('OpenRouter API error: 500');
  });

  it('should set default models correctly', async () => {
    const mockResponse = {
      data: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          name: 'Claude 3.5 Sonnet',
          context_length: 200000,
          pricing: { prompt: '0.000003', completion: '0.000015' },
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider.getCatalog('test-api-key');

    expect(catalog.default_large_model_id).toBe('anthropic/claude-3.5-sonnet');
    expect(catalog.default_small_model_id).toBe('anthropic/claude-3.5-haiku');
    expect(catalog.api_endpoint).toBe('https://openrouter.ai/api/v1');
  });

  it('should handle models with missing vision parameter', async () => {
    const mockResponse = {
      data: [
        {
          id: 'test/model',
          name: 'Test Model',
          context_length: 4096,
          pricing: { prompt: '0.001', completion: '0.002' },
          supported_parameters: ['tools'], // No vision
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const provider = new OpenRouterDynamicProvider('test-instance');
    const catalog = await provider.getCatalog('test-api-key');

    const model = catalog.models[0];
    expect(model.supports_attachments).toBe(false);
    expect(model.can_reason).toBe(false);
  });
});
