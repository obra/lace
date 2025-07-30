// ABOUTME: Task management tools with multi-agent support and SQLite persistence
// ABOUTME: Provides task creation, querying, updates, and note management capabilities

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext } from '~/tools/types';
import { Task } from '~/tools/implementations/task-manager/types';
import { isAssigneeId, AssigneeId } from '~/threads/types';
import { logger } from '~/utils/logger';

// Simple schema that always takes an array of tasks
const createTaskSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        prompt: z.string().min(1),
        priority: z.enum(['high', 'medium', 'low'] as const).default('medium'),
        assignedTo: z.string().optional().describe('Thread ID or "new:provider/model"'),
      })
    )
    .min(1, 'Must provide at least 1 task')
    .max(20, 'Cannot create more than 20 tasks at once'),
});

export class TaskCreateTool extends Tool {
  name = 'task_add';
  description = `Create tasks to track work - your primary planning tool.

TASK SIZING STRATEGY:
- Each task = one logical commit (atomic, testable change)
- Break down until you can clearly see the implementation path
- If you can't describe specific acceptance criteria, break it down further
- Include enough context for independent work (files, approach, constraints)

WHEN TO BREAK DOWN FURTHER:
- Success criteria contain "and" statements (probably multiple commits)
- You're unsure of the technical approach (create investigation task first)
- Multiple files/systems need coordinating changes
- Task feels overwhelming or vague

WHEN TO ASK FOR HELP:
- Requirements/context unclear (can't write good acceptance criteria)
- Uncertain about technical approach (need validation before proceeding)
- Tried approach isn't working and no clear alternative visible
- Discovered scope is different than initially understood
- Need information/access/decisions you can't get yourself

COMMUNICATION PATTERNS:
- Creating task = claiming responsibility to track it to completion
- Task exists = others will ask "what's the status?"
- Good tasks enable clear progress tracking and independent work
- Poor tasks create confusion, scope creep, and rework

EXAMPLES:
Single task: task_add({ tasks: [{
  title: "Add failing test for bulk task creation", 
  prompt: "Create test in bulk-tasks.test.ts that expects task_add to accept {tasks: []} format. Test should fail initially. Files: src/tools/implementations/task-manager/bulk-tasks.test.ts",
  priority: "high"
}]})

Investigation task: task_add({ tasks: [{
  title: "Investigate auth timeout root cause",
  prompt: "Users report 5min logout instead of 30min. Debug token expiration, session storage, renewal logic. Output: specific root cause + recommended fix approach. Context: blocking beta release",
  priority: "high"
}]})

Bulk planning: task_add({ tasks: [
  {title: "Write failing test for union schema", prompt: "Test that createTaskSchema accepts both single task and {tasks: array} formats"},
  {title: "Update schema to union type", prompt: "Change createTaskSchema to z.union([singleTaskSchema, bulkTasksSchema])"},  
  {title: "Implement bulk creation logic", prompt: "Handle both formats in executeValidated, validate all before creating any"},
  {title: "Update tool description", prompt: "Add bulk examples and task sizing guidance to description"}
]}`;
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

    try {
      const taskManager = this.getTaskManager();
      const taskContext = {
        actor: context.threadId,
        isHuman: false,
      };

      // Validate all assignees before creating any tasks
      for (const taskData of args.tasks) {
        if (taskData.assignedTo && !isAssigneeId(taskData.assignedTo)) {
          return this.createError(`Invalid assignee format: ${taskData.assignedTo}`);
        }
      }

      // Create all tasks atomically (all succeed or all fail)
      const createdTasks = [];
      try {
        for (const taskData of args.tasks) {
          const task = await taskManager.createTask(
            {
              title: taskData.title,
              description: taskData.description,
              prompt: taskData.prompt,
              priority: taskData.priority,
              assignedTo: taskData.assignedTo,
            },
            taskContext
          );
          createdTasks.push(task);
        }
      } catch (error) {
        // If any task creation fails, we don't need explicit rollback
        // since TaskManager.createTask is atomic per task
        // and we haven't committed any partial state
        throw new Error(
          `Failed to create task ${createdTasks.length + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }

      // Format response
      if (createdTasks.length === 1) {
        const task = createdTasks[0];
        let message = `Created task ${task.id}: ${task.title}`;
        if (task.assignedTo) {
          message += ` (assigned to ${task.assignedTo})`;
        }
        return this.createResult(message);
      } else {
        const taskSummaries = createdTasks.map((task) => {
          let summary = `${task.id}: ${task.title}`;
          if (task.assignedTo) summary += ` → ${task.assignedTo}`;
          return summary;
        });

        return this.createResult(
          `Created ${createdTasks.length} tasks:\n${taskSummaries.join('\n')}`
        );
      }
    } catch (error) {
      return this.createError(
        `Failed to create task(s): ${error instanceof Error ? error.message : 'Unknown error'}`
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
  description = `List tasks filtered by assignment, creation, or thread context.

Filters:
- 'thread' (default): All tasks in current conversation
- 'mine': Tasks assigned to me  
- 'created': Tasks I created
- 'all': All tasks I can see (assigned to me or in my thread)

Options:
- includeCompleted: false (default) | true to show completed tasks

Use regularly to:
- Check your current workload before starting new tasks
- See what tasks are assigned to subagents
- Track overall progress on complex requests

Example: task_list({ filter: "mine", includeCompleted: false })`;
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
  description = `Mark a task as completed with your results or findings.

Required:
- id: Task ID to complete
- message: Description of what was accomplished, findings, or results

The message becomes part of the permanent task record and helps others understand what was done.

Always include:
- What you accomplished or discovered
- Key results or outputs
- Any issues encountered  
- Next steps if applicable

Example: task_complete({ id: "task_123", message: "Fixed authentication bug in auth.js line 45. Token validation was checking wrong expiration field. All tests now pass. Updated documentation." })`;
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

      logger.debug('TaskCompleteTool: Starting task completion', {
        taskId: args.id,
        actor: context.threadId,
      });

      // Add the completion message as a note first
      await taskManager.addNote(args.id, args.message, taskContext);
      logger.debug('TaskCompleteTool: Added completion note', { taskId: args.id });

      // Then mark the task as completed
      const task = await taskManager.updateTask(args.id, { status: 'completed' }, taskContext);
      logger.debug('TaskCompleteTool: Task marked as completed', {
        taskId: args.id,
        status: task.status,
      });

      return this.createResult(`Completed task ${args.id}: ${task.title}`);
    } catch (error) {
      logger.error('TaskCompleteTool: Failed to complete task', {
        taskId: args.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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
  description = `Update task properties like status, assignment, priority, or content.

Use for:
- Marking tasks in progress: task_update({ taskId: "task_123", status: "in_progress" })
- Changing priority: task_update({ taskId: "task_123", priority: "high" })
- Reassigning work: task_update({ taskId: "task_123", assignTo: "new:anthropic/claude-3-5-haiku-20241022" })
- Updating requirements: task_update({ taskId: "task_123", prompt: "Updated requirements..." })

Status options: pending, in_progress, completed, blocked
Priority options: high, medium, low

Example: task_update({ taskId: "task_123", status: "blocked", prompt: "Blocked on API access - need credentials" })`;
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

      const updatedTask = await taskManager.updateTask(args.taskId, updates, taskContext);

      const updateMessages = [];
      if (args.status) updateMessages.push(`status to ${args.status}`);
      if (args.assignTo) updateMessages.push(`assigned to ${updatedTask.assignedTo}`);
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
  description = `Add a note to a task for communication between agents or progress updates.

COMMUNICATION STRATEGY:
- Each note = specific progress update or finding (not just "working on it")
- Include what you discovered, decided, or need
- Help others understand current state without reading your mind
- Good notes enable handoffs and collaboration

WHEN TO ADD NOTES:
- Found something significant (root cause, key insight, blocker)
- Made a technical decision that affects the approach
- Need input/clarification on requirements or constraints
- Completed a meaningful subtask within larger work
- Hit a blocker and need specific help

EFFECTIVE NOTE PATTERNS:
- Status: "Implemented user validation. Next: password hashing middleware"
- Finding: "Root cause: database connection timeout after 30s. Need to tune connection pool"
- Decision: "Using JWT over sessions for better API scalability. Refs: RFC 7519"
- Blocker: "Need staging database credentials to test migration. Who can provide?"
- Question: "Should user deletion be soft delete or hard delete? Affects audit requirements"

EXAMPLES:
- Progress: task_add_note({ taskId: "task_123", note: "Auth endpoints implemented and tested. Working on middleware integration. ETA: 2 hours" })
- Technical finding: task_add_note({ taskId: "task_123", note: "Performance issue found: N+1 query in user.getPermissions(). Switching to eager loading. 40ms -> 4ms improvement" })
- Blocker: task_add_note({ taskId: "task_123", note: "Blocked: staging API returns 403 for all requests. Need to verify API key configuration. @jesse can you check?" })

Notes become part of permanent task history - write for future readers.`;
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
  description = `View detailed information about a specific task including notes and history.

Shows:
- Task metadata (title, status, priority, assignments)  
- Full prompt and description
- All notes and communications
- Creation and update timestamps

Use for:
- Understanding task requirements before starting work
- Reviewing progress and decisions made
- Getting context on tasks assigned to you
- Checking task status and notes

Example: task_view({ taskId: "task_123" })`;
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
