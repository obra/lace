// ABOUTME: Global fetch interceptor for HAR recording
// ABOUTME: Monkey patches fetch to capture all HTTP requests for Ollama and Anthropic providers

import { getHARRecorder } from '~/utils/har-recorder.js';
import { logger } from '~/utils/logger.js';

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
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const startTime = Date.now();

    try {
      const response = await originalFetch!(input, init);
      const endTime = Date.now();

      // Clone the response before recording since the body will be consumed
      const responseForHAR = response.clone();

      // Record to HAR synchronously to ensure it completes before process exits
      try {
        // Safely convert init to Record format for HAR recording
        const initWithCache = init as RequestInit & { cache?: string };
        const initRecord: Record<string, unknown> = init
          ? {
              method: init.method,
              headers: init.headers,
              body: init.body,
              ...(initWithCache.cache && { cache: initWithCache.cache }),
              ...(init.credentials && { credentials: init.credentials }),
              ...(init.mode && { mode: init.mode }),
              ...(init.redirect && { redirect: init.redirect }),
              ...(init.referrer && { referrer: init.referrer }),
              ...(init.referrerPolicy && { referrerPolicy: init.referrerPolicy }),
              ...(init.signal && { signal: init.signal }),
              ...(init.integrity && { integrity: init.integrity }),
              ...(init.keepalive && { keepalive: init.keepalive }),
            }
          : {};

        await harRecorder.recordFetchRequest(url, initRecord, startTime, responseForHAR, endTime);
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
  const typedInterceptedFetch = interceptedFetch as typeof fetch & { __laceIntercepted: boolean };
  typedInterceptedFetch.__laceIntercepted = true;
  globalThis.fetch = typedInterceptedFetch;

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
