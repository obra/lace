// ABOUTME: Tests for retry logic with exponential backoff functionality
// ABOUTME: Validates retry strategies, timing, and proper error handling

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, createRetryable, DEFAULT_RETRY_CONFIG, type RetryConfig } from '../retry-logic';
import { HttpError, NetworkError, AbortError } from '../api-errors';

describe('Retry Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('withRetry', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable errors', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Network failed', '/api/test'))
        .mockRejectedValueOnce(new HttpError(500, 'Server Error', '/api/test'))
        .mockResolvedValue('success');

      const config: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
        jitter: false,
      };

      const promise = withRetry(fn, config);

      // Fast-forward through delays and wait for promise resolution
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new AbortError('/api/test'));

      await expect(withRetry(fn)).rejects.toThrow('Request was aborted');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect max attempts', async () => {
      const error = new NetworkError('Always fails', '/api/test');
      const fn = vi.fn().mockRejectedValue(error);

      const config: RetryConfig = {
        maxAttempts: 2,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
        jitter: false,
      };

      const promise = withRetry(fn, config);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail 1', '/api/test'))
        .mockRejectedValueOnce(new NetworkError('Fail 2', '/api/test'))
        .mockResolvedValue('success');

      const config: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 100,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: false,
      };

      const onRetry = vi.fn();
      const promise = withRetry(fn, config, onRetry);

      vi.runAllTimers();
      await promise;

      // Should be called twice (after 1st and 2nd failures)
      expect(onRetry).toHaveBeenCalledTimes(2);

      // Check delays: baseDelay * multiplier^(attempt-1)
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(NetworkError), 1, 100);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(NetworkError), 2, 200);
    });

    it('should cap delay at maxDelay', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail 1', '/api/test'))
        .mockRejectedValueOnce(new NetworkError('Fail 2', '/api/test'))
        .mockResolvedValue('success');

      const config: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 1500, // Cap at 1.5 seconds
        backoffMultiplier: 3,
        jitter: false,
      };

      const onRetry = vi.fn();
      const promise = withRetry(fn, config, onRetry);

      vi.runAllTimers();
      await promise;

      // Delay should be capped: second delay would be 1000 * 3 = 3000, but capped at 1500
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(NetworkError), 2, 1500);
    });

    it('should apply jitter when enabled', async () => {
      // Mock Math.random to return consistent value
      const originalRandom = Math.random;
      Math.random = vi.fn().mockReturnValue(0.7); // Will produce 0.5 + 0.7 * 0.5 = 0.85 multiplier

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail', '/api/test'))
        .mockResolvedValue('success');

      const config: RetryConfig = {
        maxAttempts: 2,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true,
      };

      const onRetry = vi.fn();
      const promise = withRetry(fn, config, onRetry);

      vi.runAllTimers();
      await promise;

      // Expected: 1000 * 0.85 = 850
      expect(onRetry).toHaveBeenCalledWith(expect.any(NetworkError), 1, 850);

      Math.random = originalRandom;
    });
  });

  describe('createRetryable', () => {
    it('should create retryable version of function', async () => {
      const originalFn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail', '/api/test'))
        .mockResolvedValue('success');

      const retryableFn = createRetryable(originalFn, {
        maxAttempts: 2,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
        jitter: false,
      });

      const promise = retryableFn('arg1', 'arg2');
      vi.runAllTimers();

      const result = await promise;

      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledTimes(2);
      expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle synchronous errors', async () => {
      const error = new Error('Sync error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      await expect(withRetry(fn)).rejects.toThrow('Sync error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(withRetry(fn)).rejects.toThrow('string error');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
