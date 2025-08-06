// ABOUTME: Tool renderer registry and lookup functions
// ABOUTME: Maps tool names to their custom display logic with fallback support

import type { ToolRenderer } from './types';
import { bashRenderer } from './bash';
import { taskRenderers } from './task';
import { delegateRenderer } from './delegate';
import { fileWriteRenderer } from './file-write';
import { fileReadRenderer } from './file-read';

// Registry of tool renderers - add new tools here
const toolRenderers: Record<string, ToolRenderer> = {
  bash: bashRenderer,
  bash_exec: bashRenderer, // Handle alternative bash tool name
  shell: bashRenderer, // Handle shell commands as bash

  // Task management tools
  task_add: taskRenderers.task_add,
  task_list: taskRenderers.task_list,
  task_complete: taskRenderers.task_complete,
  task_update: taskRenderers.task_update,
  task_add_note: taskRenderers.task_add_note,
  task_view: taskRenderers.task_view,

  // Delegation tools
  delegate: delegateRenderer,

  // File operation tools
  file_write: fileWriteRenderer,
  file_read: fileReadRenderer,
};

/**
 * Get the renderer for a specific tool type
 * Returns empty object if no custom renderer exists (uses all fallbacks)
 */
export function getToolRenderer(toolName: string): ToolRenderer {
  return toolRenderers[toolName.toLowerCase()] || {};
}

export type { ToolRenderer, ToolResult } from './types';
