// ABOUTME: Tests that a custom OpenAI-compatible endpoint honors apiStyle:'responses'
// ABOUTME: Verifies the catalog-driven opt-in routes custom endpoints to the Responses API

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

// A gateway endpoint that is neither api.openai.com nor opted into Responses.
const CUSTOM_BASE_URL = 'https://gw.example.com/v1';

function basicResponsesPayload() {
  return {
    id: 'resp_1',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Hello from Responses.' }],
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

function basicChatCompletionsPayload() {
  return {
    id: 'chatcmpl_1',
    choices: [
      {
        message: { role: 'assistant', content: 'Hello from Chat Completions.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

describe('OpenAIProvider custom-endpoint apiStyle routing', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockChatCreate.mockReset();
    mockResponsesCreate.mockReset();
  });

  describe('custom baseURL, no apiStyle set (default)', () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: CUSTOM_BASE_URL,
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);
    });

    afterEach(() => {
      provider.removeAllListeners();
    });

    it('uses Chat Completions (unchanged default behavior)', async () => {
      mockChatCreate.mockResolvedValueOnce(basicChatCompletionsPayload());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'some-model'
      );

      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(response.content).toBe('Hello from Chat Completions.');
    });
  });

  describe("custom baseURL with apiStyle:'responses'", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: CUSTOM_BASE_URL,
        apiStyle: 'responses',
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);
    });

    afterEach(() => {
      provider.removeAllListeners();
    });

    it('routes non-streaming requests to the Responses API despite the custom baseURL', async () => {
      mockResponsesCreate.mockResolvedValueOnce(basicResponsesPayload());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'deepseek-4.1-flash'
      );

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(response.content).toBe('Hello from Responses.');
    });

    it('routes streaming requests to the Responses API despite the custom baseURL', async () => {
      const streamEvents = [
        { type: 'response.output_text.delta', delta: 'Hello from Responses.' },
        {
          type: 'response.completed',
          response: {
            id: 'resp_1',
            status: 'completed',
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
        },
      ];
      mockResponsesCreate.mockImplementation(() => {
        return (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })();
      });

      const response = await provider.createStreamingResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'deepseek-4.1-flash'
      );

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(response.content).toBe('Hello from Responses.');
    });
  });

  describe("custom baseURL with apiStyle:'responses', Responses API 404s", () => {
    let provider: OpenAIProvider;

    beforeEach(() => {
      provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: CUSTOM_BASE_URL,
        apiStyle: 'responses',
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);
    });

    afterEach(() => {
      provider.removeAllListeners();
    });

    // A catalog entry that opts a custom endpoint into Responses is declaring
    // that the endpoint speaks Responses -- it says nothing about Chat
    // Completions, which many such gateways (LunaRoute included) never
    // implement. Real OpenAI falls back to Chat Completions on a
    // "model not found"-shaped 404 because older models genuinely lack
    // Responses support but do support Chat Completions; that assumption
    // doesn't hold for a third-party gateway, so the fallback must not fire
    // here -- the original 404 should surface as-is.
    it('does NOT fall back to Chat Completions on a 404 (non-streaming)', async () => {
      const notFoundError = Object.assign(new Error('The model does not exist'), {
        status: 404,
      });
      mockResponsesCreate.mockRejectedValueOnce(notFoundError);

      await expect(
        provider.createResponse([{ role: 'user', content: 'hello' }], [], 'deepseek-4.1-flash')
      ).rejects.toThrow('The model does not exist');

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).not.toHaveBeenCalled();
    });

    it('does NOT fall back to Chat Completions on a 404 (streaming)', async () => {
      const notFoundError = Object.assign(new Error('The model does not exist'), {
        status: 404,
      });
      mockResponsesCreate.mockRejectedValueOnce(notFoundError);

      await expect(
        provider.createStreamingResponse(
          [{ role: 'user', content: 'hello' }],
          [],
          'deepseek-4.1-flash'
        )
      ).rejects.toThrow('The model does not exist');

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).not.toHaveBeenCalled();
    });
  });

  describe("custom baseURL with apiStyle:'chat' (explicit)", () => {
    it('still uses Chat Completions', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: CUSTOM_BASE_URL,
        apiStyle: 'chat',
      });
      provider.setSystemPrompt('test');
      provider.on('error', () => undefined);

      mockChatCreate.mockResolvedValueOnce(basicChatCompletionsPayload());

      const response = await provider.createResponse(
        [{ role: 'user', content: 'hello' }],
        [],
        'some-model'
      );

      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(response.content).toBe('Hello from Chat Completions.');

      provider.removeAllListeners();
    });
  });
});
