// ABOUTME: Tests for retry logic with exponential backoff functionality
// ABOUTME: Validates retry strategies, timing, and proper error handling

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, createRetryable, type RetryConfig } from '@/lib/retry-logic';
import { HttpError, NetworkError, AbortError } from '@/lib/api-errors';

describe('Retry Logic', () => {
  beforeEach(() => {
    // Use real timers for most tests except specific timing tests
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
        baseDelay: 10, // Very short for testing
        maxDelay: 100,
        backoffMultiplier: 2,
        jitter: false,
      };

      const result = await withRetry(fn, config);

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
        baseDelay: 10, // Use very short delays for testing
        maxDelay: 100,
        backoffMultiplier: 2,
        jitter: false,
      };

      await expect(withRetry(fn, config)).rejects.toThrow('Always fails');
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
        baseDelay: 10, // Very short for testing
        maxDelay: 100,
        backoffMultiplier: 2,
        jitter: false,
      };

      const onRetry = vi.fn();
      const result = await withRetry(fn, config, onRetry);

      expect(result).toBe('success');
      // Should be called twice (after 1st and 2nd failures)
      expect(onRetry).toHaveBeenCalledTimes(2);

      // Check delays: baseDelay * multiplier^(attempt-1)
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(NetworkError), 1, 10);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(NetworkError), 2, 20);
    });

    it('should cap delay at maxDelay', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError('Fail 1', '/api/test'))
        .mockRejectedValueOnce(new NetworkError('Fail 2', '/api/test'))
        .mockResolvedValue('success');

      const config: RetryConfig = {
        maxAttempts: 3,
        baseDelay: 50,
        maxDelay: 75, // Cap at 75ms
        backoffMultiplier: 3,
        jitter: false,
      };

      const onRetry = vi.fn();
      const result = await withRetry(fn, config, onRetry);

      expect(result).toBe('success');
      // Delay should be capped: second delay would be 50 * 3 = 150, but capped at 75
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(NetworkError), 2, 75);
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
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
        jitter: true,
      };

      const onRetry = vi.fn();
      const result = await withRetry(fn, config, onRetry);

      expect(result).toBe('success');
      // Expected: 100 * 0.85 = 85
      expect(onRetry).toHaveBeenCalledWith(expect.any(NetworkError), 1, 85);

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

      const result = await retryableFn('arg1', 'arg2');

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
