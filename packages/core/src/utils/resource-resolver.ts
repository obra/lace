// ABOUTME: Unified resource path resolution for development and production (standalone) modes
// ABOUTME: Handles the difference between import.meta.url and extracted standalone directory structure

import path from 'path';
import { fileURLToPath } from 'url';
import { readFile, readdir } from 'node:fs/promises';

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
    } else if (relativePath === 'prompts') {
      return '__BUN_EMBEDDED_PROMPTS__';
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
    } else if (relativePath === 'prompts') {
      return path.resolve(projectRoot.replace('file://', ''), 'packages/core/src/config/prompts');
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
 * Try to read a file from Bun's embedded files, fallback to file system
 */
export async function tryReadEmbeddedFile(
  filename: string,
  fallbackPath?: string
): Promise<string | null> {
  // Try Bun embedded files first
  try {
    // @ts-ignore - Bun.embeddedFiles may not exist in Node.js
    if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
      for (const file of Bun.embeddedFiles) {
        if (file.name === filename) {
          return await file.text();
        }
      }
    }
  } catch {
    // Bun API not available
  }

  // Fallback to file system if provided
  if (fallbackPath) {
    try {
      const fs = await import('fs/promises');
      return await fs.readFile(fallbackPath, 'utf-8');
    } catch {
      // File system read failed
    }
  }

  return null;
}

/**
 * Get list of embedded files matching a pattern (e.g., '*.json')
 */
export function getEmbeddedFiles(pattern: string): string[] {
  try {
    // @ts-ignore - Bun.embeddedFiles may not exist in Node.js
    if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return Array.from(Bun.embeddedFiles)
        .map((file) => file.name)
        .filter((name) => regex.test(name));
    }
  } catch {
    // Bun API not available
  }

  return [];
}

/**
 * Load files from a directory, works with both embedded files and file system
 */
export async function loadFilesFromDirectory(
  dirPath: string,
  fileExtension: string
): Promise<Array<{ name: string; content: string }>> {
  const { logger } = await import('~/utils/logger');
  const files: Array<{ name: string; content: string }> = [];

  // Try Bun embedded files first
  try {
    if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
      logger.debug('resource.load.checking_embedded', {
        dirPath,
        fileExtension,
        totalEmbedded: Bun.embeddedFiles.length,
      });

      // Log all embedded files for debugging
      Array.from(Bun.embeddedFiles).forEach((file, i) => {
        logger.debug('resource.load.embedded_file', { index: i, name: file.name });
      });

      const embeddedFiles = Array.from(Bun.embeddedFiles).filter(
        (file) => file.name.includes(`../${dirPath}`) && file.name.endsWith(fileExtension)
      );

      logger.debug('resource.load.filtered_embedded', {
        dirPath,
        fileExtension,
        matchingCount: embeddedFiles.length,
      });
      embeddedFiles.forEach((file) =>
        logger.debug('resource.load.embedded_match', { name: file.name })
      );

      if (embeddedFiles.length > 0) {
        for (const file of embeddedFiles) {
          const content = await file.text();
          const name = path.basename(file.name, fileExtension);
          files.push({ name, content });
          logger.debug('resource.load.embedded_loaded', { filePath: file.name, name });
        }
        return files;
      }
    }
  } catch (e) {
    logger.debug('resource.load.bun_error', { error: String(e) });
  }

  // Fallback to file system approach
  logger.debug('resource.load.fallback_filesystem', { dirPath });
  try {
    const fs = await import('fs/promises');
    const fileList = await fs.readdir(dirPath);
    logger.debug('resource.load.filesystem_files', { dirPath, count: fileList.length });

    for (const filename of fileList.filter((f) => f.endsWith(fileExtension))) {
      const filePath = path.join(dirPath, filename);
      const content = await fs.readFile(filePath, 'utf-8');
      const name = path.basename(filename, fileExtension);
      files.push({ name, content });
      logger.debug('resource.load.filesystem_loaded', { filePath, name });
    }
  } catch (e) {
    logger.debug('resource.load.filesystem_error', { dirPath, error: String(e) });
  }

  logger.debug('resource.load.complete', { dirPath, fileExtension, totalLoaded: files.length });
  return files;
}

/**
 * Load a specific file by path from embedded files or file system
 */
export async function loadFileFromEmbeddedOrFilesystem(filePath: string): Promise<string | null> {
  const { logger } = await import('~/utils/logger');
  
  // Try Bun embedded files first - look for files that end with the relative path
  try {
    if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
      // Normalize the file path for comparison (remove leading ./ and ../)
      const normalizedPath = filePath.replace(/^\.\.?\//, '');
      
      for (const file of Bun.embeddedFiles) {
        if (file.name.endsWith(normalizedPath)) {
          logger.debug('resource.load.embedded_file_found', { filePath, embeddedName: file.name });
          return await file.text();
        }
      }
    }
  } catch (e) {
    logger.debug('resource.load.embedded_file_error', { filePath, error: String(e) });
  }

  // Fallback to file system
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(filePath, 'utf-8');
    logger.debug('resource.load.filesystem_file_found', { filePath });
    return content;
  } catch (e) {
    logger.debug('resource.load.filesystem_file_not_found', { filePath, error: String(e) });
  }

  return null;
}

/**
 * Check if we're running in standalone production mode
 */
export function isStandaloneMode(): boolean {
  return process.env.NODE_ENV === 'production';
}
