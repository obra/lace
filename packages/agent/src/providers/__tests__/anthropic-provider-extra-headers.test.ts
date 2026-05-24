// ABOUTME: Tests for per-model catalog-beta passthrough in AnthropicProvider
// ABOUTME: Verifies catalog-declared betas (e.g. 1M context) reach the SDK via betas[]
//
// Note: chunk I migrated Anthropic-direct off the `anthropic-beta` extra_header
// channel onto the typed `betas[]` field on `client.beta.messages.*`. The 1M
// context opt-in still rides through catalog `extra_headers["anthropic-beta"]`,
// but it now flows into betas[] (see `./anthropic/betas.ts::parseCatalogBetas`).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';
import type { CatalogProvider } from '../catalog/types';

const mockCreateResponse = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: vi.fn(), stream: vi.fn() };
      beta = {
        messages: {
          create: mockCreateResponse,
          stream: mockStream,
          countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
        },
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

describe('AnthropicProvider catalog-beta passthrough', () => {
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

  it('passes the catalog model beta into the betas[] array for the SDK call', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7-1m');

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    const payload = mockCreateResponse.mock.calls[0]![0] as { betas?: string[] };
    expect(payload.betas).toContain('context-1m-2025-08-07');
    // The legacy header is no longer ferried alongside the request.
    const options = mockCreateResponse.mock.calls[0]![1] as { headers?: Record<string, string> };
    expect(options.headers?.['anthropic-beta']).toBeUndefined();
  });

  it('omits the catalog beta for models without an extra_headers entry', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    const payload = mockCreateResponse.mock.calls[0]![0] as { betas?: string[] };
    expect(payload.betas).not.toContain('context-1m-2025-08-07');
  });

  it('passes the catalog beta into the betas[] array on streaming requests too', async () => {
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
    const payload = mockStream.mock.calls[0]![0] as { betas?: string[] };
    expect(payload.betas).toContain('context-1m-2025-08-07');
    const options = mockStream.mock.calls[0]![1] as { headers?: Record<string, string> };
    expect(options.headers?.['anthropic-beta']).toBeUndefined();
  });
});
