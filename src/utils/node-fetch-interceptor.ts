// ABOUTME: Node-fetch interceptor for OpenAI SDK HAR recording
// ABOUTME: Intercepts the node-fetch module that OpenAI SDK actually uses

import { getHARRecorder } from './har-recorder.js';
import { logger } from './logger.js';

let originalNodeFetch: typeof fetch | null = null;
let interceptorEnabled = false;

export function enableNodeFetchInterception(): void {
  if (interceptorEnabled) {
    return;
  }

  try {
    // Dynamically import node-fetch to intercept it
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFetchModule = require('node-fetch');

    if (!nodeFetchModule || !nodeFetchModule.default) {
      logger.debug('node-fetch not available for interception');
      return;
    }

    // Store original
    originalNodeFetch = nodeFetchModule.default;
    interceptorEnabled = true;

    // Create intercepting fetch
    nodeFetchModule.default = async function interceptedNodeFetch(
      url: string | Request,
      init?: Record<string, unknown>
    ): Promise<Response> {
      const harRecorder = getHARRecorder();

      if (!harRecorder) {
        // No HAR recording enabled, pass through
        return originalNodeFetch(url, init);
      }

      const urlString = typeof url === 'string' ? url : url.url;
      const startTime = Date.now();

      try {
        const response = await originalNodeFetch(url, init);
        const endTime = Date.now();

        // Record to HAR synchronously to ensure it completes before process exits
        try {
          await harRecorder.recordFetchRequest(urlString, init || {}, startTime, response, endTime);
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

    logger.debug('Node-fetch interception enabled for HAR recording');
  } catch (error) {
    logger.debug('Failed to enable node-fetch interception', { error });
    interceptorEnabled = false;
  }
}

export function disableNodeFetchInterception(): void {
  if (!interceptorEnabled || !originalNodeFetch) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFetchModule = require('node-fetch');
    if (nodeFetchModule) {
      nodeFetchModule.default = originalNodeFetch;
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
