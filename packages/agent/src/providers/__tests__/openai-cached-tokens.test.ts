// ABOUTME: Tests that OpenAIProvider reports prompt-cache hits as cacheReadInputTokens on both the
// ABOUTME: Responses API and Chat Completions paths, with promptTokens holding only the uncached input.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider';

const mockResponsesCreate = vi.fn();
const mockChatCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = {
        create: mockResponsesCreate,
      };
      chat = {
        completions: {
          create: mockChatCreate,
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

// A custom baseURL routes requests to Chat Completions (see openai-provider.test.ts).
const CHAT_COMPLETIONS_BASE_URL = 'http://localhost:8080/v1';

const messages = [{ role: 'user' as const, content: 'Hello' }];

function streamOf(events: unknown[]) {
  return (async function* () {
    for (const event of events) {
      yield await Promise.resolve(event);
    }
  })();
}

function responsesApiResponse(usage: Record<string, unknown>) {
  return {
    id: 'resp_cache_1',
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi there.' }] }],
    usage,
  };
}

function responsesApiStream(usage: Record<string, unknown>) {
  return streamOf([
    { type: 'response.created', response: { id: 'resp_cache_2', status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: 'Hi there.' },
    {
      type: 'response.completed',
      response: { id: 'resp_cache_2', status: 'completed', usage },
      sequence_number: 3,
    },
  ]);
}

function chatCompletionsStream(usage: Record<string, unknown>) {
  return streamOf([
    { choices: [{ delta: { content: 'Hi there.' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage },
  ]);
}

describe('OpenAIProvider cached-token usage', () => {
  let provider: OpenAIProvider;

  afterEach(() => {
    provider.removeAllListeners();
  });

  describe('Responses API', () => {
    const cachedUsage = {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 1050,
    };
    const uncachedUsage = { input_tokens: 1000, output_tokens: 50, total_tokens: 1050 };

    beforeEach(() => {
      vi.clearAllMocks();
      provider = new OpenAIProvider({ apiKey: 'test-key' });
      provider.setSystemPrompt('Test system prompt');
    });

    it('non-streaming: splits cached_tokens out of input_tokens', async () => {
      mockResponsesCreate.mockResolvedValue(responsesApiResponse(cachedUsage));

      const response = await provider.createResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 200,
        cacheReadInputTokens: 800,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.promptTokens + response.usage!.cacheReadInputTokens!).toBe(
        cachedUsage.input_tokens
      );
    });

    it('non-streaming: leaves input_tokens whole when input_tokens_details is absent', async () => {
      mockResponsesCreate.mockResolvedValue(responsesApiResponse(uncachedUsage));

      const response = await provider.createResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.cacheReadInputTokens).toBeUndefined();
    });

    it('streaming: splits cached_tokens out of input_tokens', async () => {
      mockResponsesCreate.mockImplementation(() => responsesApiStream(cachedUsage));

      const response = await provider.createStreamingResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 200,
        cacheReadInputTokens: 800,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.promptTokens + response.usage!.cacheReadInputTokens!).toBe(
        cachedUsage.input_tokens
      );
    });

    it('streaming: leaves input_tokens whole when input_tokens_details is absent', async () => {
      mockResponsesCreate.mockImplementation(() => responsesApiStream(uncachedUsage));

      const response = await provider.createStreamingResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.cacheReadInputTokens).toBeUndefined();
    });

    it('clamps promptTokens at 0 when a gateway reports more cached tokens than input', async () => {
      mockResponsesCreate.mockResolvedValue(
        responsesApiResponse({
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 120 },
          output_tokens: 5,
          total_tokens: 105,
        })
      );

      const response = await provider.createResponse(messages, [], 'gpt-4o');

      expect(response.usage!.promptTokens).toBe(0);
      expect(response.usage!.cacheReadInputTokens).toBe(120);
    });
  });

  describe('Chat Completions', () => {
    const cachedUsage = {
      prompt_tokens: 1000,
      prompt_tokens_details: { cached_tokens: 800 },
      completion_tokens: 50,
      total_tokens: 1050,
    };
    const uncachedUsage = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };

    beforeEach(() => {
      vi.clearAllMocks();
      provider = new OpenAIProvider({ apiKey: 'test-key', baseURL: CHAT_COMPLETIONS_BASE_URL });
      provider.setSystemPrompt('Test system prompt');
    });

    it('non-streaming: splits cached_tokens out of prompt_tokens', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi there.' }, finish_reason: 'stop' }],
        usage: cachedUsage,
      });

      const response = await provider.createResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 200,
        cacheReadInputTokens: 800,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.promptTokens + response.usage!.cacheReadInputTokens!).toBe(
        cachedUsage.prompt_tokens
      );
    });

    it('non-streaming: leaves prompt_tokens whole when prompt_tokens_details is absent', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hi there.' }, finish_reason: 'stop' }],
        usage: uncachedUsage,
      });

      const response = await provider.createResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.cacheReadInputTokens).toBeUndefined();
    });

    it('streaming: splits cached_tokens out of prompt_tokens', async () => {
      mockChatCreate.mockImplementation(() => chatCompletionsStream(cachedUsage));

      const response = await provider.createStreamingResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 200,
        cacheReadInputTokens: 800,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.promptTokens + response.usage!.cacheReadInputTokens!).toBe(
        cachedUsage.prompt_tokens
      );
    });

    it('streaming: leaves prompt_tokens whole when prompt_tokens_details is absent', async () => {
      mockChatCreate.mockImplementation(() => chatCompletionsStream(uncachedUsage));

      const response = await provider.createStreamingResponse(messages, [], 'gpt-4o');

      expect(response.usage).toEqual({
        promptTokens: 1000,
        completionTokens: 50,
        totalTokens: 1050,
      });
      expect(response.usage!.cacheReadInputTokens).toBeUndefined();
    });
  });
});
