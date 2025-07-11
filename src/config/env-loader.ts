// ABOUTME: Loads environment variables from .env files using dotenv

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { logger } from '~/utils/logger.js';

export function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  const envLocalPath = path.resolve(process.cwd(), '.env.local');

  // Load .env first
  if (fs.existsSync(envPath)) {
    const result = dotenv.config({ path: envPath });

    if (result.error) {
      logger.warn('Failed to parse .env file', { error: result.error.message });
    } else {
      logger.debug('.env file loaded successfully', {
        path: envPath,
        variableCount: Object.keys(result.parsed || {}).length,
      });
    }
  } else {
    logger.debug('No .env file found', { searchPath: envPath });
  }

  // Load .env.local second (overrides .env)
  if (fs.existsSync(envLocalPath)) {
    const result = dotenv.config({ path: envLocalPath });

    if (result.error) {
      logger.warn('Failed to parse .env.local file', { error: result.error.message });
    } else {
      logger.debug('.env.local file loaded successfully', {
        path: envLocalPath,
        variableCount: Object.keys(result.parsed || {}).length,
      });
    }
  } else {
    logger.debug('No .env.local file found', { searchPath: envLocalPath });
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
