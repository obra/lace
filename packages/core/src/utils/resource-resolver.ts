// ABOUTME: Unified resource path resolution for development and production (standalone) modes
// ABOUTME: Handles the difference between import.meta.url and extracted standalone directory structure

import path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { logger } from '~/utils/logger';

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
  const moduleDir = path.dirname(fileURLToPath(importMetaUrl));

  // Check if running from Bun executable (importMetaUrl contains $bunfs)
  if (importMetaUrl.includes('$bunfs')) {
    // Running from Bun executable - return special markers for embedded file loading
    if (relativePath === 'data') {
      return '__BUN_EMBEDDED_DATA__';
    } else if (relativePath === 'agent-personas') {
      return '__BUN_EMBEDDED_AGENT_PERSONAS__';
    } else if (relativePath === 'templates') {
      return '__BUN_EMBEDDED_TEMPLATES__';
    } else {
      throw new Error(
        `Unknown resource path '${relativePath}' in Bun executable mode. Add explicit mapping.`
      );
    }
  }

  // Check if running from a bundled build (React Router 7 style)
  if (importMetaUrl.includes('/build/server/assets/')) {
    // Running from bundle - find project root from the bundle path
    const buildIndex = importMetaUrl.indexOf('/packages/web/build/');
    if (buildIndex === -1) {
      throw new Error(`Cannot determine project root from bundle path: ${importMetaUrl}`);
    }

    const projectRoot = importMetaUrl.substring(0, buildIndex);

    // Map known resource requests to their actual locations
    if (relativePath === 'data') {
      return path.resolve(
        projectRoot.replace('file://', ''),
        'packages/core/src/providers/catalog/data'
      );
    } else if (relativePath === 'agent-personas') {
      return path.resolve(
        projectRoot.replace('file://', ''),
        'packages/core/config/agent-personas'
      );
    } else {
      throw new Error(
        `Unknown resource path '${relativePath}' in bundled mode. Add explicit mapping.`
      );
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In production (standalone), resolve relative to the working directory
    // The standalone structure is: standalone/src/... so we need to find the equivalent path

    // Convert the development module path to its standalone equivalent
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

    // Special case for agent-personas which moved from src/config/ to config/
    if (relativePath === 'agent-personas') {
      return path.resolve(process.cwd(), 'packages/core/config/agent-personas');
    }

    // Combine with the relative path and resolve from current working directory
    return path.resolve(process.cwd(), srcPrefix, relativeFromSrc, relativePath);
  } else {
    // In development, use the standard module-relative resolution
    const currentDir = path.dirname(fileURLToPath(importMetaUrl));

    // Special case for agent-personas which is at packages/core/config/agent-personas
    // but called from packages/core/src/ modules
    if (relativePath === 'agent-personas') {
      return path.resolve(currentDir, '../../config/agent-personas');
    }

    return path.resolve(currentDir, relativePath);
  }
}

/**
 * Scans for files in embedded or filesystem mode
 * @param directoryPath - The logical directory path (e.g., 'providers/catalog/data', 'agent-personas')
 * @param extension - File extension to filter by (e.g., '.json', '.md')
 * @param fallbackFsPath - Filesystem path to use in development mode
 * @returns Array of objects with file name and loading function
 */
interface EmbeddedFileInfo {
  name: string; // Just the filename without extension
  fullPath: string; // Full path for reference
  loadContent: () => Promise<string>;
}

export function scanEmbeddedFiles(
  directoryPath: string,
  extension: string,
  fallbackFsPath: string
): EmbeddedFileInfo[] {
  const files: EmbeddedFileInfo[] = [];

  // Try embedded files first (production/bundled mode)
  if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
    for (const file of Bun.embeddedFiles) {
      const fileName = (file as File).name;
      if (fileName.includes(`/${directoryPath}/`) && fileName.endsWith(extension)) {
        const baseName = fileName.split('/').pop()?.slice(0, -extension.length);
        if (baseName) {
          files.push({
            name: baseName,
            fullPath: fileName,
            loadContent: async () => await file.text(),
          });
        }
      }
    }
  } else {
    // Fallback to filesystem (development mode)
    try {
      const fsFiles = fs.readdirSync(fallbackFsPath);
      for (const file of fsFiles) {
        if (file.endsWith(extension)) {
          const baseName = file.slice(0, -extension.length);
          const fullPath = path.join(fallbackFsPath, file);
          files.push({
            name: baseName,
            fullPath,
            loadContent: () => {
              return Promise.resolve(fs.readFileSync(fullPath, 'utf8'));
            },
          });
        }
      }
    } catch (error) {
      // Directory may not exist in development, that's ok
      logger.warn('Failed to scan directory in filesystem mode', {
        fallbackFsPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return files;
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

// Removed unused functions: tryReadEmbeddedFile, getEmbeddedFiles

// Removed unused functions: loadFilesFromDirectory, loadFileFromEmbeddedOrFilesystem

/**
 * Check if we're running in standalone production mode
 */
export function isStandaloneMode(): boolean {
  return process.env.NODE_ENV === 'production';
}
