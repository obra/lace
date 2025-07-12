// ABOUTME: Shared utilities for tool renderers using TimelineEntry pattern
// ABOUTME: Contains only essential type definitions and utility functions

import { ToolCall, ToolResult } from '~/tools/types';

// Standard props interface for tool renderers using TimelineEntry
export interface ToolRendererProps {
  item: {
    type: 'tool_execution';
    call: ToolCall;
    result?: ToolResult;
    timestamp: Date;
    callId: string;
  };
  isStreaming?: boolean;
}

// Simple utility to limit lines for preview
export function limitLines(
  text: string,
  maxLines: number
): {
  lines: string[];
  truncated: boolean;
  remaining: number;
} {
  if (!text) return { lines: [], truncated: false, remaining: 0 };

  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false, remaining: 0 };
  }

  return {
    lines: lines.slice(0, maxLines),
    truncated: true,
    remaining: lines.length - maxLines,
  };
}
