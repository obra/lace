// ABOUTME: Integration tests for OpenAIProvider classifying HTTP 400 "context_length_exceeded"
// ABOUTME: as a synthetic context_window_exceeded ProviderResponse instead of throwing

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';

const mockChatCreate = vi.fn();
const mockResponsesCreate = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockChatCreate,
      },
    };
    responses = {
      create: mockResponsesCreate,
    };
  }
  return { default: MockOpenAI };
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

// Configure a custom baseURL to force the Chat Completions path. Responses API
// fall-through is exercised separately by forcing the Responses API path
// with default OpenAI baseURL below.
const CHAT_COMPLETIONS_BASE_URL = 'http://localhost:8080/v1';

function makeContextLengthExceededError(): unknown {
  return {
    status: 400,
    error: {
      code: 'context_length_exceeded',
      type: 'invalid_request_error',
      message: "This model's maximum context length is 128000 tokens, however you requested 250000",
    },
    code: 'context_length_exceeded',
    type: 'invalid_request_error',
    message: "This model's maximum context length is 128000 tokens, however you requested 250000",
  };
}

function makeUnrelated400(): unknown {
  return {
    status: 400,
    error: {
      code: 'invalid_value',
      type: 'invalid_request_error',
      message: 'Unknown parameter foo',
    },
    code: 'invalid_value',
    type: 'invalid_request_error',
    message: 'Unknown parameter foo',
  };
}

describe('OpenAIProvider context-window classification', () => {
  describe('Chat Completions (custom baseURL)', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      vi.clearAllMocks();
      mockChatCreate.mockReset();
      mockResponsesCreate.mockReset();

      provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: CHAT_COMPLETIONS_BASE_URL,
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);
      provider.on('retry_attempt', () => undefined);
      provider.on('retry_exhausted', () => undefined);
    });

    afterEach(() => {
      provider.removeAllListeners();
    });

    it('returns synthetic context_window_exceeded for context_length_exceeded 400 (non-streaming)', async () => {
      mockChatCreate.mockRejectedValueOnce(makeContextLengthExceededError());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'gpt-4o'
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

    it('rethrows unrelated 400 (non-streaming)', async () => {
      mockChatCreate.mockRejectedValueOnce(makeUnrelated400());

      await expect(
        provider.createResponse([{ role: 'user', content: 'hello' }], [], 'gpt-4o')
      ).rejects.toMatchObject({ status: 400 });
    });

    it('returns synthetic context_window_exceeded for context_length_exceeded 400 (streaming)', async () => {
      // Streaming throws at stream-create time when the request body is rejected
      // — emulate by having the chat.completions.create call itself reject.
      mockChatCreate.mockRejectedValueOnce(makeContextLengthExceededError());

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        'gpt-4o'
      );

      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.content).toBe('');
    });
  });

  describe('Responses API (default OpenAI baseURL)', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      vi.clearAllMocks();
      mockChatCreate.mockReset();
      mockResponsesCreate.mockReset();

      provider = new OpenAIProvider({
        apiKey: 'test-key',
        // No custom baseURL — uses Responses API
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);
      provider.on('retry_attempt', () => undefined);
      provider.on('retry_exhausted', () => undefined);
    });

    afterEach(() => {
      provider.removeAllListeners();
    });

    it('returns synthetic context_window_exceeded for context_length_exceeded 400', async () => {
      mockResponsesCreate.mockRejectedValueOnce(makeContextLengthExceededError());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'gpt-4o'
      );

      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.stopDetails).toEqual({
        type: 'context_window_exceeded',
        source: 'http_400_prompt_too_long',
      });
    });

    it('rethrows unrelated 400', async () => {
      mockResponsesCreate.mockRejectedValueOnce(makeUnrelated400());

      await expect(
        provider.createResponse([{ role: 'user', content: 'hello' }], [], 'gpt-4o')
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
