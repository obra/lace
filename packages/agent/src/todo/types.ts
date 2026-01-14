// ABOUTME: Types for the agent's internal todo list management
// ABOUTME: Simple task tracking with unique IDs, stored as markdown

/**
 * A single todo item with unique ID
 */
export interface TodoItem {
  id: string;
  done: boolean;
  title: string;
  description?: string;
}

/**
 * Result from todo_add containing the new item's ID
 */
export interface TodoAddResult {
  id: string;
}

/**
 * Generate a short unique ID for a todo item
 * Format: t_xxx (3 alphanumeric chars)
 */
export function generateTodoId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 't_';
  for (let i = 0; i < 3; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
