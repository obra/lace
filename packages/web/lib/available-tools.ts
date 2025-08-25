// ABOUTME: Centralized list of available tools for configuration components
// ABOUTME: Single source of truth for tool lists used across the web interface

export const AVAILABLE_TOOLS = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'file_list',
  'file_find',
  'url_fetch',
  'ripgrep_search',
  'file_insert',
  'delegate',
  'task_add',
  'task_list',
  'task_complete',
  'task_update',
  'task_add_note',
  'task_view',
] as const;

export type AvailableTool = (typeof AVAILABLE_TOOLS)[number];
