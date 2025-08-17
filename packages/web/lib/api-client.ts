// ABOUTME: Centralized API client that enforces correct error handling patterns
// ABOUTME: Prevents JSON parsing of HTML error pages by checking HTTP status first

import { parseResponse } from '@/lib/serialization';
import { isApiError } from '@/types/api';
import { HttpError, NetworkError, AbortError, ParseError, BusinessError } from './api-errors';
import { withRetry, DEFAULT_RETRY_CONFIG, type RetryConfig } from './retry-logic';

export interface ApiClientOptions {
  retryConfig?: RetryConfig;
  timeout?: number;
}

/**
 * Internal implementation - enforces correct error handling pattern with structured errors
 */
async function makeRequest<T>(
  url: string,
  options?: RequestInit,
  clientOptions?: ApiClientOptions
): Promise<T> {
  // Only add timeout if explicitly requested
  const timeout = clientOptions?.timeout;
  let timeoutController: AbortController | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  // Setup timeout if requested
  if (timeout) {
    timeoutController = new AbortController();
    timeoutId = setTimeout(() => timeoutController!.abort(), timeout);
  }

  // Combine user abort signal with timeout
  const userSignal = options?.signal;
  let combinedSignal: AbortSignal | undefined;
  let cleanup: (() => void) | null = null;

  try {
    if (userSignal || timeoutController) {
      if (userSignal && userSignal.aborted) {
        if (timeoutId) clearTimeout(timeoutId);
        throw new AbortError(url, { reason: 'User aborted' });
      }

      // If both user signal and timeout exist, combine them
      if (userSignal && timeoutController) {
        // Use AbortSignal.any if available, otherwise create manual combination
        if (typeof AbortSignal.any === 'function') {
          combinedSignal = AbortSignal.any([userSignal, timeoutController.signal]);
        } else {
          // Fallback for older Node.js versions
          const controller = new AbortController();
          combinedSignal = controller.signal;

          const abortBoth = () => controller.abort();
          userSignal.addEventListener('abort', abortBoth, { once: true });
          timeoutController.signal.addEventListener('abort', abortBoth, { once: true });

          // Store cleanup function
          cleanup = () => {
            userSignal.removeEventListener('abort', abortBoth);
            timeoutController.signal.removeEventListener('abort', abortBoth);
          };
        }
      } else {
        // Use whichever signal exists
        combinedSignal = userSignal || timeoutController!.signal;
      }
    }

    const response = await fetch(url, {
      ...options,
      ...(combinedSignal && { signal: combinedSignal }),
    });

    // Check HTTP status first - never parse error pages
    if (!response.ok) {
      throw new HttpError(response.status, response.statusText, url);
    }

    // Only parse when we know it's a successful response
    let data: T;
    try {
      data = await parseResponse<T>(response);
    } catch (parseError) {
      const responseText = await response.text().catch(() => '<unable to read response>');
      throw new ParseError(
        `Failed to parse response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        url,
        responseText
      );
    }

    // Check for API business logic errors
    if (isApiError(data)) {
      throw new BusinessError(data.error || 'API returned error', data.code);
    }

    return data;
  } catch (error) {
    // Handle different error types
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AbortError(url, { reason: 'Request aborted or timed out' });
    }

    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new NetworkError('Network request failed', url, error);
    }

    // Re-throw our structured errors as-is
    if (
      error instanceof HttpError ||
      error instanceof ParseError ||
      error instanceof BusinessError
    ) {
      throw error;
    }

    // Wrap unknown errors
    throw new NetworkError(
      error instanceof Error ? error.message : String(error),
      url,
      error instanceof Error ? error : undefined
    );
  } finally {
    // Always clean up
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (cleanup) {
      cleanup();
    }
  }
}

/**
 * The standard API client for this application.
 * Use these methods for all API calls to ensure proper error handling with retry logic.
 */
export const api = {
  get: <T>(
    url: string,
    options?: Omit<RequestInit, 'method'>,
    clientOptions?: ApiClientOptions
  ) => {
    // Only use retry if explicitly configured
    if (clientOptions?.retryConfig) {
      return withRetry(
        () => makeRequest<T>(url, { ...options, method: 'GET' }, clientOptions),
        clientOptions.retryConfig
      );
    }
    return makeRequest<T>(url, { ...options, method: 'GET' }, clientOptions);
  },

  post: <T>(
    url: string,
    body?: unknown,
    options?: Omit<RequestInit, 'method' | 'body'>,
    clientOptions?: ApiClientOptions
  ) => {
    const requestOptions = {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    // Only use retry if explicitly configured
    if (clientOptions?.retryConfig) {
      return withRetry(
        () => makeRequest<T>(url, requestOptions, clientOptions),
        clientOptions.retryConfig
      );
    }
    return makeRequest<T>(url, requestOptions, clientOptions);
  },

  put: <T>(
    url: string,
    body?: unknown,
    options?: Omit<RequestInit, 'method' | 'body'>,
    clientOptions?: ApiClientOptions
  ) => {
    const requestOptions = {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    // Only use retry if explicitly configured
    if (clientOptions?.retryConfig) {
      return withRetry(
        () => makeRequest<T>(url, requestOptions, clientOptions),
        clientOptions.retryConfig
      );
    }
    return makeRequest<T>(url, requestOptions, clientOptions);
  },

  patch: <T>(
    url: string,
    body?: unknown,
    options?: Omit<RequestInit, 'method' | 'body'>,
    clientOptions?: ApiClientOptions
  ) => {
    const requestOptions = {
      ...options,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    };

    // Only use retry if explicitly configured
    if (clientOptions?.retryConfig) {
      return withRetry(
        () => makeRequest<T>(url, requestOptions, clientOptions),
        clientOptions.retryConfig
      );
    }
    return makeRequest<T>(url, requestOptions, clientOptions);
  },

  delete: <T>(
    url: string,
    options?: Omit<RequestInit, 'method'>,
    clientOptions?: ApiClientOptions
  ) => {
    // Only use retry if explicitly configured
    if (clientOptions?.retryConfig) {
      return withRetry(
        () => makeRequest<T>(url, { ...options, method: 'DELETE' }, clientOptions),
        clientOptions.retryConfig
      );
    }
    return makeRequest<T>(url, { ...options, method: 'DELETE' }, clientOptions);
  },
} as const;
