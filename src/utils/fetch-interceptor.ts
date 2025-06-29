// ABOUTME: Global fetch interceptor for HAR recording
// ABOUTME: Monkey patches fetch to capture all HTTP requests for Ollama and Anthropic providers

import { getHARRecorder } from './har-recorder.js';
import { logger } from './logger.js';

let originalFetch: typeof fetch | null = null;
let interceptorEnabled = false;

export function enableFetchInterception(): void {
  if (interceptorEnabled || typeof globalThis.fetch !== 'function') {
    return;
  }

  // Store original fetch
  originalFetch = globalThis.fetch;
  interceptorEnabled = true;

  // Create intercepting fetch
  const interceptedFetch = async function interceptedFetch(
    input: string | Request | URL,
    init?: globalThis.RequestInit
  ): Promise<Response> {
    const harRecorder = getHARRecorder();

    if (!harRecorder) {
      // No HAR recording enabled, pass through
      return originalFetch!(input, init);
    }

    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const startTime = Date.now();

    try {
      const response = await originalFetch!(input, init);
      const endTime = Date.now();

      // Clone the response before recording since the body will be consumed
      const responseForHAR = response.clone();

      // Record to HAR synchronously to ensure it completes before process exits
      try {
        await harRecorder.recordFetchRequest(
          url,
          (init as Record<string, unknown>) || {},
          startTime,
          responseForHAR,
          endTime
        );
      } catch (error) {
        logger.error('Failed to record fetch request to HAR', { error, url });
      }

      return response;
    } catch (error) {
      const endTime = Date.now();

      // Log the error but don't record to HAR since we don't have a response
      logger.debug('Fetch request failed', {
        url,
        method: init?.method || 'GET',
        error: error instanceof Error ? error.message : String(error),
        duration: `${endTime - startTime}ms`,
      });

      throw error;
    }
  };

  // Mark the intercepted function and install it
  (interceptedFetch as typeof fetch & { __laceIntercepted: boolean }).__laceIntercepted = true;
  globalThis.fetch = interceptedFetch as typeof fetch;

  logger.debug('Global fetch interception enabled for HAR recording');
}

export function disableFetchInterception(): void {
  if (!interceptorEnabled || !originalFetch) {
    return;
  }

  globalThis.fetch = originalFetch;
  originalFetch = null;
  interceptorEnabled = false;

  logger.debug('Global fetch interception disabled');
}

export function isFetchInterceptionEnabled(): boolean {
  return interceptorEnabled;
}
