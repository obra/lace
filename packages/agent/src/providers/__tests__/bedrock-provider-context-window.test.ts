// ABOUTME: Integration tests for BedrockProvider classifying HTTP 400 "prompt too long"
// ABOUTME: as a synthetic context_window_exceeded ProviderResponse instead of throwing

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BedrockProvider } from '../bedrock-provider';

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/bedrock-sdk', () => {
  class MockAnthropicBedrock {
    constructor(_opts: unknown) {}
    messages = {
      create: mockCreate,
      stream: mockStream,
    };
  }
  return {
    AnthropicBedrock: MockAnthropicBedrock,
    default: MockAnthropicBedrock,
  };
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

const MODEL = 'anthropic.claude-sonnet-4-5-20250929-v1:0';

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

function makeUnrelated400(): unknown {
  return {
    status: 400,
    error: {
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'some other validation failure',
      },
    },
    type: 'invalid_request_error',
    message: 'some other validation failure',
  };
}

describe('BedrockProvider context-window classification', () => {
  let provider: BedrockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockStream.mockReset();

    provider = new BedrockProvider({
      awsRegion: 'us-west-1',
      awsAccessKeyId: 'AKIATEST',
      awsSecretAccessKey: 'secret',
    });
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
        MODEL
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

    it('rethrows unrelated 400', async () => {
      mockCreate.mockRejectedValueOnce(makeUnrelated400());

      await expect(
        provider.createResponse([{ role: 'user', content: 'hello' }], [], MODEL)
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('streaming', () => {
    it('returns synthetic context_window_exceeded for prompt-too-long during stream finalization', async () => {
      mockStream.mockReturnValueOnce({
        on: vi.fn().mockReturnThis(),
        finalMessage: vi.fn().mockRejectedValue(makePromptTooLongError()),
      });

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'hi' }],
        [],
        MODEL
      );

      expect(response.stopReason).toBe('context_window_exceeded');
      expect(response.content).toBe('');
    });
  });
});
