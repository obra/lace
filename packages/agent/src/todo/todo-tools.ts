// ABOUTME: Execution handlers for todo list tools
// ABOUTME: Manages the agent's internal todo list stored as markdown

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTodoMarkdown, serializeTodoMarkdown } from './markdown';
import { generateTodoId, type TodoItem, type TodoStatus } from './types';

const TODO_FILENAME = 'todo.md';

/**
 * Context for todo tool execution
 */
export interface TodoToolContext {
  sessionDir: string;
}

/**
 * Result from executing a todo tool
 */
export interface TodoToolResult {
  status: 'completed' | 'failed';
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Get the path to the todo file
 */
function getTodoPath(sessionDir: string): string {
  return join(sessionDir, TODO_FILENAME);
}

/**
 * Read the current todo list from disk
 */
function readTodoList(sessionDir: string): TodoItem[] {
  const todoPath = getTodoPath(sessionDir);
  if (!existsSync(todoPath)) {
    return [];
  }
  const content = readFileSync(todoPath, 'utf-8');
  return parseTodoMarkdown(content);
}

/**
 * Write the todo list to disk
 */
function writeTodoList(sessionDir: string, items: TodoItem[]): void {
  const todoPath = getTodoPath(sessionDir);
  const content = serializeTodoMarkdown(items);
  writeFileSync(todoPath, content, 'utf-8');
}

/**
 * Execute todo_read - read the current todo list
 */
export async function executeTodoRead(
  _input: Record<string, unknown>,
  context: TodoToolContext
): Promise<TodoToolResult> {
  const items = readTodoList(context.sessionDir);

  // Remove undefined description fields for cleaner output
  const cleanItems = items.map((item) => {
    const clean: Record<string, unknown> = {
      id: item.id,
      status: item.status,
      title: item.title,
    };
    if (item.description !== undefined) {
      clean.description = item.description;
    }
    return clean;
  });

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify({ items: cleanItems }) }],
  };
}

/**
 * Execute todo_write - add a new item or update an existing one
 *
 * - No `id` provided → create new item (generate ID, status defaults to 'pending')
 * - `id` provided → update existing item
 * - `status: 'removed'` → item will be filtered out when saved
 */
export async function executeTodoWrite(
  input: { id?: string; title?: string; description?: string; status?: TodoStatus },
  context: TodoToolContext
): Promise<TodoToolResult> {
  const items = readTodoList(context.sessionDir);

  // CREATE: No id provided - add new item
  if (!input.id) {
    if (!input.title) {
      return {
        status: 'failed',
        content: [{ type: 'text', text: 'todo_write requires title when creating new item' }],
      };
    }

    const id = generateTodoId();
    const newItem: TodoItem = {
      id,
      status: input.status ?? 'pending',
      title: input.title,
      description: input.description,
    };

    items.push(newItem);
    writeTodoList(context.sessionDir, items);

    return {
      status: 'completed',
      content: [{ type: 'text', text: JSON.stringify({ id }) }],
    };
  }

  // UPDATE: id provided - update existing item
  const itemIndex = items.findIndex((item) => item.id === input.id);

  if (itemIndex === -1) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: `Item not found: ${input.id}` }],
    };
  }

  const item = items[itemIndex];

  // Update only provided fields
  if (input.status !== undefined) {
    item.status = input.status;
  }
  if (input.title !== undefined) {
    item.title = input.title;
  }
  if (input.description !== undefined) {
    item.description = input.description;
  }

  writeTodoList(context.sessionDir, items);

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify({ id: input.id }) }],
  };
}
