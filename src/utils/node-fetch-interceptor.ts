// ABOUTME: Node-fetch interceptor for OpenAI SDK HAR recording
// ABOUTME: Intercepts the node-fetch module that OpenAI SDK actually uses

import { getHARRecorder } from '~/utils/har-recorder';
import { logger } from '~/utils/logger';

let originalNodeFetch:
  | ((url: string | Request, init?: Record<string, unknown>) => Promise<Response>)
  | null = null;
let interceptorEnabled = false;

export async function enableNodeFetchInterception(): Promise<void> {
  if (interceptorEnabled) {
    return;
  }

  try {
    // Dynamically import node-fetch to intercept it
    const nodeFetchModule = await import('node-fetch');

    if (!nodeFetchModule || !nodeFetchModule.default) {
      logger.debug('node-fetch not available for interception');
      return;
    }

    // Store original
    originalNodeFetch = nodeFetchModule.default as unknown as typeof originalNodeFetch;
    interceptorEnabled = true;

    // Create intercepting fetch
    const interceptedNodeFetch = async function interceptedNodeFetch(
      url: string | Request,
      init?: Record<string, unknown>
    ): Promise<Response> {
      const harRecorder = getHARRecorder();

      if (!harRecorder) {
        // No HAR recording enabled, pass through
        return originalNodeFetch!(url, init);
      }

      const urlString = typeof url === 'string' ? url : url.url;
      const startTime = Date.now();

      try {
        const response = await originalNodeFetch!(url, init);
        const endTime = Date.now();

        // Clone the response before recording since the body will be consumed
        const responseForHAR = response.clone();

        // Record to HAR synchronously to ensure it completes before process exits
        try {
          await harRecorder.recordFetchRequest(
            urlString,
            init || {},
            startTime,
            responseForHAR,
            endTime
          );
        } catch (error) {
          logger.error('Failed to record node-fetch request to HAR', { error, url: urlString });
        }

        return response;
      } catch (error) {
        const endTime = Date.now();

        logger.debug('Node-fetch request failed', {
          url: urlString,
          method: init?.method || 'GET',
          error: error instanceof Error ? error.message : String(error),
          duration: `${endTime - startTime}ms`,
        });

        throw error;
      }
    };

    // Install the intercepted fetch
    nodeFetchModule.default = interceptedNodeFetch as unknown as typeof nodeFetchModule.default;

    logger.debug('Node-fetch interception enabled for HAR recording');
  } catch (error) {
    logger.debug('Failed to enable node-fetch interception', { error });
    interceptorEnabled = false;
  }
}

export async function disableNodeFetchInterception(): Promise<void> {
  if (!interceptorEnabled || !originalNodeFetch) {
    return;
  }

  try {
    const nodeFetchModule = await import('node-fetch');
    if (nodeFetchModule) {
      nodeFetchModule.default = originalNodeFetch as unknown as typeof nodeFetchModule.default;
    }
  } catch {
    // Ignore errors during cleanup
  }

  originalNodeFetch = null;
  interceptorEnabled = false;

  logger.debug('Node-fetch interception disabled');
}

export function isNodeFetchInterceptionEnabled(): boolean {
  return interceptorEnabled;
}
