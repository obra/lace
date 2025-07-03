// ABOUTME: Schema-based session task management tools for tracking work items with Zod validation
// ABOUTME: In-memory task storage for current session workflow management with enhanced error handling

import { z } from 'zod';
import { Tool } from '../tool.js';
import { NonEmptyString } from '../schemas/common.js';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types.js';

interface Task {
  id: string;
  description: string;
  completed: boolean;
  createdAt: Date;
  completedAt?: Date;
}

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private nextId = 1;

  addTask(description: string): Task {
    const task: Task = {
      id: this.nextId.toString(),
      description,
      completed: false,
      createdAt: new Date(),
    };

    this.tasks.set(task.id, task);
    this.nextId++;
    return task;
  }

  getTasks(includeCompleted = false): Task[] {
    const allTasks = Array.from(this.tasks.values());

    if (includeCompleted) {
      return allTasks.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    }

    return allTasks
      .filter((task) => !task.completed)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  completeTask(id: string): Task | null {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    task.completed = true;
    task.completedAt = new Date();
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }
}

// Per-thread task stores
const taskStores = new Map<string, TaskStore>();

function getTaskStore(threadId: string = 'default'): TaskStore {
  if (!taskStores.has(threadId)) {
    taskStores.set(threadId, new TaskStore());
  }
  return taskStores.get(threadId)!;
}

// Test helper - only exported for testing
export function clearAllTaskStores(): void {
  taskStores.clear();
}

// TaskAddTool schema - handle both single string and JSON array string
const taskAddSchema = z.object({
  tasks: NonEmptyString,
});

export class TaskAddTool extends Tool {
  name = 'task_add';
  description =
    'Add one or more tasks to the session task list. Supports both single task (string) and multiple tasks (array of strings) for bulk operations.';
  schema = taskAddSchema;
  annotations: ToolAnnotations = {
    idempotentHint: false,
  };

  protected async executeValidated(
    args: z.infer<typeof taskAddSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const tasks = args.tasks;
      let taskDescriptions: string[] = [];

      // Check if it's a JSON array string
      if (tasks.trim().startsWith('[') && tasks.trim().endsWith(']')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(tasks);
        } catch (parseError) {
          return this.createError(
            `Invalid JSON array format. Provide either a single task string or valid JSON array like ["task1", "task2"]. JSON parse error: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
          );
        }

        if (Array.isArray(parsed)) {
          if (parsed.length === 0) {
            return this.createError(
              'Tasks array cannot be empty. Provide at least one task description in the array.'
            );
          }

          // Validate each element is a non-empty string
          for (let i = 0; i < parsed.length; i++) {
            if (typeof parsed[i] !== 'string') {
              return this.createError(
                `Invalid JSON array format. All elements must be strings. Element at index ${i} is ${typeof parsed[i]}.`
              );
            }
            if ((parsed[i] as string).trim() === '') {
              return this.createError(
                `Invalid JSON array format. All elements must be non-empty strings. Element at index ${i} is empty.`
              );
            }
            taskDescriptions.push((parsed[i] as string).trim());
          }
        } else {
          return this.createError(
            'Parsed JSON is not an array. Provide a valid JSON array of strings.'
          );
        }
      } else {
        // Single task as regular string
        taskDescriptions.push(tasks.trim());
      }

      // Add tasks to store
      const taskStore = getTaskStore(context?.threadId);
      const addedTasks: Task[] = [];

      for (const desc of taskDescriptions) {
        const task = taskStore.addTask(desc);
        addedTasks.push(task);
      }

      // Format response
      if (addedTasks.length === 1) {
        // Single task response
        const task = addedTasks[0];
        return this.createResult(`Added task #${task.id}: ${task.description}`);
      } else {
        // Multiple tasks response
        const taskLines = addedTasks.map((task) => `#${task.id}: ${task.description}`);
        return this.createResult(`Added ${addedTasks.length} tasks:\n${taskLines.join('\n')}`);
      }
    } catch (error: unknown) {
      return this.createError(
        `Failed to add tasks: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Provide valid task descriptions and try again.`
      );
    }
  }
}

// TaskListTool schema
const taskListSchema = z.object({
  includeCompleted: z.boolean().default(false),
});

export class TaskListTool extends Tool {
  name = 'task_list';
  description = 'List current session tasks';
  schema = taskListSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof taskListSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { includeCompleted } = args;

      const taskStore = getTaskStore(context?.threadId);
      const tasks = taskStore.getTasks(includeCompleted);

      if (tasks.length === 0) {
        const message = includeCompleted ? 'No tasks found' : 'No pending tasks';
        return this.createResult(message);
      }

      const taskLines = tasks.map((task) => {
        const status = task.completed ? '✓' : '○';
        const timestamp =
          task.completed && task.completedAt
            ? ` (completed ${task.completedAt.toLocaleTimeString()})`
            : '';
        return `${status} #${task.id}: ${task.description}${timestamp}`;
      });

      const summary = includeCompleted
        ? `Tasks (${tasks.filter((t) => !t.completed).length} pending, ${tasks.filter((t) => t.completed).length} completed):`
        : `Pending tasks (${tasks.length}):`;

      return this.createResult(`${summary}\n${taskLines.join('\n')}`);
    } catch (error: unknown) {
      return this.createError(
        `Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the parameters and try again.`
      );
    }
  }
}

// TaskCompleteTool schema
const taskCompleteSchema = z.object({
  id: NonEmptyString,
});

export class TaskCompleteTool extends Tool {
  name = 'task_complete';
  description = 'Mark a task as completed';
  schema = taskCompleteSchema;
  annotations: ToolAnnotations = {
    idempotentHint: false,
  };

  protected async executeValidated(
    args: z.infer<typeof taskCompleteSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { id } = args;

      const taskStore = getTaskStore(context?.threadId);
      const task = taskStore.completeTask(id);

      if (!task) {
        return this.createError(
          `Task #${id} not found. Check the task ID and ensure the task exists.`
        );
      }

      return this.createResult(`Completed task #${task.id}: ${task.description}`);
    } catch (error: unknown) {
      return this.createError(
        `Failed to complete task: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Provide a valid task ID and try again.`
      );
    }
  }
}
