// ABOUTME: Loads environment variables from .env files using dotenv

import dotenv from 'dotenv';
import { logger } from '~/utils/logger.js';

function loadAndLogEnvFile(path: string, description: string): void {
  const result = dotenv.config({ path });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      logger.debug(`No ${description} file found`);
    } else {
      logger.debug(`${description} failed to parse`, { error: result.error.message });
    }
  } else if (result.parsed) {
    logger.debug(`${description} loaded successfully`, {
      variableCount: Object.keys(result.parsed).length,
    });
  }
}

export function loadEnvFile(): void {
  // Load .env.local first (highest priority - won't be overridden)
  loadAndLogEnvFile('.env.local', '.env.local');

  // Load .env second (lower priority - won't override existing variables)
  loadAndLogEnvFile('.env', '.env');
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
