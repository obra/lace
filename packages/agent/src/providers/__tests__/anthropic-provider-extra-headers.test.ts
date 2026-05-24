// ABOUTME: Tests for per-model extra_headers passthrough in AnthropicProvider
// ABOUTME: Verifies catalog-declared headers (e.g. the 1M context beta) reach the SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import type { CatalogProvider } from '../catalog/types';

const mockCreateResponse = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreateResponse,
        stream: mockStream,
      };
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

const opus1mCatalog: CatalogProvider = {
  name: 'Anthropic',
  id: 'anthropic',
  type: 'anthropic',
  default_large_model_id: 'claude-opus-4-7-1m',
  default_small_model_id: 'claude-opus-4-7-1m',
  models: [
    {
      id: 'claude-opus-4-7-1m',
      name: 'Claude Opus 4.7 (1M context)',
      context_window: 1_000_000,
      default_max_tokens: 32000,
      extra_headers: { 'anthropic-beta': 'context-1m-2025-08-07' },
    },
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      context_window: 200_000,
      default_max_tokens: 32000,
    },
  ],
};

describe('AnthropicProvider extra_headers passthrough', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      catalogProvider: opus1mCatalog,
    });
    provider.setSystemPrompt('sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  it('passes extra_headers from catalog model entry to the SDK call', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7-1m');

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    const options = mockCreateResponse.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers).toMatchObject({ 'anthropic-beta': 'context-1m-2025-08-07' });
  });

  it('omits extra headers for models without an extra_headers entry', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    const options = mockCreateResponse.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers).toBeUndefined();
  });

  it('passes extra_headers on streaming requests too', async () => {
    const finalMessage = {
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    };
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue(finalMessage),
    });

    await provider.createStreamingResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-7-1m'
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const options = mockStream.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers).toMatchObject({ 'anthropic-beta': 'context-1m-2025-08-07' });
  });
});
