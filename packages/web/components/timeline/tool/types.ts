// ABOUTME: Type definitions for tool renderer system
// ABOUTME: Defines interfaces and helper types for customizable tool display logic

import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ToolResult } from '@lace/web/types/core';
import type { ToolAggregatedEventData } from '@lace/web/types/web-events';

export interface ToolRenderer {
  getDisplayName?: (toolName: string, result?: ToolResult) => string;
  getSummary?: (args: unknown, result?: ToolResult) => string;
  getAction?: (result?: ToolResult, metadata?: ToolAggregatedEventData) => ReactNode;
  isError?: (result: ToolResult) => boolean;
  renderResult?: (result: ToolResult, metadata?: ToolAggregatedEventData) => ReactNode;
  getIcon?: () => IconDefinition;
}

// Helper type to ensure tool renderer objects match the interface
type ToolRendererDefinition = Partial<ToolRenderer>;

// Re-export ToolResult for convenience
export type { ToolResult };
