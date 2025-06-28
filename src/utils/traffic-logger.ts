// ABOUTME: Global traffic logging system for debugging AI provider communications
// ABOUTME: Abstracts HAR recording implementation details from CLI and other components

import { initializeHARRecording } from './har-recorder.js';
import { enableFetchInterception } from './fetch-interceptor.js';
import { enableNodeFetchInterception } from './node-fetch-interceptor.js';
import { enableWebSocketInterception } from './websocket-interceptor.js';
import { logger } from './logger.js';

let trafficLoggingEnabled = false;

/**
 * Enable global traffic logging to specified file
 * Automatically enables appropriate interceptors for all supported protocols
 */
export function enableTrafficLogging(outputFile: string): void {
  if (trafficLoggingEnabled) {
    logger.debug('Traffic logging already enabled');
    return;
  }

  try {
    // Initialize HAR recording
    initializeHARRecording(outputFile);

    // Enable all necessary interceptors
    enableFetchInterception(); // For Ollama & Anthropic
    enableNodeFetchInterception(); // For OpenAI
    enableWebSocketInterception(); // For LMStudio

    trafficLoggingEnabled = true;
    logger.info('Traffic logging enabled', { outputFile });
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
