// ABOUTME: Types for the agent's internal todo list management
// ABOUTME: Simple task tracking with unique IDs, stored as markdown

/**
 * Trinary status for todo items
 * - pending: task not yet done
 * - done: task completed
 * - removed: task should be removed from list (filtered out on save)
 */
export type TodoStatus = 'pending' | 'done' | 'removed';

/**
 * A single todo item with unique ID
 */
export interface TodoItem {
  id: string;
  status: TodoStatus;
  title: string;
  description?: string;
}

/**
 * Result from todo_write containing the item's ID
 */
export interface TodoWriteResult {
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
