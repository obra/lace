// ABOUTME: Tests for retry functionality in AnthropicProvider
// ABOUTME: Verifies retry logic works correctly with Anthropic SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '~/providers/anthropic-provider.js';
import { ProviderMessage } from '~/providers/base-provider.js';

// Create mock functions that we'll reference
const mockCreate = vi.fn();
const mockStream = vi.fn();

// Mock the Anthropic SDK
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

describe('AnthropicProvider retry functionality', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset the mocks before each test
    mockCreate.mockReset();
    mockStream.mockReset();

    provider = new AnthropicProvider({
      apiKey: 'test-key',
    });

    // Add error handler to prevent unhandled errors in tests
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
        content: [{ type: 'text', text: 'Hello there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const promise = provider.createResponse(messages, []);
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

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
          content: [{ type: 'text', text: 'Hello!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        });

      const retryAttemptSpy = vi.fn();
      provider.on('retry_attempt', retryAttemptSpy);

      const promise = provider.createResponse(messages, []);
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);

      await promise;

      expect(retryAttemptSpy).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number) as number,
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
        lastError: expect.objectContaining({ code: 'ETIMEDOUT' }) as Error,
      });

      // Restore fake timers
      vi.useFakeTimers();
    });
  });

  describe('createStreamingResponse retry behavior', () => {
    it('should retry streaming requests before first token', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      // First call throws with network error, second call succeeds with stream
      const networkError = new Error('Connection failed') as Error & { code: string };
      networkError.code = 'ECONNRESET';

      // Create a proper stream mock for the successful retry
      const successfulStream = {
        on: vi.fn((event: string, handler: (text: string) => void) => {
          if (event === 'text') {
            // Simulate some text events synchronously for testing
            handler('Hello ');
            handler('world!');
          }
          // Return the mock function to allow chaining
          return successfulStream;
        }),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello world!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };

      // Mock the stream method: first call throws, second call returns working stream
      mockStream
        .mockImplementationOnce(() => {
          throw networkError;
        })
        .mockImplementationOnce(() => successfulStream);

      const promise = provider.createStreamingResponse(messages, []);
      promise.catch(() => {
        // Prevent unhandled rejection in test
      }); // during retry

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);
      expect(mockStream).toHaveBeenCalledTimes(1);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockStream).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello world!');
    });

    it('should not retry after streaming has started', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      const textHandlers: ((text: string) => void)[] = [];

      // Create a stream that starts then fails
      const stream = {
        on: vi.fn((event, handler) => {
          if (event === 'text') {
            textHandlers.push(handler);
          }
        }),
        finalMessage: vi.fn().mockImplementation(async () => {
          // Emit some text first
          textHandlers.forEach((handler) => handler('Hello'));
          // Then fail
          throw { code: 'ECONNRESET' };
        }),
      };

      mockStream.mockReturnValue(stream);

      // Listen for token events to detect streaming started
      let streamingStarted = false;
      provider.on('token', () => {
        streamingStarted = true;
      });

      await expect(provider.createStreamingResponse(messages, [])).rejects.toMatchObject({
        code: 'ECONNRESET',
      });

      // Should only try once since streaming started
      expect(mockStream).toHaveBeenCalledTimes(1);
      expect(streamingStarted).toBe(true);
    });
  });
});
