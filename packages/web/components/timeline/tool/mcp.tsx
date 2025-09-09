// ABOUTME: Generic MCP tool renderer for nicely formatted parameter display
// ABOUTME: Handles any MCP tool (server/tool_name format) with readable JSON parameter formatting

'use client';

import React from 'react';
import { faServer } from '@/lib/fontawesome';
import type { ToolRenderer, ToolResult } from '@/components/timeline/tool/types';
import type { ToolAggregatedEventData } from '@/types/web-events';

/**
 * MCP Parameters display component for the body
 */
export function MCPParametersDisplay({ args }: { args: unknown }) {
  if (!args || typeof args !== 'object') {
    if (args === null || args === undefined) return null;
    return <div className="text-sm text-base-content/70">{String(args)}</div>;
  }

  const params = args as Record<string, unknown>;
  const entries = Object.entries(params);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-3">
      {entries.map(([key, value]) => (
        <div key={key} className="border-l-2 border-base-300 pl-3">
          <div className="text-sm font-medium text-base-content/80 mb-1">{key}:</div>
          <div className="text-sm text-base-content/70 whitespace-pre-wrap">
            {formatParameterValue(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Format individual parameter values for display
 */
function formatParameterValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  } else if (Array.isArray(value)) {
    return `[${value.length} items]: ${JSON.stringify(value, null, 2)}`;
  } else if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  } else {
    return String(value);
  }
}

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
    // Keep title clean - parameters will be shown in body
    return '';
  },

  getIcon: () => faServer,

  renderResult: (result: ToolResult, metadata?: ToolAggregatedEventData) => {
    // Show parameters as the main content for MCP tools
    return (
      <div className="p-3">
        <MCPParametersDisplay args={metadata?.call?.arguments} />
      </div>
    );
  },

  isError: (result: ToolResult): boolean => {
    return result.status === 'failed' || result.status === 'aborted' || result.status === 'denied';
  },
};
