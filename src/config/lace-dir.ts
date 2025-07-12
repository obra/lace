// ABOUTME: Configuration directory management for Lace
// ABOUTME: Handles LACE_DIR environment variable, directory creation, and path utilities

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getEnvVar } from '~/config/env-loader';

/**
 * Get the Lace configuration directory
 * Uses LACE_DIR environment variable, falls back to ~/.lace/
 */
export function getLaceDir(): string {
  const laceDir = getEnvVar('LACE_DIR') || path.join(os.homedir(), '.lace');
  return laceDir;
}

/**
 * Ensure the Lace configuration directory exists
 * Creates the directory if it doesn't exist and returns the path
 */
export function ensureLaceDir(): string {
  const laceDir = getLaceDir();

  try {
    if (!fs.existsSync(laceDir)) {
      fs.mkdirSync(laceDir, { recursive: true });
    }
    return laceDir;
  } catch (error) {
    throw new Error(
      `Failed to create Lace configuration directory at ${laceDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the path to a file within the Lace configuration directory
 */
export function getLaceFilePath(filename: string): string {
  return path.join(getLaceDir(), filename);
}

/**
 * Get the path to the threads database file
 */
export function getLaceDbPath(): string {
  return getLaceFilePath('lace.db');
}
