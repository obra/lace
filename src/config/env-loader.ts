// ABOUTME: Loads environment variables from .env files using dotenv

import dotenv from 'dotenv';
import { logger } from '~/utils/logger.js';

export function loadEnvFile(): void {
  // Load .env.local first (highest priority - won't be overridden)
  const localResult = dotenv.config({ path: '.env.local' });
  if (localResult.error) {
    logger.debug('No .env.local file found or failed to parse', { error: localResult.error.message });
  } else if (localResult.parsed) {
    logger.debug('.env.local loaded successfully', {
      variableCount: Object.keys(localResult.parsed).length,
    });
  }

  // Load .env second (lower priority - won't override existing variables)
  const result = dotenv.config({ path: '.env' });
  if (result.error) {
    logger.debug('No .env file found or failed to parse', { error: result.error.message });
  } else if (result.parsed) {
    logger.debug('.env loaded successfully', {
      variableCount: Object.keys(result.parsed).length,
    });
  }
}

export function getEnvVar(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

export function requireEnvVar(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}
