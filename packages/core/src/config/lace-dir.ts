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
  return getEnvVar('LACE_DIR') || path.join(os.homedir(), '.lace');
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

/**
 * The relative path to the builtin provider catalog data directory
 * Used for require.context() calls to bundle catalog JSON files
 */
export const BUILTIN_PROVIDER_CATALOG_PATH = './data';

/**
 * Get the relative path to the builtin provider catalog data directory
 * Used for require.context() calls to bundle catalog JSON files
 */
export function getBuiltinProviderCatalogPath(): string {
  return BUILTIN_PROVIDER_CATALOG_PATH;
}

/**
 * Process-scoped temporary directory for this server runtime
 * Stable across session recreations, cleaned up when process ends
 */
let _processTempDir: string | null = null;

/**
 * Get or create the process temporary directory
 * Creates one stable temp dir per server process that persists until process ends
 */
export function getProcessTempDir(): string {
  if (!_processTempDir) {
    const processId = process.pid;
    const timestamp = Date.now();
    _processTempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `lace-runtime-${processId}-${timestamp}-`)
    );
  }
  return _processTempDir;
}

/**
 * Clear process temp dir cache - primarily for testing
 */
export function clearProcessTempDirCache(): void {
  _processTempDir = null;
}
