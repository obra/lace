// ABOUTME: Central registry for tool renderers, eliminating dynamic import complexity
// ABOUTME: Maps tool names to specific renderer components with type safety and clear fallback patterns

import React from 'react';
import { BashToolRenderer } from './BashToolRenderer.js';
import { DelegateToolRenderer } from './DelegateToolRenderer.js';
import { FileEditToolRenderer } from './FileEditToolRenderer.js';
import { FileListToolRenderer } from './FileListToolRenderer.js';
import { FileSearchToolRenderer } from './FileSearchToolRenderer.js';
import { FileWriteToolRenderer } from './FileWriteToolRenderer.js';
import { GenericToolRenderer } from './GenericToolRenderer.js';

export type ToolRendererComponent = React.ComponentType<any>;

/**
 * Registry mapping tool names to their specific renderer components
 * 
 * Add new tool renderers here instead of relying on naming conventions
 * and dynamic imports. This eliminates the brittle string manipulation
 * and provides type safety.
 */
export const TOOL_RENDERER_REGISTRY: Record<string, ToolRendererComponent> = {
  'bash': BashToolRenderer,
  'delegate': DelegateToolRenderer,
  'file-edit': FileEditToolRenderer,
  'file-list': FileListToolRenderer,
  'file-read': GenericToolRenderer, // Use generic for simple tools
  'file-search': FileSearchToolRenderer,
  'file-write': FileWriteToolRenderer,
  'ripgrep-search': GenericToolRenderer, // Use generic for simple tools
  'task-manager': GenericToolRenderer, // Use generic for simple tools
  'url-fetch': GenericToolRenderer, // Use generic for simple tools
  'file-find': GenericToolRenderer, // Use generic for simple tools
  'file-insert': GenericToolRenderer, // Use generic for simple tools
} as const;

/**
 * Get the appropriate renderer for a tool, with fallback to GenericToolRenderer
 * 
 * @param toolName - The name of the tool (e.g., 'bash', 'file-read', 'delegate')
 * @returns The renderer component for the tool
 */
export function getToolRenderer(toolName: string): ToolRendererComponent {
  const renderer = TOOL_RENDERER_REGISTRY[toolName];
  return renderer || GenericToolRenderer;
}

/**
 * Check if a tool has a specialized renderer (not using GenericToolRenderer)
 * 
 * @param toolName - The name of the tool
 * @returns true if the tool has a specialized renderer
 */
export function hasSpecializedRenderer(toolName: string): boolean {
  const renderer = TOOL_RENDERER_REGISTRY[toolName];
  return renderer !== undefined && renderer !== GenericToolRenderer;
}

/**
 * Get all tool names that have specialized renderers
 * 
 * @returns Array of tool names with specialized renderers
 */
export function getSpecializedToolNames(): string[] {
  return Object.entries(TOOL_RENDERER_REGISTRY)
    .filter(([_, renderer]) => renderer !== GenericToolRenderer)
    .map(([toolName, _]) => toolName);
}