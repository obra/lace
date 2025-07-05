// ABOUTME: Tests for retry functionality in OpenAIProvider
// ABOUTME: Verifies retry logic works correctly with OpenAI SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai-provider.js';
import { ProviderMessage } from '../base-provider.js';

// Create mock function that we'll reference
const mockCreate = vi.fn();

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }));

  return { default: MockOpenAI };
});

describe('OpenAIProvider retry functionality', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset the mock before each test
    mockCreate.mockReset();

    provider = new OpenAIProvider({
      apiKey: 'test-key',
    });

    // Add error handlers to prevent unhandled errors in tests
    provider.on('error', () => {});
    provider.on('retry_attempt', () => {});
    provider.on('retry_exhausted', () => {});
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

      const promise = provider.createResponse(messages, []);
      promise.catch(() => {}); // Prevent unhandled rejection

      // Wait for first attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
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

      const promise = provider.createResponse(messages, []);
      promise.catch(() => {}); // Prevent unhandled rejection

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);

      await promise;

      expect(retryAttemptSpy).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number),
        error: expect.objectContaining({ status: 503 }),
      });
    });

    it('should not retry on authentication errors', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const authError = { status: 401, message: 'Invalid API key' };
      mockCreate.mockRejectedValue(authError);

      await expect(provider.createResponse(messages, [])).rejects.toEqual(authError);
      expect(mockCreate).toHaveBeenCalledTimes(1);
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

      await expect(provider.createResponse(messages, [])).rejects.toMatchObject({
        code: 'ETIMEDOUT',
      });

      expect(mockCreate).toHaveBeenCalledTimes(10);
      expect(exhaustedSpy).toHaveBeenCalledWith({
        attempts: 10,
        lastError: expect.objectContaining({ code: 'ETIMEDOUT' }),
      });

      // Restore fake timers
      vi.useFakeTimers();
    });
  });

  describe('createStreamingResponse retry behavior', () => {
    it('should retry streaming requests before first token', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Mock the first call to create() to throw immediately (before stream is created)
      const networkError = new Error('Connection failed');
      (networkError as any).code = 'ECONNRESET';

      // Create a successful stream for the retry
      const successStream = (async function* () {
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

      const promise = provider.createStreamingResponse(messages, []);

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello world!');
    });

    it('should not retry after streaming has started', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // Create a stream that starts then fails
      const stream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        };
        // Then fail
        throw { code: 'ECONNRESET' };
      })();

      mockCreate.mockReturnValue(stream);

      // Listen for token events to detect streaming started
      let streamingStarted = false;
      provider.on('token', () => {
        streamingStarted = true;
      });

      await expect(provider.createStreamingResponse(messages, [])).rejects.toMatchObject({
        code: 'ECONNRESET',
      });

      // Should only try once since streaming started
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(streamingStarted).toBe(true);
    });
  });
});
