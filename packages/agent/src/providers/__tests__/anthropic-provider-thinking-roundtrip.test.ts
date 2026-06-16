// ABOUTME: Tests that AnthropicProvider enables adaptive thinking for an
// ABOUTME: effort-capable model and captures thinking/redacted_thinking blocks
// ABOUTME: (with signature) from the response into ProviderResponse.thinkingBlocks,
// ABOUTME: on both the non-streaming and streaming paths. This is the capture half
// ABOUTME: of thinking-block round-tripping.

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

const catalog: CatalogProvider = {
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
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      context_window: 200_000,
      default_max_tokens: 32000,
      can_reason: true,
      has_reasoning_effort: false,
    },
  ],
};

const THINKING_CONTENT = [
  { type: 'thinking', thinking: 'let me reason about this', signature: 'sig-abc123' },
  { type: 'redacted_thinking', data: 'encrypted-blob' },
  { type: 'text', text: 'final answer' },
];

type Payload = { thinking?: { type?: string; display?: string } };

describe('AnthropicProvider adaptive thinking + thinking-block capture', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LACE_REASONING_EFFORT;
    provider = new AnthropicProvider({ apiKey: 'test-key', catalogProvider: catalog });
    provider.setSystemPrompt('sys');
  });

  afterEach(() => {
    provider.removeAllListeners();
    delete process.env.LACE_REASONING_EFFORT;
  });

  it('enables summarized adaptive thinking for an effort-capable model', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    await provider.createResponse([{ role: 'user', content: 'hi' }], [], 'claude-opus-4-8');

    const payload = mockCreateResponse.mock.calls[0]![0] as Payload;
    expect(payload.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('does not enable thinking for a model without reasoning efforts (haiku)', async () => {
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

    const payload = mockCreateResponse.mock.calls[0]![0] as Payload;
    expect(payload.thinking).toBeUndefined();
  });

  it('captures thinking + redacted_thinking blocks from the response (non-streaming)', async () => {
    mockCreateResponse.mockResolvedValue({
      content: THINKING_CONTENT,
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    const response = await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-8'
    );

    expect(response.content).toBe('final answer');
    expect(response.thinkingBlocks).toEqual([
      { type: 'thinking', thinking: 'let me reason about this', signature: 'sig-abc123' },
      { type: 'redacted_thinking', data: 'encrypted-blob' },
    ]);
  });

  it('leaves thinkingBlocks undefined when the response has none', async () => {
    mockCreateResponse.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    });

    const response = await provider.createResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-8'
    );

    expect(response.thinkingBlocks).toBeUndefined();
  });

  it('captures thinking blocks from the final message (streaming)', async () => {
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        id: 'msg_1',
        content: THINKING_CONTENT,
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      }),
    });

    const response = await provider.createStreamingResponse(
      [{ role: 'user', content: 'hi' }],
      [],
      'claude-opus-4-8'
    );

    expect(response.thinkingBlocks).toEqual([
      { type: 'thinking', thinking: 'let me reason about this', signature: 'sig-abc123' },
      { type: 'redacted_thinking', data: 'encrypted-blob' },
    ]);
  });
});
