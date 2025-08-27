// ABOUTME: Type definitions for tool renderer system
// ABOUTME: Defines interfaces and helper types for customizable tool display logic

import type { ToolResult } from '@/types/core';
import type { ToolAggregatedEventData } from '@/types/web-events';

export interface ToolRenderer {
  getDisplayName?: (toolName: string, result?: ToolResult) => string;
  getSummary?: (args: unknown, result?: ToolResult) => string;
  getAction?: (result?: ToolResult, metadata?: ToolAggregatedEventData) => React.ReactNode;
  isError?: (result: ToolResult) => boolean;
  renderResult?: (result: ToolResult, metadata?: ToolAggregatedEventData) => React.ReactNode;
  getIcon?: () => import('@fortawesome/fontawesome-svg-core').IconDefinition;
}

// Helper type to ensure tool renderer objects match the interface
type ToolRendererDefinition = Partial<ToolRenderer>;

// Re-export ToolResult for convenience
export type { ToolResult };
