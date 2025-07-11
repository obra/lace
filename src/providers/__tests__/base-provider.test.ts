// ABOUTME: Tests for retry functionality in AIProvider base class
// ABOUTME: Tests error classification, backoff calculation, and retry logic

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIProvider, ProviderMessage, ProviderResponse } from '~/providers/base-provider.js';
import { Tool } from '~/tools/tool.js';

// Mock implementation for testing
class TestProvider extends AIProvider {
  get providerName(): string {
    return 'test';
  }
  get defaultModel(): string {
    return 'test-model';
  }

  async createResponse(
    _messages: ProviderMessage[],
    _tools: Tool[],
    _signal?: AbortSignal
  ): Promise<ProviderResponse> {
    return await Promise.resolve({
      content: 'test response',
      toolCalls: [],
    });
  }

  // Expose protected methods for testing
  public isRetryableError(error: unknown): boolean {
    return super.isRetryableError(error);
  }

  public calculateBackoffDelay(attempt: number): number {
    return super.calculateBackoffDelay(attempt);
  }

  public async withRetry<T>(
    operation: () => Promise<T>,
    options?: {
      maxAttempts?: number;
      isStreaming?: boolean;
      canRetry?: () => boolean;
      signal?: AbortSignal;
    }
  ): Promise<T> {
    return super.withRetry(operation, options);
  }
}

describe('AIProvider retry functionality', () => {
  let provider: TestProvider;
  let abortController: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new TestProvider({});
    abortController = new AbortController();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      const networkErrors = [
        { code: 'ECONNREFUSED' },
        { code: 'ENOTFOUND' },
        { code: 'ETIMEDOUT' },
        { code: 'ECONNRESET' },
        { code: 'EHOSTUNREACH' },
      ];

      networkErrors.forEach((error) => {
        expect(provider.isRetryableError(error)).toBe(true);
      });
    });

    it('should identify HTTP 5xx errors as retryable', () => {
      const serverErrors = [
        { status: 500 },
        { status: 502 },
        { status: 503 },
        { status: 504 },
        { statusCode: 500 }, // Alternative property name
        { statusCode: 502 },
      ];

      serverErrors.forEach((error) => {
        expect(provider.isRetryableError(error)).toBe(true);
      });
    });

    it('should identify rate limit errors as retryable', () => {
      const rateLimitErrors = [
        { status: 429 },
        { statusCode: 429 },
        { status: 408 }, // Request timeout
      ];

      rateLimitErrors.forEach((error) => {
        expect(provider.isRetryableError(error)).toBe(true);
      });
    });

    it('should not retry authentication errors', () => {
      const authErrors = [
        { status: 401 },
        { status: 403 },
        { statusCode: 401 },
        { statusCode: 403 },
      ];

      authErrors.forEach((error) => {
        expect(provider.isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry client errors', () => {
      const clientErrors = [{ status: 400 }, { status: 404 }, { status: 422 }, { statusCode: 400 }];

      clientErrors.forEach((error) => {
        expect(provider.isRetryableError(error)).toBe(false);
      });
    });

    it('should not retry abort errors', () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      expect(provider.isRetryableError(abortError)).toBe(false);
    });

    it('should handle non-error objects gracefully', () => {
      expect(provider.isRetryableError(null)).toBe(false);
      expect(provider.isRetryableError(undefined)).toBe(false);
      expect(provider.isRetryableError('string error')).toBe(false);
      expect(provider.isRetryableError(123)).toBe(false);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate correct exponential backoff delays', () => {
      // First attempt: 1000ms base
      const delay1 = provider.calculateBackoffDelay(1);
      expect(delay1).toBeGreaterThanOrEqual(900); // With jitter
      expect(delay1).toBeLessThanOrEqual(1100);

      // Second attempt: 2000ms base
      const delay2 = provider.calculateBackoffDelay(2);
      expect(delay2).toBeGreaterThanOrEqual(1800);
      expect(delay2).toBeLessThanOrEqual(2200);

      // Third attempt: 4000ms base
      const delay3 = provider.calculateBackoffDelay(3);
      expect(delay3).toBeGreaterThanOrEqual(3600);
      expect(delay3).toBeLessThanOrEqual(4400);
    });

    it('should cap delays at maximum', () => {
      // Very high attempt number should hit the cap
      const delay = provider.calculateBackoffDelay(20);
      expect(delay).toBeGreaterThanOrEqual(27000); // 30000 - 10% jitter
      expect(delay).toBeLessThanOrEqual(33000); // 30000 + 10% jitter
    });

    it('should apply jitter to prevent thundering herd', () => {
      // Run multiple times and check for variation
      const delays = new Set();
      for (let i = 0; i < 10; i++) {
        delays.add(provider.calculateBackoffDelay(1));
      }
      // Should have multiple different values due to jitter
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry', () => {
    it('should return immediately on successful call', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await provider.withRetry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('success');

      const promise = provider.withRetry(operation);

      // Wait for first call
      await vi.advanceTimersByTimeAsync(0);
      expect(operation).toHaveBeenCalledTimes(1);

      // Advance past retry delay
      await vi.advanceTimersByTimeAsync(1500);

      const result = await promise;
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const authError = { status: 401, message: 'Unauthorized' };
      const operation = vi.fn().mockRejectedValue(authError);

      await expect(provider.withRetry(operation)).rejects.toEqual(authError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should respect max attempts', async () => {
      const operation = vi.fn().mockRejectedValue({ code: 'ECONNREFUSED' });

      const promise = provider.withRetry(operation, { maxAttempts: 3 });
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      // Advance through all retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(i === 0 ? 0 : 2000 * Math.pow(2, i - 1));
      }

      await expect(promise).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should emit retry events', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('success');

      const retryAttemptSpy = vi.fn();
      provider.on('retry_attempt', retryAttemptSpy);

      const promise = provider.withRetry(operation);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);

      await promise;

      expect(retryAttemptSpy).toHaveBeenCalledWith({
        attempt: 1,
        delay: expect.any(Number),
        error: expect.objectContaining({ code: 'ECONNREFUSED' }),
      });
    });

    it('should emit retry exhausted event', async () => {
      vi.useRealTimers(); // Use real timers for this test

      const operation = vi.fn().mockRejectedValue({ code: 'ECONNREFUSED' });

      const exhaustedSpy = vi.fn();
      const retrySpy = vi.fn();
      provider.on('retry_exhausted', exhaustedSpy);
      provider.on('retry_attempt', retrySpy);

      // Use very short retry delays for testing
      provider.RETRY_CONFIG = {
        initialDelayMs: 1,
        maxDelayMs: 2,
      };

      await expect(provider.withRetry(operation, { maxAttempts: 2 })).rejects.toMatchObject({
        code: 'ECONNREFUSED',
      });

      // Check retry was attempted
      expect(operation).toHaveBeenCalledTimes(2);
      expect(retrySpy).toHaveBeenCalledTimes(1);

      // The exhausted event should have been emitted
      expect(exhaustedSpy).toHaveBeenCalledTimes(1);
      expect(exhaustedSpy).toHaveBeenCalledWith({
        attempts: 2,
        lastError: expect.objectContaining({ code: 'ECONNREFUSED' }),
      });

      // Restore fake timers
      vi.useFakeTimers();
    });

    it('should respect abort signal', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('success');

      // Abort immediately
      abortController.abort();

      await expect(
        provider.withRetry(operation, { signal: abortController.signal })
      ).rejects.toThrow('Aborted');

      expect(operation).toHaveBeenCalledTimes(0);
    });

    it('should check abort signal between retries', async () => {
      let callCount = 0;
      const operation = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject({ code: 'ECONNREFUSED' });
      });

      const promise = provider.withRetry(operation, { signal: abortController.signal });
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);

      // Abort during retry delay
      abortController.abort();
      await vi.advanceTimersByTimeAsync(1500);

      await expect(promise).rejects.toThrow('Aborted');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle streaming with canRetry callback', async () => {
      let streamingStarted = false;
      let callCount = 0;
      const operation = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails before streaming
          return Promise.reject({ code: 'ECONNREFUSED' });
        }
        // After first retry, streaming has started
        streamingStarted = true;
        return Promise.reject({ code: 'ECONNREFUSED' });
      });

      const promise = provider.withRetry(operation, {
        isStreaming: true,
        canRetry: () => !streamingStarted,
        maxAttempts: 3,
      });
      promise.catch(() => {
        // Prevent unhandled rejection in test
      });

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      expect(callCount).toBe(1);

      // Second attempt
      await vi.advanceTimersByTimeAsync(1500);
      expect(callCount).toBe(2);

      await expect(promise).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      // Should only try twice: once initially, once after retry (then streaming started)
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should wait appropriate delay between retries', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce({ code: 'ECONNREFUSED' })
        .mockResolvedValueOnce('success');

      const promise = provider.withRetry(operation);

      // Should not retry immediately
      expect(operation).toHaveBeenCalledTimes(1);

      // Advance timers to trigger retry
      await vi.advanceTimersByTimeAsync(1500);

      await promise;
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});
