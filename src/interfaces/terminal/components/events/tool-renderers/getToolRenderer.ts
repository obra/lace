// ABOUTME: Dynamic tool renderer discovery utility using naming conventions
// ABOUTME: Maps tool names to specific renderer components or returns null for GenericToolRenderer fallback

import React from 'react';
import { logger } from '../../../../../utils/logger.js';

// Module-level cache to avoid repeated dynamic imports
const rendererCache = new Map<string, React.ComponentType<unknown> | null>();

/**
 * Dynamic tool renderer discovery function with caching
 *
 * @param toolName - The name of the tool (e.g., 'bash', 'file-read', 'delegate')
 * @returns Promise<React.ComponentType> or null if no specific renderer found
 *
 * Naming convention:
 * - 'bash' → './BashToolRenderer.tsx'
 * - 'file-read' → './FileReadToolRenderer.tsx'
 * - 'delegate' → './DelegateToolRenderer.tsx'
 */
export async function getToolRenderer(
  toolName: string
): Promise<React.ComponentType<unknown> | null> {
  // Check cache first
  if (rendererCache.has(toolName)) {
    const cached = rendererCache.get(toolName)!;
    logger.debug('Tool renderer cache hit', {
      toolName,
      found: !!cached,
    });
    return cached;
  }
  try {
    // Convert tool name to component name (bash → BashToolRenderer)
    const componentName = toolNameToComponentName(toolName);
    const fileName = `./${componentName}.js`; // .js extension for compiled output

    logger.debug('Tool renderer discovery', {
      toolName,
      componentName,
      fileName,
      action: 'attempting_load',
    });

    // Attempt dynamic import
    const module = await import(fileName);
    const moduleKeys = Object.keys(module);

    logger.debug('Tool renderer module loaded', {
      toolName,
      moduleKeys,
      hasDefault: !!module.default,
      hasNamedExport: !!module[componentName],
    });

    // Return the default export or named export matching component name
    const renderer = module.default || module[componentName] || null;

    // Cache the result (including null for not found)
    rendererCache.set(toolName, renderer);

    logger.info('Tool renderer discovery result', {
      toolName,
      found: !!renderer,
      rendererName: renderer?.name,
      usedExport: module.default ? 'default' : module[componentName] ? 'named' : 'none',
    });

    return renderer;
  } catch (error: any) {
    logger.debug('Tool renderer discovery failed', {
      toolName,
      error: error?.message,
      fallback: 'GenericToolRenderer',
    });
    // Cache the null result to avoid repeated failed imports
    rendererCache.set(toolName, null);
    // Return null if component not found - caller should use GenericToolRenderer
    return null;
  }
}

/**
 * Convert tool name to Pascal case component name
 *
 * Examples:
 * - 'bash' → 'BashToolRenderer'
 * - 'file-read' → 'FileReadToolRenderer'
 * - 'delegate' → 'DelegateToolRenderer'
 * - 'ripgrep-search' → 'RipgrepSearchToolRenderer'
 */
function toolNameToComponentName(toolName: string): string {
  return (
    toolName
      .split(/[-_]/) // Split on hyphens and underscores
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('') + 'ToolRenderer'
  );
}
