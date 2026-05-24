// ABOUTME: Integration tests for AnthropicProvider classifying HTTP 400 "prompt too long"
// ABOUTME: as a synthetic context_window_exceeded ProviderResponse instead of throwing

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider';

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
    beta: {
      messages: {
        countTokens: vi.fn().mockResolvedValue({ input_tokens: 100 }),
      },
    },
  }));
  return { default: MockAnthropic };
});

vi.mock('@lace/agent/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    shouldLog: vi.fn().mockReturnValue(false),
  },
}));

/**
 * Construct an SDK-like 400 error. We don't use the real `BadRequestError` to
 * avoid the SDK constructor's argument fiddling — the classifier inspects
 * shape, not identity.
 */
function makePromptTooLongError(): unknown {
  return {
    status: 400,
    error: {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'prompt is too long: 250000 tokens > 200000 maximum',
      },
    },
    type: 'invalid_request_error',
    message: 'prompt is too long: 250000 tokens > 200000 maximum',
  };
}

function makePri1796Error(): unknown {
  return {
    status: 400,
    error: {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message:
          'messages.1298: `tool_use` ids were found without `tool_result` blocks immediately after',
      },
    },
    type: 'invalid_request_error',
    message:
      'messages.1298: `tool_use` ids were found without `tool_result` blocks immediately after',
  };
}

describe('AnthropicProvider context-window classification', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockStream.mockReset();

    provider = new AnthropicProvider({ apiKey: 'test-key' });
    provider.setSystemPrompt('test');
    provider.on('error', () => undefined);
    provider.on('retry_attempt', () => undefined);
    provider.on('retry_exhausted', () => undefined);
  });

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('non-streaming', () => {
    it('returns synthetic context_window_exceeded ProviderResponse for prompt-too-long 400', async () => {
      mockCreate.mockRejectedValueOnce(makePromptTooLongError());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'claude-sonnet-4-20250514'
      );

      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.stopDetails).toEqual({
        type: 'context_window_exceeded',
        source: 'http_400_prompt_too_long',
      });
      expect(response.content).toBe('');
      expect(response.toolCalls).toEqual([]);
      expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });

    it('rethrows unrelated 400 (PRI-1796 tool_use ids)', async () => {
      mockCreate.mockRejectedValueOnce(makePri1796Error());

      await expect(
        provider.createResponse(
          [{ role: 'user', content: 'hello' }],
          [],
          'claude-sonnet-4-20250514'
        )
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('tool_use'),
      });
    });
  });

  describe('streaming', () => {
    it('returns synthetic context_window_exceeded for prompt-too-long during stream finalization', async () => {
      // The streaming path throws when finalMessage() rejects — emulate by
      // returning a stream whose finalMessage() rejects with our 400.
      mockStream.mockReturnValueOnce({
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockRejectedValue(makePromptTooLongError()),
      });

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'claude-sonnet-4-20250514'
      );

      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.content).toBe('');
      expect(response.toolCalls).toEqual([]);
    });

    it('rethrows unrelated 400 from streaming', async () => {
      mockStream.mockReturnValueOnce({
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockRejectedValue(makePri1796Error()),
      });

      await expect(
        provider.createStreamingResponse(
          [{ role: 'user', content: 'hi' }],
          [],
          'claude-sonnet-4-20250514'
        )
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
