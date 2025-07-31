// ABOUTME: Type definitions for tool renderer system
// ABOUTME: Defines interfaces and helper types for customizable tool display logic

import type { ToolResult } from '@/lib/server/lace-imports';

export interface ToolRenderer {
  getDisplayName?: (toolName: string, result?: ToolResult) => string;
  getSummary?: (args: unknown) => string;
  isError?: (result: ToolResult) => boolean;
  renderResult?: (result: ToolResult) => React.ReactNode;
  getIcon?: () => import('@fortawesome/fontawesome-svg-core').IconDefinition;
}

// Helper type to ensure tool renderer objects match the interface
export type ToolRendererDefinition = Partial<ToolRenderer>;

// Re-export ToolResult for convenience
export type { ToolResult };
