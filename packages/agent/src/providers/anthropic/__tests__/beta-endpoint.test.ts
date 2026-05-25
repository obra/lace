// ABOUTME: Verifies AnthropicProvider routes to client.beta.messages.* with typed betas[]
// ABOUTME: Asserts the legacy anthropic-beta header is no longer sent on Anthropic-direct
//
// Manual smoke-test expectation (non-interactive context — documented here for the
// next maintainer): a real Anthropic-direct request against a model that declares
// a per-model beta via `extra_headers["anthropic-beta"]` should ship a `betas`
// array containing that beta plus the two observability betas, and the SDK
// should send these on the wire via the `anthropic-beta` header. We don't
// verify the on-wire serialization here — we verify the SDK call shape.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '@lace/agent/providers/anthropic-provider';
import type { CatalogProvider } from '@lace/agent/providers/catalog/types';

const mockCreate = vi.fn();
const mockStream = vi.fn();
const mockCountTokens = vi.fn().mockResolvedValue({ input_tokens: 100 });

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      // The base namespace stays available so existing helpers don't blow up,
      // but tests assert that the provider does NOT call it on Anthropic-direct.
      messages = {
        create: vi.fn(() => {
          throw new Error('messages.create must not be called — use beta.messages.create');
        }),
        stream: vi.fn(() => {
          throw new Error('messages.stream must not be called — use beta.messages.stream');
        }),
      };
      beta = {
        messages: {
          create: mockCreate,
          stream: mockStream,
          countTokens: mockCountTokens,
        },
      };
    },
  };
});

vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@lace/agent/utils/provider-logging', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

const betaPassthroughCatalog: CatalogProvider = {
  name: 'Anthropic',
  id: 'anthropic',
  type: 'anthropic',
  default_large_model_id: 'claude-test-beta-model',
  default_small_model_id: 'claude-test-beta-model',
  models: [
    {
      id: 'claude-test-beta-model',
      name: 'Synthetic model that declares a per-model beta opt-in',
      context_window: 1_000_000,
      default_max_tokens: 32_000,
      extra_headers: { 'anthropic-beta': 'context-1m-2025-08-07' },
    },
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      context_window: 200_000,
      default_max_tokens: 32_000,
    },
  ],
};

describe('AnthropicProvider beta endpoint migration', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider({
      apiKey: 'test-key',
      catalogProvider: betaPassthroughCatalog,
    });
    provider.setSystemPrompt('test sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('non-streaming (createResponse)', () => {
    it('routes through client.beta.messages.create', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('passes betas[] including the catalog beta and observability betas', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      const payload = mockCreate.mock.calls[0]![0] as { betas?: string[] };
      expect(payload.betas).toEqual([
        'context-1m-2025-08-07',
        'cache-diagnosis-2026-04-07',
        'model-context-window-exceeded-2025-08-26',
      ]);
    });

    it('passes observability-only betas[] for a plain model', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-7');

      const payload = mockCreate.mock.calls[0]![0] as { betas?: string[] };
      expect(payload.betas).toEqual([
        'cache-diagnosis-2026-04-07',
        'model-context-window-exceeded-2025-08-26',
      ]);
    });

    it('omits the legacy anthropic-beta header — betas[] is the only opt-in surface', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await provider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      const options = mockCreate.mock.calls[0]![1] as { headers?: Record<string, string> };
      // The base SDK extra-headers slot is empty/undefined — no anthropic-beta override.
      expect(options.headers?.['anthropic-beta']).toBeUndefined();
    });

    it('returns an empty betas[] when observability_betas_enabled is false and the model has no catalog betas', async () => {
      const optedOutProvider = new AnthropicProvider({
        apiKey: 'test-key',
        catalogProvider: betaPassthroughCatalog,
        observability_betas_enabled: false,
      });
      optedOutProvider.setSystemPrompt('test sys');

      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await optedOutProvider.createResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-opus-4-7'
      );

      const payload = mockCreate.mock.calls[0]![0] as { betas?: string[] };
      expect(payload.betas).toEqual([]);

      optedOutProvider.removeAllListeners();
    });
  });

  describe('streaming (createStreamingResponse)', () => {
    function makeStreamMock(finalMessage: Record<string, unknown>) {
      return {
        on: vi.fn(),
        finalMessage: vi.fn().mockResolvedValue(finalMessage),
      };
    }

    it('routes through client.beta.messages.stream', async () => {
      mockStream.mockReturnValue(
        makeStreamMock({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        })
      );

      await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      expect(mockStream).toHaveBeenCalledTimes(1);
    });

    it('passes betas[] including catalog + observability betas on streaming requests', async () => {
      mockStream.mockReturnValue(
        makeStreamMock({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        })
      );

      await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      const payload = mockStream.mock.calls[0]![0] as { betas?: string[] };
      expect(payload.betas).toEqual([
        'context-1m-2025-08-07',
        'cache-diagnosis-2026-04-07',
        'model-context-window-exceeded-2025-08-26',
      ]);
    });

    it('omits the legacy anthropic-beta header on streaming requests', async () => {
      mockStream.mockReturnValue(
        makeStreamMock({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 1, output_tokens: 1 },
          stop_reason: 'end_turn',
        })
      );

      await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-test-beta-model'
      );

      const options = mockStream.mock.calls[0]![1] as { headers?: Record<string, string> };
      expect(options.headers?.['anthropic-beta']).toBeUndefined();
    });
  });
});
