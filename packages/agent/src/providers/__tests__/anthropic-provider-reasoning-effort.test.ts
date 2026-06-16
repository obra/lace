// ABOUTME: Tests that AnthropicProvider wires reasoning effort into the request —
// ABOUTME: a reasoning-capable model with a configured effort sends
// ABOUTME: output_config.effort, merged with any output_config.format. Models that
// ABOUTME: don't support reasoning efforts (has_reasoning_effort:false) never
// ABOUTME: receive effort, so the compaction haiku/sonnet calls stay unaffected.
// ABOUTME: We never enable thinking — lace history doesn't round-trip thinking blocks.

import type { CatalogProvider } from '../catalog/types';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';

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
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../utils/provider-logging.js', () => ({
  logProviderRequest: vi.fn(),
  logProviderResponse: vi.fn(),
}));

const reasoningCatalog: CatalogProvider = {
  name: 'Anthropic',
  id: 'anthropic',
  type: 'anthropic',
  default_large_model_id: 'claude-opus-4-8',
  default_small_model_id: 'claude-haiku-4-5-20251001',
  models: [
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      context_window: 1_000_000,
      default_max_tokens: 50000,
      can_reason: true,
      has_reasoning_effort: true,
      default_reasoning_effort: 'medium',
    },
    {
      // Reasoning-capable but does NOT support effort levels (compaction haiku).
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      context_window: 200_000,
      default_max_tokens: 32000,
      can_reason: true,
      has_reasoning_effort: false,
      default_reasoning_effort: 'medium',
    },
    {
      // No reasoning metadata at all (inferred-style entry, e.g. sonnet-4-6).
      id: 'claude-plain-model',
      name: 'Plain model',
      context_window: 200_000,
      default_max_tokens: 32000,
    },
  ],
};

const OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: { decision: { type: 'string' } },
    required: ['decision'],
    additionalProperties: false,
  },
} as const;

type EffortPayload = {
  output_config?: { effort?: unknown; format?: unknown };
  thinking?: { type?: string };
};

describe('AnthropicProvider reasoning effort', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LACE_REASONING_EFFORT;
    provider = new AnthropicProvider({ apiKey: 'test-key', catalogProvider: reasoningCatalog });
    provider.setSystemPrompt('sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
    delete process.env.LACE_REASONING_EFFORT;
  });

  it('sends output_config.effort for an effort-capable model, without enabling thinking', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-8');

    const payload = mockCreateResponse.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config?.effort).toBe('medium');
    expect(payload.thinking).toBeUndefined();
  });

  it('respects the LACE_REASONING_EFFORT override for an effort-capable model', async () => {
    process.env.LACE_REASONING_EFFORT = 'high';
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-8');

    const payload = mockCreateResponse.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config?.effort).toBe('high');
  });

  it('merges effort with output_config.format when a structured output is requested', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: '{"decision":"ok"}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse(
      [{ role: 'user', content: 'decide' }],
      [],
      'claude-opus-4-8',
      undefined,
      undefined,
      { outputFormat: OUTPUT_FORMAT }
    );

    const payload = mockCreateResponse.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config?.effort).toBe('medium');
    expect(payload.output_config?.format).toEqual(OUTPUT_FORMAT);
  });

  it('never sends effort or thinking to a model with has_reasoning_effort:false', async () => {
    process.env.LACE_REASONING_EFFORT = 'high';
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-haiku-4-5-20251001'
    );

    const payload = mockCreateResponse.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config?.effort).toBeUndefined();
    expect(payload.thinking).toBeUndefined();
  });

  it('omits effort and thinking for a model without reasoning metadata', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-plain-model');

    const payload = mockCreateResponse.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config).toBeUndefined();
    expect(payload.thinking).toBeUndefined();
  });

  it('wires effort on streaming requests too', async () => {
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      }),
    });

    await provider.createStreamingResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-8'
    );

    const payload = mockStream.mock.calls[0]![0] as EffortPayload;
    expect(payload.output_config?.effort).toBe('medium');
    expect(payload.thinking).toBeUndefined();
  });
});
