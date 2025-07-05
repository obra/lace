// ABOUTME: Tests for retry functionality in AnthropicProvider
// ABOUTME: Verifies retry logic works correctly with Anthropic SDK

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';
import { ProviderMessage } from '../base-provider.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const mockStream = vi.fn();

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

  // Add these as static properties so we can access them in tests
  MockAnthropic.mockCreate = mockCreate;
  MockAnthropic.mockStream = mockStream;

  return { default: MockAnthropic };
});

describe('AnthropicProvider retry functionality', () => {
  let provider: AnthropicProvider;
  let mockCreate: any;
  let mockStream: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Get references to the mocked methods
    mockCreate = (Anthropic as any).mockCreate;
    mockStream = (Anthropic as any).mockStream;

    // Reset the mocks before each test
    mockCreate.mockReset();
    mockStream.mockReset();

    provider = new AnthropicProvider({
      apiKey: 'test-key',
    });

    // Add error handler to prevent unhandled errors in tests
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
        content: [{ type: 'text', text: 'Hello there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
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
          content: [{ type: 'text', text: 'Hello!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
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
      provider.RETRY_CONFIG.initialDelayMs = 1;
      provider.RETRY_CONFIG.maxDelayMs = 2;

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

      // Create a mock stream that fails first time
      const failingStream = {
        on: vi.fn(),
        finalMessage: vi.fn().mockRejectedValue({ code: 'ECONNRESET' }),
      };

      // Create a successful stream
      const successStream = {
        on: vi.fn((event, handler) => {
          if (event === 'text') {
            // Simulate some text events
            setTimeout(() => handler('Hello '), 10);
            setTimeout(() => handler('world!'), 20);
          }
        }),
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello world!' }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        }),
      };

      mockStream.mockReturnValueOnce(failingStream).mockReturnValueOnce(successStream);

      const promise = provider.createStreamingResponse(messages, []);

      // Wait for first attempt to fail
      await vi.advanceTimersByTimeAsync(0);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1100);

      const response = await promise;

      expect(mockStream).toHaveBeenCalledTimes(2);
      expect(response.content).toBe('Hello world!');
    });

    it('should not retry after streaming has started', async () => {
      const messages: ProviderMessage[] = [{ role: 'user', content: 'Hello' }];

      let textHandlers: ((text: string) => void)[] = [];

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
