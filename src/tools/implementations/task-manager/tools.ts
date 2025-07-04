// ABOUTME: Task management tools with multi-agent support and SQLite persistence
// ABOUTME: Provides task creation, querying, updates, and note management capabilities

import { z } from 'zod';
import { Tool } from '../../tool.js';
import { NonEmptyString } from '../../schemas/common.js';
import type { ToolResult, ToolContext } from '../../types.js';
import { TaskPersistence } from './persistence.js';
import { Task, TaskNote } from './types.js';
import { isAssigneeId, AssigneeId, ThreadId } from '../../../threads/types.js';

// Helper to generate task IDs
function generateTaskId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `task_${date}_${random}`;
}

// Schema for task creation
const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  prompt: z.string().min(1),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  assignedTo: z.string().optional().describe('Thread ID or "new:provider/model"'),
});

export class TaskCreateTool extends Tool {
  name = 'task_create';
  description = 'Create a new task with detailed instructions for execution';
  schema = createTaskSchema;

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof createTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Validate assignee if provided
    if (args.assignedTo && !isAssigneeId(args.assignedTo)) {
      return this.createError(`Invalid assignee format: ${args.assignedTo}`);
    }

    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    const task: Task = {
      id: generateTaskId(),
      title: args.title,
      description: args.description || '',
      prompt: args.prompt,
      priority: args.priority,
      status: 'pending',
      assignedTo: args.assignedTo as AssigneeId | undefined,
      createdBy: context.threadId,
      threadId: context.parentThreadId || context.threadId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: [],
    };

    try {
      await this.persistence.saveTask(task);
      
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

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof listTasksSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    const parentThreadId = context.parentThreadId || context.threadId;
    let tasks: Task[] = [];

    try {
      switch (args.filter) {
        case 'mine':
          // Tasks assigned to me
          tasks = this.persistence.loadTasksByAssignee(context.threadId);
          break;
        
        case 'created':
          // Tasks I created
          tasks = this.persistence.loadTasksByThread(parentThreadId)
            .filter(t => t.createdBy === context.threadId);
          break;
        
        case 'thread':
          // All tasks in parent thread
          tasks = this.persistence.loadTasksByThread(parentThreadId);
          break;
        
        case 'all':
          // All tasks I can see (assigned to me or in my thread)
          const assignedToMe = this.persistence.loadTasksByAssignee(context.threadId);
          const inThread = this.persistence.loadTasksByThread(parentThreadId);
          const taskMap = new Map<string, Task>();
          
          [...assignedToMe, ...inThread].forEach(t => taskMap.set(t.id, t));
          tasks = Array.from(taskMap.values());
          break;
      }

      // Filter completed if needed
      if (!args.includeCompleted) {
        tasks = tasks.filter(t => t.status !== 'completed');
      }

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
      const lines = tasks.map(task => {
        const status = task.status === 'completed' ? '✓' : 
                      task.status === 'in_progress' ? '◐' : 
                      task.status === 'blocked' ? '⊗' : '○';
        
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

// Schema for status update
const updateStatusSchema = z.object({
  taskId: NonEmptyString,
  status: z.enum(['pending', 'in_progress', 'completed', 'blocked']),
});

export class TaskUpdateStatusTool extends Tool {
  name = 'task_update_status';
  description = 'Update the status of a task';
  schema = updateStatusSchema;

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof updateStatusSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const task = this.persistence.loadTask(args.taskId);
      if (!task) {
        return this.createError(`Task ${args.taskId} not found`);
      }

      await this.persistence.updateTask(args.taskId, { status: args.status });
      
      return this.createResult(
        `Updated task ${args.taskId} status to ${args.status}`
      );
    } catch (error) {
      return this.createError(
        `Failed to update task: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Schema for reassignment
const reassignTaskSchema = z.object({
  taskId: NonEmptyString,
  assignTo: z.string().describe('Thread ID or "new:provider/model"'),
});

export class TaskReassignTool extends Tool {
  name = 'task_reassign';
  description = 'Reassign a task to another agent';
  schema = reassignTaskSchema;

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof reassignTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    // Validate assignee format
    if (!isAssigneeId(args.assignTo)) {
      return this.createError(`Invalid assignee format: ${args.assignTo}`);
    }

    try {
      const task = this.persistence.loadTask(args.taskId);
      if (!task) {
        return this.createError(`Task ${args.taskId} not found`);
      }

      await this.persistence.updateTask(args.taskId, { 
        assignedTo: args.assignTo as AssigneeId 
      });
      
      return this.createResult(
        `Reassigned task ${args.taskId} to ${args.assignTo}`
      );
    } catch (error) {
      return this.createError(
        `Failed to reassign task: ${error instanceof Error ? error.message : 'Unknown error'}`
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

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof addNoteSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.threadId) {
      return this.createError('No thread context available');
    }

    try {
      const note: Omit<TaskNote, 'id'> = {
        author: context.threadId,
        content: args.note,
        timestamp: new Date(),
      };

      await this.persistence.addNote(args.taskId, note);
      
      return this.createResult(
        `Added note to task ${args.taskId}`
      );
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

  constructor(private persistence: TaskPersistence) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof viewTaskSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const task = this.persistence.loadTask(args.taskId);
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