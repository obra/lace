// ABOUTME: Security utilities for filesystem operations
// ABOUTME: Provides path validation to prevent directory traversal attacks

import { sep } from 'path';

/**
 * Checks if a path is inside (or equal to) a home directory.
 *
 * This function implements separator-aware prefix checking to prevent
 * directory traversal attacks. It correctly handles edge cases like:
 * - /Users/alice-admin should NOT match /Users/alice
 * - /Users/alice/Documents should match /Users/alice
 * - Root directory as home should match any path
 *
 * IMPORTANT: Both paths should be resolved to their real paths (via fs.realpath)
 * before calling this function to handle symlink escapes.
 *
 * @param realPath - The absolute, real path to check (after fs.realpath)
 * @param realHomeDir - The absolute, real home directory (after fs.realpath)
 * @returns true if realPath is inside or equal to realHomeDir
 */
export function isPathInsideHome(realPath: string, realHomeDir: string): boolean {
  // Handle empty inputs - these are invalid and should return false
  if (!realPath || !realHomeDir) {
    return false;
  }

  // Exact match: path equals home directory
  if (realPath === realHomeDir) {
    return true;
  }

  // Check if path starts with home directory prefix
  if (!realPath.startsWith(realHomeDir)) {
    return false;
  }

  // The path starts with home, but we need to verify it's a true subdirectory,
  // not just a directory that happens to have the same prefix (e.g., /Users/alice-admin vs /Users/alice)
  //
  // Valid cases where startsWith is sufficient:
  // 1. Home is root (e.g., "/") - any path starting with "/" is inside
  // 2. Home ends with separator - the startsWith check is already complete
  // 3. Character after home prefix is a separator - it's a true subdirectory

  // Case 1: Home is root directory
  if (realHomeDir === sep) {
    return true;
  }

  // Case 2: Home ends with separator (e.g., "/Users/alice/")
  if (realHomeDir.endsWith(sep)) {
    return true;
  }

  // Case 3: Character after home prefix must be a separator
  // This prevents /Users/alice-admin from matching /Users/alice
  const charAfterPrefix = realPath[realHomeDir.length];
  return charAfterPrefix === sep;
}
