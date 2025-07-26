// ABOUTME: Task management tools with multi-agent support and SQLite persistence
// ABOUTME: Provides task creation, querying, updates, and note management capabilities

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext } from '~/tools/types';
import { Task } from '~/tools/implementations/task-manager/types';
import { isAssigneeId, AssigneeId } from '~/threads/types';

// Schema for task creation
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low'] as const).default('medium'),
  assignedTo: z.string().optional().describe('Thread ID or "new:provider/model"'),
});

export class TaskCreateTool extends Tool {
  name = 'task_add';
  description = 'Create a new task with detailed instructions for execution';
  schema = createTaskSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof createTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for task creation');
    }

    // Validate assignee if provided
    if (args.assignedTo && !isAssigneeId(args.assignedTo)) {
      return this.createError(`Invalid assignee format: ${args.assignedTo}`);
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      const task = await taskManager.createTask(
        {
          title: args.title,
          description: args.description,
          prompt: args.prompt,
          priority: args.priority,
          assignedTo: args.assignedTo,
        },
        taskContext
      );

      let message = `Created task ${task.id}: ${task.title}`;
      if (task.assignedTo) {
        message += ` (assigned to ${task.assignedTo})`;
      }

      return this.createResult(message);
    } catch (error) {
      return this.createError(
        `Failed to create task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for task listing
const listTasksSchema = z.object({
  filter: z.enum(['mine', 'created', 'thread', 'all']).default('thread'),
  includeCompleted: z.boolean().default(false),
});

export class TaskListTool extends Tool {
  name = 'task_list';
  description = 'List tasks filtered by assignment, creation, or thread';
  schema = listTasksSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof listTasksSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for task listing');
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      const tasks = await Promise.resolve(
        taskManager.listTasks(args.filter, args.includeCompleted, taskContext)
      );

      // Sort by priority and creation date
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      tasks.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      if (tasks.length === 0) {
        return this.createResult('No tasks found');
      }

      // Format task list
      const lines = tasks.map((task) => {
        const status =
          task.status === 'completed'
            ? '✓'
            : task.status === 'in_progress'
              ? '◐'
              : task.status === 'blocked'
                ? '⊗'
                : '○';

        let line = `${status} ${task.id} [${task.priority}] ${task.title}`;

        if (task.assignedTo) {
          line += ` → ${task.assignedTo}`;
        }

        if (task.status !== 'pending') {
          line += ` [${task.status}]`;
        }

        return line;
      });

      const header = `Tasks (${args.filter}): ${tasks.length} found`;
      return this.createResult(`${header}\n\n${lines.join('\n')}`);
    } catch (error) {
      return this.createError(
        `Failed to list tasks: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for task completion
const completeTaskSchema = z.object({
  id: NonEmptyString,
  message: NonEmptyString.describe('Completion message or result to add as a note'),
});

export class TaskCompleteTool extends Tool {
  name = 'task_complete';
  description = 'Mark a task as completed with a completion message or result';
  schema = completeTaskSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof completeTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for task completion');
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      // Add the completion message as a note first
      await taskManager.addNote(args.id, args.message, taskContext);

      // Then mark the task as completed
      const task = await taskManager.updateTask(args.id, { status: 'completed' }, taskContext);

      return this.createResult(`Completed task ${args.id}: ${task.title}`);
    } catch (error) {
      return this.createError(
        `Failed to complete task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for general task updates
const updateTaskSchema = z
  .object({
    taskId: NonEmptyString,
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked'] as const).optional(),
    assignTo: z.string().describe('Thread ID or "new:provider/model"').optional(),
    priority: z.enum(['high', 'medium', 'low'] as const).optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    prompt: z.string().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 1, // At least one field besides taskId
    { message: 'Must provide at least one field to update' }
  );

export class TaskUpdateTool extends Tool {
  name = 'task_update';
  description = 'Update task properties (status, assignment, priority, etc.)';
  schema = updateTaskSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof updateTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for task updates');
    }

    // Validate assignee if provided
    if (args.assignTo && !isAssigneeId(args.assignTo)) {
      return this.createError(`Invalid assignee format: ${args.assignTo}`);
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      const updates: Partial<Task> = {};
      if (args.status) updates.status = args.status;
      if (args.assignTo) updates.assignedTo = args.assignTo as AssigneeId;
      if (args.priority) updates.priority = args.priority;
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.prompt) updates.prompt = args.prompt;

      await taskManager.updateTask(args.taskId, updates, taskContext);

      const updateMessages = [];
      if (args.status) updateMessages.push(`status to ${args.status}`);
      if (args.assignTo) updateMessages.push(`assigned to ${args.assignTo}`);
      if (args.priority) updateMessages.push(`priority to ${args.priority}`);
      if (args.title) updateMessages.push('title');
      if (args.description) updateMessages.push('description');
      if (args.prompt) updateMessages.push('prompt');

      return this.createResult(`Updated task ${args.taskId}: ${updateMessages.join(', ')}`);
    } catch (error) {
      return this.createError(
        `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for adding notes
const addNoteSchema = z.object({
  taskId: NonEmptyString,
  note: NonEmptyString,
});

export class TaskAddNoteTool extends Tool {
  name = 'task_add_note';
  description = 'Add a note to a task for communication between agents';
  schema = addNoteSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof addNoteSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for adding notes');
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      await taskManager.addNote(args.taskId, args.note, taskContext);

      return this.createResult(`Added note to task ${args.taskId}`);
    } catch (error) {
      return this.createError(
        `Failed to add note: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for viewing task details
const viewTaskSchema = z.object({
  taskId: NonEmptyString,
});

export class TaskViewTool extends Tool {
  name = 'task_view';
  description = 'View detailed information about a specific task';
  schema = viewTaskSchema;
  annotations = {
    safeInternal: true,
  };

  // This will be injected by the factory
  protected getTaskManager?: () => import('~/tasks/task-manager').TaskManager;

  protected async executeValidated(
    args: z.infer<typeof viewTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    if (!this.getTaskManager) {
      return this.createError('TaskManager is required for viewing tasks');
    }

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      const task = await Promise.resolve(taskManager.getTask(args.taskId, taskContext));

      if (!task) {
        return this.createError(`Task ${args.taskId} not found`);
      }

      // Format task details
      const lines: string[] = [
        `Task: ${task.id}`,
        `Title: ${task.title}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
        `Created by: ${task.createdBy}`,
        `Created at: ${task.createdAt.toLocaleString()}`,
      ];

      if (task.description) {
        lines.push(`Description: ${task.description}`);
      }

      lines.push(`\nPrompt:\n${task.prompt}`);

      if (task.assignedTo) {
        lines.push(`\nAssigned to: ${task.assignedTo}`);
      }

      if (task.notes.length > 0) {
        lines.push('\nNotes:');
        task.notes.forEach((note, i) => {
          lines.push(`  ${i + 1}. [${note.author}] ${note.timestamp.toLocaleString()}`);
          lines.push(`     ${note.content}`);
        });
      }

      return this.createResult(lines.join('\n'));
    } catch (error) {
      return this.createError(
        `Failed to view task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
