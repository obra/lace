// ABOUTME: Session-based task management tools for tracking work items
// ABOUTME: In-memory task storage for current session workflow management

import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

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

export class TaskAddTool implements Tool {
  name = 'task_add';
  description = 'Add a new task to the session task list';
  annotations = {
    idempotentHint: false,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      description: { type: 'string', description: 'Task description' },
    },
    required: ['description'],
  };

  async executeTool(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const { description } = input as { description: string };

    if (!description || typeof description !== 'string' || description.trim() === '') {
      return createErrorResult('Description must be a non-empty string');
    }

    const taskStore = getTaskStore(context?.threadId);
    const task = taskStore.addTask(description.trim());

    return createSuccessResult([
      {
        type: 'text',
        text: `Added task #${task.id}: ${task.description}`,
      },
    ]);
  }
}

export class TaskListTool implements Tool {
  name = 'task_list';
  description = 'List current session tasks';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      includeCompleted: {
        type: 'boolean',
        description: 'Include completed tasks (default: false)',
      },
    },
    required: [],
  };

  async executeTool(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const { includeCompleted = false } = input as { includeCompleted?: boolean };

    const taskStore = getTaskStore(context?.threadId);
    const tasks = taskStore.getTasks(includeCompleted);

    if (tasks.length === 0) {
      const message = includeCompleted ? 'No tasks found' : 'No pending tasks';
      return createSuccessResult([
        {
          type: 'text',
          text: message,
        },
      ]);
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

    return createSuccessResult([
      {
        type: 'text',
        text: `${summary}\n${taskLines.join('\n')}`,
      },
    ]);
  }
}

export class TaskCompleteTool implements Tool {
  name = 'task_complete';
  description = 'Mark a task as completed';
  annotations = {
    idempotentHint: false,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Task ID to complete' },
    },
    required: ['id'],
  };

  async executeTool(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const { id } = input as { id: string };

    if (!id || typeof id !== 'string') {
      return createErrorResult('Task ID must be a non-empty string');
    }

    const taskStore = getTaskStore(context?.threadId);
    const task = taskStore.completeTask(id);

    if (!task) {
      return createErrorResult(`Task #${id} not found`);
    }

    return createSuccessResult([
      {
        type: 'text',
        text: `Completed task #${task.id}: ${task.description}`,
      },
    ]);
  }
}
