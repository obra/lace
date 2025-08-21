// ABOUTME: Global traffic logging system for debugging AI provider communications
// ABOUTME: Abstracts HAR recording implementation details from CLI and other components

import { initializeHARRecording } from '~/utils/har-recorder';
import { enableFetchInterception } from '~/utils/fetch-interceptor';
import { enableNodeFetchInterception } from '~/utils/node-fetch-interceptor';
import { enableWebSocketInterception } from '~/utils/websocket-interceptor';
import { logger } from '~/utils/logger';

let trafficLoggingEnabled = false;

/**
 * Enable global traffic logging to specified file
 * Automatically enables appropriate interceptors for all supported protocols
 */
export async function enableTrafficLogging(outputFile: string): Promise<void> {
  if (trafficLoggingEnabled) {
    logger.debug('Traffic logging already enabled');
    return;
  }

  try {
    // Initialize HAR recording
    initializeHARRecording(outputFile);

    // Enable all necessary interceptors
    enableFetchInterception(); // For Ollama & Anthropic
    await enableNodeFetchInterception(); // For OpenAI
    enableWebSocketInterception(); // For LMStudio

    trafficLoggingEnabled = true;
    logger.info('Traffic logging enabled', { outputFile });
    logger.warn('Global function interception active', {
      interceptedFunctions: ['fetch', 'node-fetch', 'WebSocket'],
      warning:
        'HAR recording modifies global HTTP/WebSocket functions. This may affect other code.',
    });
  } catch (error) {
    logger.error('Failed to enable traffic logging', { error, outputFile });
    throw error;
  }
}

/**
 * Check if traffic logging is currently enabled
 */
export function isTrafficLoggingEnabled(): boolean {
  return trafficLoggingEnabled;
}

/**
 * Reset traffic logging state (for testing)
 */
export function resetTrafficLogging(): void {
  trafficLoggingEnabled = false;
}
