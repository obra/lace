// ABOUTME: Tool renderer registry and lookup functions
// ABOUTME: Maps tool names to their custom display logic with fallback support

import type { ToolRenderer } from './types';
import { bashRenderer } from './bash';
import { delegateRenderer } from './delegate';
import { fileWriteRenderer } from './file-write';
import { fileReadRenderer } from './file-read';
import { fileEditRenderer } from './file-edit';
import { fileListRenderer } from './file-list';
import { searchRenderer } from './search';
import { urlFetchRenderer } from './url-fetch';
import { mcpRenderer } from './mcp';

// Registry of tool renderers - add new tools here
const toolRenderers: Record<string, ToolRenderer> = {
  bash: bashRenderer,
  bash_exec: bashRenderer, // Handle alternative bash tool name
  shell: bashRenderer, // Handle shell commands as bash

  // Delegation tools
  delegate: delegateRenderer,

  // File operation tools
  file_write: fileWriteRenderer,
  file_read: fileReadRenderer,
  file_edit: fileEditRenderer,
  file_list: fileListRenderer,

  // Search tools
  search: searchRenderer,
  grep: searchRenderer,

  // Web tools
  url_fetch: urlFetchRenderer,
};

/**
 * Get the renderer for a specific tool type
 * Returns MCP renderer for MCP tools (containing '/'), otherwise specific tool renderer
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  // Check if this is an MCP tool (format: serverId/toolName)
  if (toolName.includes('/')) {
    return mcpRenderer;
  }

  // Use specific renderer for native tools
  return toolRenderers[toolName.toLowerCase()] || {};
}

export type { ToolResult } from './types';
