// ABOUTME: Tests for retry functionality in OpenAIProvider
// ABOUTME: Verifies retry logic works correctly with OpenAI SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from './openai-provider';
import { ProviderMessage } from './base-provider';
import { logger } from '@lace/agent/utils/logger';

// Test helper to capture retry behavior
interface RetryCapture {
  attempts: number;
  errors: unknown[];
  delays: number[];
  finalSuccess: boolean;
}

function createRetryCapture(): RetryCapture {
  return {
    attempts: 0,
    errors: [],
    delays: [],
    finalSuccess: false,
  };
}

// Create mock functions that we'll reference
const mockCreate = vi.fn();
const mockResponsesCreate = vi.fn();

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
    responses: {
      create: mockResponsesCreate,
    },
  }));

  return { default: MockOpenAI };
});

// Mock logger so the gateway-retry warning can be asserted without polluting test output
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

// These tests exercise retry behavior on the Chat Completions API path. Production prefers
// the Responses API by default; we force the chat.completions fallback by configuring a
// custom baseURL, which makes OpenAIProvider.isCustomEndpoint() return true.
describe('OpenAIProvider retry functionality', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset the mocks before each test
    mockCreate.mockReset();
    mockResponsesCreate.mockReset();

    provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: 'http://localhost:8080/v1',
    });

    // Add error handlers to prevent unhandled errors in tests
    provider.on('error', () => {
      // Empty handler to prevent unhandled errors in tests
    });
    provider.on('retry_attempt', () => {
      // Empty handler to prevent unhandled errors in tests
    });
    provider.on('retry_exhausted', () => {
      // Empty handler to prevent unhandled errors in tests
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createResponse retry behavior', () => {
    it('should retry on network errors', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // First call fails with network error, second succeeds
      mockCreate.mockRejectedValueOnce({ code: 'ECONNREFUSED' }).mockResolvedValueOnce({
        choices: [
          {
            message: { content: 'Hello there!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const promise = provider.createResponse(messages, [], 'gpt-4o');
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      // Track retry behavior
      const retryCapture = createRetryCapture();
      provider.on('retry_attempt', (event: { error: unknown; delay: number }) => {
        retryCapture.attempts++;
        retryCapture.errors.push(event.error);
        retryCapture.delays.push(event.delay);
      });

      // Wait for first attempt
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;
      retryCapture.finalSuccess = true;

      // Test actual retry behavior
      expect(retryCapture.attempts).toBe(1); // One retry after initial failure
      expect(retryCapture.errors).toHaveLength(1);
      expect(retryCapture.errors[0]).toMatchObject({ code: 'ECONNREFUSED' });
      expect(retryCapture.delays[0]).toBeGreaterThan(0);
      expect(retryCapture.finalSuccess).toBe(true);
      expect(response.content).toBe('Hello there!');
    });

    it('should emit retry events', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockCreate
        .mockRejectedValueOnce({ status: 503, message: 'Service Unavailable' })
        .mockResolvedValueOnce({
          choices: [
            {
              message: { content: 'Hello!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });

      const retryAttemptSpy = vi.fn();
      provider.on('retry_attempt', retryAttemptSpy);

      const promise = provider.createResponse(messages, [], 'gpt-4o');
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);

      await promise;

      // Test that retry events are properly emitted with correct data
      expect(retryAttemptSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          delay: expect.any(Number) as number,
          error: expect.objectContaining({ status: 503 }) as object,
        })
      );
      expect(retryAttemptSpy).toHaveBeenCalledTimes(1);
    });

    it('should not retry on authentication errors', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const authError = { status: 401, message: 'Invalid API key' };
      mockCreate.mockRejectedValue(authError);

      // Track retry behavior
      const retryCapture = createRetryCapture();
      provider.on('retry_attempt', (event: { error: unknown }) => {
        retryCapture.attempts++;
        retryCapture.errors.push(event.error);
      });

      await expect(provider.createResponse(messages, [], 'gpt-4o')).rejects.toEqual(authError);

      // Test that no retry was attempted for auth error
      expect(retryCapture.attempts).toBe(0);
      expect(retryCapture.errors).toHaveLength(0);
    });

    it('should use full 10 retry attempts', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      mockCreate.mockRejectedValue({ code: 'ETIMEDOUT' });

      const exhaustedSpy = vi.fn();
      provider.on('retry_exhausted', exhaustedSpy);

      // Use real timers for this test to avoid complexity
      vi.useRealTimers();

      // Reduce delays for faster testing
      provider.RETRY_CONFIG = {
        initialDelayMs: 1,
        maxDelayMs: 2,
      };

      await expect(provider.createResponse(messages, [], 'gpt-4o')).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });

      // Test that exhausted event reports correct attempt count and error
      expect(exhaustedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 10,
          lastError: expect.objectContaining({ code: 'ETIMEDOUT' }) as object,
        })
      );
      expect(exhaustedSpy).toHaveBeenCalledTimes(1);

      // Restore fake timers
      vi.useFakeTimers();
    });
  });

  // PRI-3609: LunaRoute intermittently answers 404 "The model '<id>' does not
  // exist" for a model it lists. On a custom base URL that one shape is retried,
  // a few times at most; every other 404, and any 404 from api.openai.com, is not.
  describe('gateway model-not-found 404', () => {
    const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

    function modelNotFoundError(): Error & { status: number; code: string | null } {
      return Object.assign(new Error("404 The model 'glm-5.3-vision' does not exist"), {
        status: 404,
        code: null,
      });
    }

    function gatewayProvider(): OpenAIProvider {
      const gateway = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: 'https://gw.lunaroute.com/v1',
        apiStyle: 'responses',
      });
      gateway.setSystemPrompt('test');
      gateway.on('retry_attempt', () => {});
      gateway.on('retry_exhausted', () => {});
      return gateway;
    }

    const responsesSuccess = {
      id: 'resp_1',
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello!' }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };

    function gatewayRetryWarnings(): unknown[][] {
      return vi
        .mocked(logger.warn)
        .mock.calls.filter(([message]) => /gateway model-not-found/i.test(String(message)));
    }

    it('retries on a custom base URL and succeeds on the next attempt', async () => {
      const gateway = gatewayProvider();
      mockResponsesCreate
        .mockRejectedValueOnce(modelNotFoundError())
        .mockResolvedValueOnce(responsesSuccess);

      const promise = gateway.createResponse(messages, [], 'glm-5.3-vision');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;
      expect(response.content).toBe('Hello!');
      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(gatewayRetryWarnings()).toHaveLength(1);
      expect(gatewayRetryWarnings()[0]?.[1]).toMatchObject({
        baseURL: 'https://gw.lunaroute.com/v1',
        attempt: 1,
        maxAttempts: 3,
        error: "404 The model 'glm-5.3-vision' does not exist",
      });
    });

    it('retries the error code model_not_found on a custom base URL', async () => {
      const gateway = gatewayProvider();
      mockResponsesCreate
        .mockRejectedValueOnce({ status: 404, message: '404 Not Found', code: 'model_not_found' })
        .mockResolvedValueOnce(responsesSuccess);

      const promise = gateway.createResponse(messages, [], 'glm-5.3-vision');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);

      expect((await promise).content).toBe('Hello!');
      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
      expect(gatewayRetryWarnings()).toHaveLength(1);
    });

    it('does not retry on the default OpenAI endpoint', async () => {
      const openai = new OpenAIProvider({ apiKey: 'test-key' });
      openai.setSystemPrompt('test');
      const retryAttemptSpy = vi.fn();
      openai.on('retry_attempt', retryAttemptSpy);
      const error = modelNotFoundError();
      // The default endpoint tries Responses, then falls back to Chat Completions
      // once on a "does not exist" 404. Neither call is retried.
      mockResponsesCreate.mockRejectedValue(error);
      mockCreate.mockRejectedValue(error);

      await expect(openai.createResponse(messages, [], 'gpt-nope')).rejects.toBe(error);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(retryAttemptSpy).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not retry on a base URL that points at api.openai.com', async () => {
      const openai = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: 'https://api.openai.com/v1',
      });
      openai.setSystemPrompt('test');
      const error = modelNotFoundError();
      mockResponsesCreate.mockRejectedValue(error);
      mockCreate.mockRejectedValue(error);

      await expect(openai.createResponse(messages, [], 'gpt-nope')).rejects.toBe(error);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not retry a different 404 on a custom base URL', async () => {
      const gateway = gatewayProvider();
      const retryAttemptSpy = vi.fn();
      gateway.on('retry_attempt', retryAttemptSpy);
      const error = Object.assign(new Error('404 Not Found'), { status: 404, code: null });
      mockResponsesCreate.mockRejectedValue(error);

      await expect(gateway.createResponse(messages, [], 'glm-5.3-vision')).rejects.toBe(error);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(retryAttemptSpy).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('stops after three attempts and surfaces the original error', async () => {
      vi.useRealTimers();
      const gateway = gatewayProvider();
      gateway.RETRY_CONFIG = { initialDelayMs: 1, maxDelayMs: 2 };
      const exhaustedSpy = vi.fn();
      gateway.on('retry_exhausted', exhaustedSpy);
      const error = modelNotFoundError();
      mockResponsesCreate.mockRejectedValue(error);

      await expect(gateway.createResponse(messages, [], 'glm-5.3-vision')).rejects.toBe(error);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
      expect(exhaustedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 3, lastError: error })
      );
      // One warning per retry: attempts 1 and 2 were retried, attempt 3 was not.
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(gatewayRetryWarnings()).toHaveLength(2);
      vi.useFakeTimers();
    });
  });

  describe('createStreamingResponse retry behavior', () => {
    it('should retry streaming requests before first token', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Mock the first call to create() to throw immediately (before stream is created)
      const networkError = new Error('Connection failed');
      (networkError as Error & { code: string }).code = 'ECONNRESET';

      // Create a successful stream for the retry
      const successStream = (function* () {
        yield {
          choices: [
            {
              delta: { content: 'Hello ' },
              finish_reason: null,
            },
          ],
        };
        yield {
          choices: [
            {
              delta: { content: 'world!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
      })();

      mockCreate.mockRejectedValueOnce(networkError).mockReturnValueOnce(successStream);

      const promise = provider.createStreamingResponse(messages, [], 'gpt-4o');

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      // Test that streaming retry worked correctly
      expect(response.content).toBe('Hello world!');
      // The retry should have occurred before streaming started
      expect(response).toBeTruthy();
    });

    it('should not retry after streaming has started', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Create a stream that starts then fails
      const stream = (function* () {
        yield {
          choices: [
            {
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        };
        // Then fail
        const error = new Error('ECONNRESET');
        (error as Error & { code: string }).code = 'ECONNRESET';
        throw error;
      })();

      mockCreate.mockReturnValue(stream);

      // Listen for token events to detect streaming started
      let streamingStarted = false;
      provider.on('token', () => {
        streamingStarted = true;
      });

      await expect(provider.createStreamingResponse(messages, [], 'gpt-4o')).rejects.toMatchObject({
        code: 'ECONNRESET',
      });

      // Should only try once since streaming started
      expect(streamingStarted).toBe(true);
      // No retry should occur after streaming begins
    });
  });
});
