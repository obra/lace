// ABOUTME: Execution handlers for todo list tools
// ABOUTME: Manages the agent's internal todo list stored as markdown

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTodoMarkdown, serializeTodoMarkdown } from './markdown';
import { generateTodoId, type TodoItem } from './types';

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
      done: item.done,
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
 * Execute todo_add - add a new item to the list
 */
export async function executeTodoAdd(
  input: { title?: string; description?: string },
  context: TodoToolContext
): Promise<TodoToolResult> {
  if (!input.title) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'todo_add.title is required' }],
    };
  }

  const items = readTodoList(context.sessionDir);
  const id = generateTodoId();

  const newItem: TodoItem = {
    id,
    done: false,
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

/**
 * Execute todo_update - update an existing item
 */
export async function executeTodoUpdate(
  input: { id?: string; done?: boolean; title?: string; description?: string },
  context: TodoToolContext
): Promise<TodoToolResult> {
  if (!input.id) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'todo_update.id is required' }],
    };
  }

  const items = readTodoList(context.sessionDir);
  const itemIndex = items.findIndex((item) => item.id === input.id);

  if (itemIndex === -1) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: `Item not found: ${input.id}` }],
    };
  }

  const item = items[itemIndex];

  // Update only provided fields
  if (input.done !== undefined) {
    item.done = input.done;
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
    content: [{ type: 'text', text: JSON.stringify({ updated: true }) }],
  };
}

/**
 * Execute todo_remove - remove an item from the list
 */
export async function executeTodoRemove(
  input: { id?: string },
  context: TodoToolContext
): Promise<TodoToolResult> {
  if (!input.id) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: 'todo_remove.id is required' }],
    };
  }

  const items = readTodoList(context.sessionDir);
  const itemIndex = items.findIndex((item) => item.id === input.id);

  if (itemIndex === -1) {
    return {
      status: 'failed',
      content: [{ type: 'text', text: `Item not found: ${input.id}` }],
    };
  }

  items.splice(itemIndex, 1);
  writeTodoList(context.sessionDir, items);

  return {
    status: 'completed',
    content: [{ type: 'text', text: JSON.stringify({ removed: true }) }],
  };
}
