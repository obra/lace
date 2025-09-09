// ABOUTME: Generic MCP tool renderer for nicely formatted parameter display
// ABOUTME: Handles any MCP tool (server/tool_name format) with readable JSON parameter formatting

'use client';

import React from 'react';
import { faServer } from '@/lib/fontawesome';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';

/**
 * Format JSON parameters in a readable way
 */
function formatParameters(args: unknown): string {
  if (args === null) {
    return 'null';
  }
  if (args === undefined) {
    return '';
  }
  if (typeof args !== 'object') {
    return String(args);
  }

  const params = args as Record<string, unknown>;
  const entries = Object.entries(params);

  // If no parameters, return empty string for consistency
  if (entries.length === 0) {
    return '';
  }

  const formattedEntries: string[] = [];

  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      // Format strings nicely, truncate if too long
      const displayValue = value.length > 100 ? `${value.substring(0, 100)}...` : value;
      formattedEntries.push(`${key}: "${displayValue}"`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      formattedEntries.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      formattedEntries.push(`${key}: [${value.length} items]`);
    } else if (value && typeof value === 'object') {
      formattedEntries.push(`${key}: {${Object.keys(value).length} properties}`);
    } else {
      formattedEntries.push(`${key}: ${String(value)}`);
    }
  }

  return formattedEntries.join(', ');
}

/**
 * Extract server and tool name from MCP tool name
 */
function parseMCPToolName(toolName: string): { server: string; tool: string } {
  const [server, tool] = toolName.split('/', 2);
  return { server: server || 'unknown', tool: tool || toolName };
}

/**
 * Generic MCP tool renderer providing formatted parameter display
 */
export const mcpRenderer: ToolRenderer = {
  getDisplayName: (toolName: string): string => {
    const { server, tool } = parseMCPToolName(toolName);
    return `${server}/${tool}`;
  },

  getSummary: (args: unknown, result?: ToolResult): string => {
    return formatParameters(args);
  },

  getIcon: () => faServer,

  renderResult: (result: ToolResult) => {
    // For now, use default result rendering
    // Could be enhanced later with MCP-specific result formatting
    return null; // Falls back to default rendering
  },

  isError: (result: ToolResult): boolean => {
    return result.status === 'failed' || result.status === 'aborted' || result.status === 'denied';
  },
};
