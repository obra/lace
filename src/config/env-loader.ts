// ABOUTME: Loads environment variables from .env files using dotenv with hierarchy support

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { logger } from '~/utils/logger.js';

export interface EnvLoadResult {
  loaded: string[];
  failed: string[];
  variableCount: number;
}

/**
 * Loads environment variables from multiple .env files in priority order
 * Priority: .env.local > .env.{NODE_ENV}.local > .env.{NODE_ENV} > .env
 * 
 * @param rootDir - Directory to search for .env files (defaults to process.cwd())
 * @returns Object containing loaded files, failed files, and total variable count
 */
export function loadEnvFiles(rootDir: string = process.cwd()): EnvLoadResult {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const result: EnvLoadResult = {
    loaded: [],
    failed: [],
    variableCount: 0
  };

  // Define file hierarchy (lowest to highest priority)
  const envFiles = [
    '.env',                          // Base configuration
    `.env.${nodeEnv}`,              // Environment-specific
    `.env.local`,                   // Local overrides
    `.env.${nodeEnv}.local`         // Environment-specific local overrides
  ];

  // Load files in order (later files override earlier ones)
  for (const fileName of envFiles) {
    const filePath = path.resolve(rootDir, fileName);
    
    if (fs.existsSync(filePath)) {
      try {
        const loadResult = dotenv.config({ path: filePath });
        
        if (loadResult.error) {
          logger.warn(`Failed to parse ${fileName}`, { 
            error: loadResult.error.message,
            path: filePath 
          });
          result.failed.push(fileName);
        } else {
          const variableCount = Object.keys(loadResult.parsed || {}).length;
          result.loaded.push(fileName);
          result.variableCount += variableCount;
          
          logger.debug(`Loaded ${fileName}`, {
            path: filePath,
            variableCount,
          });
        }
      } catch (error) {
        logger.warn(`Error loading ${fileName}`, { 
          error: error instanceof Error ? error.message : 'Unknown error',
          path: filePath 
        });
        result.failed.push(fileName);
      }
    } else {
      logger.debug(`${fileName} not found`, { searchPath: filePath });
    }
  }

  // Log summary
  if (result.loaded.length > 0) {
    logger.info('Environment configuration loaded', {
      filesLoaded: result.loaded,
      totalVariables: result.variableCount,
      nodeEnv
    });
  }

  if (result.failed.length > 0) {
    logger.warn('Some environment files failed to load', {
      failedFiles: result.failed
    });
  }

  return result;
}

/**
 * Legacy function that loads only .env from current working directory
 * Maintained for backward compatibility
 */
export function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');

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
