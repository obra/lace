// ABOUTME: Tests for retry functionality in OpenAIProvider
// ABOUTME: Verifies retry logic works correctly with OpenAI SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '~/providers/openai-provider';
import { ProviderMessage } from '~/providers/base-provider';

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
