// ABOUTME: Tool renderer registry and lookup functions
// ABOUTME: Maps tool names to their custom display logic with fallback support

import type { ToolRenderer } from './types';
import { bashRenderer } from './bash';

// Registry of tool renderers - add new tools here
const toolRenderers: Record<string, ToolRenderer> = {
  bash: bashRenderer,
  bash_exec: bashRenderer, // Handle alternative bash tool name
  shell: bashRenderer, // Handle shell commands as bash
};

/**
 * Get the renderer for a specific tool type
 * Returns empty object if no custom renderer exists (uses all fallbacks)
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  return toolRenderers[toolName.toLowerCase()] || {};
}

export type { ToolRenderer, ToolResult } from './types';
