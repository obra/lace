// ABOUTME: Tool renderer factory function using direct imports and switch pattern
// ABOUTME: Matches existing codebase patterns like ToolExecutor.registerAllAvailableTools() for consistent architecture

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
 * Get the appropriate renderer for a tool, with fallback to GenericToolRenderer
 * 
 * This follows the same pattern as ToolExecutor.registerAllAvailableTools() - 
 * using explicit switch statements rather than registry objects for better
 * type safety and maintainability.
 * 
 * @param toolName - The name of the tool (e.g., 'bash', 'file-read', 'delegate')
 * @returns The renderer component for the tool
 */
export function getToolRenderer(toolName: string): ToolRendererComponent {
  switch (toolName) {
    case 'bash':
      return BashToolRenderer;
    case 'delegate':
      return DelegateToolRenderer;
    case 'file-edit':
      return FileEditToolRenderer;
    case 'file-list':
      return FileListToolRenderer;
    case 'file-search':
      return FileSearchToolRenderer;
    case 'file-write':
      return FileWriteToolRenderer;
    
    // Tools using generic renderer
    case 'file-read':
    case 'ripgrep-search':
    case 'task-manager':
    case 'url-fetch':
    case 'file-find':
    case 'file-insert':
      return GenericToolRenderer;
    
    default:
      return GenericToolRenderer;
  }
}

/**
 * Check if a tool has a specialized renderer (not using GenericToolRenderer)
 * 
 * @param toolName - The name of the tool
 * @returns true if the tool has a specialized renderer
 */
export function hasSpecializedRenderer(toolName: string): boolean {
  switch (toolName) {
    case 'bash':
    case 'delegate':
    case 'file-edit':
    case 'file-list':
    case 'file-search':
    case 'file-write':
      return true;
    default:
      return false;
  }
}

/**
 * Get all tool names that have specialized renderers
 * 
 * @returns Array of tool names with specialized renderers
 */
export function getSpecializedToolNames(): string[] {
  return [
    'bash',
    'delegate',
    'file-edit',
    'file-list',
    'file-search',
    'file-write',
  ];
}