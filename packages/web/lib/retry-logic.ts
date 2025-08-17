// ABOUTME: Retry logic with exponential backoff for failed API requests
// ABOUTME: Provides configurable retry strategies with proper error classification

import { isRetryableError, type ApiError } from './api-errors';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
  jitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Calculate delay for next retry with exponential backoff
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at max delay
  delay = Math.min(delay, config.maxDelay);

  // Add jitter to prevent thundering herd
  if (config.jitter) {
    delay = delay * (0.5 + Math.random() * 0.5);
  }

  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (error: ApiError, attempt: number, nextDelay: number) => void
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if this is the last attempt
      if (attempt === config.maxAttempts) {
        break;
      }

      // Don't retry non-retryable errors
      if (!isRetryableError(error)) {
        break;
      }

      const delay = calculateDelay(attempt, config);

      // Notify about retry
      if (onRetry && isRetryableError(error)) {
        onRetry(error, attempt, delay);
      }

      // Wait before retry
      await sleep(delay);
    }
  }

  // All retries failed
  throw lastError;
}

/**
 * Create a retryable version of an async function
 */
export function createRetryable<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
) {
  return async (...args: TArgs): Promise<TReturn> => {
    return withRetry(() => fn(...args), config);
  };
}
