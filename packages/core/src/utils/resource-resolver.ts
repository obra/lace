// ABOUTME: Unified resource path resolution for development and production (standalone) modes
// ABOUTME: Handles the difference between import.meta.url and extracted standalone directory structure

import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Resolves paths to bundled resources (data files, templates, etc.) that work in both
 * development and production standalone modes.
 *
 * In development: Uses import.meta.url to resolve relative to the current module
 * In production: Uses process.cwd() to resolve relative to the extracted standalone directory
 *
 * @param importMetaUrl - The import.meta.url from the calling module
 * @param relativePath - Path relative to the calling module (e.g., './data', '../templates')
 * @returns Absolute path that works in both development and production
 */
export function resolveResourcePath(importMetaUrl: string, relativePath: string): string {
  if (process.env.NODE_ENV === 'production') {
    // In production (standalone), resolve relative to the working directory
    // The standalone structure is: standalone/src/... so we need to find the equivalent path

    // Convert the development module path to its standalone equivalent
    const moduleDir = path.dirname(fileURLToPath(importMetaUrl));

    // Find the src/ directory in the module path to determine the relative path from src/
    // Handle both monorepo structure (packages/core/src/) and original structure (src/)
    let srcIndex = moduleDir.indexOf('/packages/core/src/');
    let srcPrefix = 'packages/core/src';

    if (srcIndex === -1) {
      srcIndex = moduleDir.indexOf('/src/');
      srcPrefix = 'src';
    }

    if (srcIndex === -1) {
      throw new Error(
        `Unable to resolve resource path: module ${importMetaUrl} is not in src/ or packages/core/src/ directory`
      );
    }

    // Get the path relative to src/ directory (accounting for prefix length)
    const prefixLength = srcIndex + `/${srcPrefix}/`.length;
    const relativeFromSrc = moduleDir.substring(prefixLength);

    // Combine with the relative path and resolve from current working directory
    return path.resolve(process.cwd(), srcPrefix, relativeFromSrc, relativePath);
  } else {
    // In development, use the standard module-relative resolution
    const currentDir = path.dirname(fileURLToPath(importMetaUrl));
    return path.resolve(currentDir, relativePath);
  }
}

/**
 * Convenience function for resolving data directories
 * @param importMetaUrl - The import.meta.url from the calling module
 * @returns Path to the 'data' directory next to the calling module
 */
export function resolveDataDirectory(importMetaUrl: string): string {
  return resolveResourcePath(importMetaUrl, 'data');
}

/**
 * Convenience function for resolving template directories
 * @param importMetaUrl - The import.meta.url from the calling module
 * @returns Path to the 'templates' directory next to the calling module
 */
export function resolveTemplateDirectory(importMetaUrl: string): string {
  return resolveResourcePath(importMetaUrl, 'templates');
}

/**
 * Check if we're running in standalone production mode
 */
export function isStandaloneMode(): boolean {
  return process.env.NODE_ENV === 'production';
}
