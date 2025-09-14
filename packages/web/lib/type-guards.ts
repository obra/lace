// ABOUTME: Shared type guard functions for runtime type checking
// ABOUTME: Eliminates unsafe type assertions throughout the application

import type { ToolPolicy } from '@/types/core';

// Tool policy information structure
export interface ToolPolicyInfo {
  value: ToolPolicy;
  allowedValues: ToolPolicy[];
  projectValue?: ToolPolicy;
  globalValue?: ToolPolicy;
}

/**
 * Type guard to check if tools field contains policy information structure
 */
export function isToolPolicyData(tools: unknown): tools is Record<string, ToolPolicyInfo> {
  return (
    typeof tools === 'object' &&
    tools !== null &&
    !Array.isArray(tools) &&
    Object.keys(tools).length > 0 &&
    Object.values(tools).every(
      (tool) =>
        tool &&
        typeof tool === 'object' &&
        'value' in tool &&
        'allowedValues' in tool &&
        Array.isArray((tool as Record<string, unknown>).allowedValues)
    )
  );
}

// Removed unused function: isToolStringArray
