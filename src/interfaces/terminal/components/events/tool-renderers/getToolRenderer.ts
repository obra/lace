// ABOUTME: Dynamic tool renderer discovery utility using naming conventions
// ABOUTME: Maps tool names to specific renderer components or returns null for GenericToolRenderer fallback

import React from 'react';
import { logger } from '../../../../../utils/logger.js';

/**
 * Dynamic tool renderer discovery function
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

/**
 * Synchronous version that returns React.lazy component
 * Use this when you need a component that can be used with Suspense
 */
export function getToolRendererLazy(
  toolName: string
): React.LazyExoticComponent<React.ComponentType<unknown>> | null {
  if (!toolName || toolName.trim() === '') {
    return null;
  }

  try {
    const componentName = toolNameToComponentName(toolName);
    const fileName = `./${componentName}.js`;

    return React.lazy(() =>
      import(fileName)
        .then((module) => ({
          default: module.default || module[componentName],
        }))
        .catch(() => {
          // Return a component that throws to trigger Suspense fallback
          throw new Error(`Tool renderer not found: ${toolName}`);
        })
    );
  } catch {
    return null;
  }
}
