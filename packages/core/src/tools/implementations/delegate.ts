// ABOUTME: Schema-based delegate tool for spawning subagents with specific tasks using Zod validation
// ABOUTME: Enables efficient token usage by delegating to cheaper models with enhanced parameter validation

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import type { TaskManager } from '~/tasks/task-manager';
import type { Task, TaskContext } from '~/tasks/types';
import { logger } from '~/utils/logger';

// Schema for bulk delegation - matches task_create format
const delegateSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            title: NonEmptyString.describe(
              'Short active voice sentence describing the task (e.g., "Find security vulnerabilities")'
            ),
            prompt: NonEmptyString.describe(
              'Complete instructions for the subagent - be specific and clear'
            ),
            expected_response: NonEmptyString.describe(
              'Description of the expected format/content of the response (guides the subagent)'
            ),
            assignedTo: z.string().describe('NewAgentSpec format: "new:persona[;modelSpec]"'),
          })
          .strict() // Reject unknown properties to match JSON schema
      )
      .min(1, 'Must provide at least 1 task')
      .max(10, 'Cannot delegate more than 10 tasks at once'),
  })
  .strict(); // Reject unknown properties at root level too

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Delegate tasks to subagents with specific models - same format as task_create.
Ideal for research, data extraction, log analysis, or any focused task with clear outputs.
Each subagent starts fresh with only your instructions - no conversation history.

assignedTo format: "new:persona[;modelSpec]" where modelSpec can be:
- "fast" - Use the configured fast model (typically Haiku)
- "smart" - Use the configured smart model (typically Sonnet or GPT-4)
- "provider:model" - Use a specific provider and model

Examples:
Single delegation: delegate({ tasks: [{
  title: "Analyze test failures",
  prompt: "Review the test output and identify the root cause of failures",
  expected_response: "List of failing tests with specific error reasons",
  assignedTo: "new:lace;fast"
}]})

Multiple delegations: delegate({ tasks: [
  {
    title: "Search authentication logs",
    prompt: "grep through the application logs for authentication errors in the last hour",
    expected_response: "Timestamps and error messages for each auth failure",
    assignedTo: "new:lace;anthropic:claude-3-5-haiku-20241022"
  },
  {
    title: "Analyze security vulnerabilities",
    prompt: "Review the codebase for potential security issues",
    expected_response: "List of vulnerabilities with severity and mitigation steps",
    assignedTo: "new:security-analyst;anthropic:claude-sonnet-4-20250514"
  }
]})`;

  schema = delegateSchema;
  annotations: ToolAnnotations = {
    openWorldHint: true,
  };

  // Get TaskManager from session context
  private async getTaskManagerFromContext(context?: ToolContext): Promise<TaskManager | null> {
    const session = await context?.agent?.getFullSession();
    return session?.getTaskManager() || null;
  }

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context: ToolContext
  ): Promise<ToolResult> {
    if (context.signal.aborted) {
      return this.createCancellationResult();
    }
    const taskManager = await this.getTaskManagerFromContext(context);
    if (!taskManager) {
      return this.createError('TaskManager is required for delegation');
    }

    try {
      const createdTasks: Array<{ title: string; assignedTo: string }> = [];
      const results: ToolResult[] = [];

      // Create and delegate all tasks
      for (const taskData of args.tasks) {
        const { title, prompt, expected_response, assignedTo } = taskData;

        // Validate assignedTo format
        if (!assignedTo.startsWith('new:')) {
          return this.createError(
            `Invalid assignedTo format: ${assignedTo}. Must be "new:persona[;modelSpec]"`
          );
        }

        const result = await this.performTaskBasedDelegation(
          { title, prompt, expected_response, assignedTo },
          context
        );

        // Check if delegation failed
        if (result.status === 'failed') {
          return result; // Return the error immediately
        }

        results.push(result);
        createdTasks.push({ title, assignedTo });
      }

      // Format response
      if (createdTasks.length === 1) {
        return results[0]; // Return single result directly
      } else {
        // Multiple tasks - format summary
        const summary = createdTasks
          .map((t, i) => `${i + 1}. ${t.title} (delegated to ${t.assignedTo})`)
          .join('\n');

        const fullResults = results
          .map((r, i) => `\n=== Task ${i + 1}: ${createdTasks[i].title} ===\n${r.content[0].text}`)
          .join('\n');

        return this.createResult(
          `Delegated ${createdTasks.length} tasks:\n${summary}${fullResults}`
        );
      }
    } catch (error: unknown) {
      return this.createError(
        `Delegate tool execution failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the parameters and try again.`
      );
    }
  }

  private async performTaskBasedDelegation(
    params: {
      title: string;
      prompt: string;
      expected_response: string;
      assignedTo: string;
    },
    context?: ToolContext
  ): Promise<ToolResult> {
    const { title, prompt, expected_response, assignedTo } = params;
    const taskManager = await this.getTaskManagerFromContext(context);
    if (!taskManager) {
      throw new Error('TaskManager is required for delegation');
    }

    try {
      // assignedTo is already in NewAgentSpec format: "new:persona[;modelSpec]"
      const assigneeSpec = assignedTo;

      logger.debug('DelegateTool: Creating task with agent spawning', {
        title,
        assignedTo: assigneeSpec,
        actor: context?.agent?.threadId || 'unknown',
      });

      // Create task with assignment in single operation
      const task = await taskManager.createTask(
        {
          title,
          prompt: this.formatDelegatePrompt(prompt, expected_response),
          priority: 'high',
          assignedTo: assigneeSpec,
        },
        {
          actor: context?.agent?.threadId || 'human',
        }
      );

      logger.debug('DelegateTool: Task created successfully', {
        taskId: task.id,
        status: task.status,
      });

      logger.debug('DelegateTool: Created task for delegation', {
        taskId: task.id,
        title,
        assignedTo,
      });

      // Wait for task completion via events
      const result = await this.waitForTaskCompletion(
        task.id,
        taskManager,
        context?.agent?.threadId || 'unknown',
        context?.signal
      );

      logger.debug('DelegateTool: Task completed', {
        taskId: task.id,
        resultLength: result.length,
      });

      return this.createResult(result, {
        taskTitle: title,
        taskId: task.id,
      });
    } catch (error: unknown) {
      // Handle cancellation
      if (error instanceof Error && error.message === 'Aborted') {
        return this.createCancellationResult();
      }
      return this.createError(
        `Task-based delegation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      );
    }
  }

  private formatDelegatePrompt(prompt: string, expectedResponse: string): string {
    return `${prompt}

IMPORTANT: Your response should match this format/structure:
${expectedResponse}

When you are done, use the task_complete tool with your result/answer as the message parameter.

Please complete the task and provide your response in the expected format.`;
  }

  private async waitForTaskCompletion(
    taskId: string,
    taskManager: TaskManager,
    creatorThreadId: string,
    signal?: AbortSignal
  ): Promise<string> {
    logger.debug('DelegateTool: Starting to wait for task completion', {
      taskId,
      creatorThreadId,
    });

    return new Promise((resolve, reject) => {
      const handleTaskUpdate = (event: { task: Task; context: TaskContext; type: string }) => {
        logger.debug('DelegateTool: Received task update event', {
          taskId: event.task.id,
          status: event.task.status,
          eventCreatorContext: event.context?.actor,
          expectedTaskId: taskId,
          expectedCreatorThreadId: creatorThreadId,
        });

        // Match on task ID only - the assigned agent will complete it
        if (event.task.id === taskId) {
          if (event.task.status === 'completed') {
            logger.debug('DelegateTool: Task completed, resolving', { taskId });
            taskManager.off('task:updated', handleTaskUpdate);
            signal?.removeEventListener('abort', abortHandler);
            const response = this.extractResponseFromTask(event.task);
            resolve(response);
          } else if (event.task.status === 'blocked') {
            logger.debug('DelegateTool: Task blocked, rejecting', { taskId });
            taskManager.off('task:updated', handleTaskUpdate);
            signal?.removeEventListener('abort', abortHandler);
            reject(new Error(`Task ${taskId} is blocked`));
          }
        }
      };

      const abortHandler = () => {
        logger.debug('DelegateTool: Task aborted', { taskId });
        taskManager.off('task:updated', handleTaskUpdate);
        reject(new Error('Aborted'));
      };

      // Check if already aborted
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      taskManager.on('task:updated', handleTaskUpdate);
      signal?.addEventListener('abort', abortHandler);
      logger.debug('DelegateTool: Registered task update handler', {
        taskId,
      });
    });
  }

  private extractResponseFromTask(task: Task): string {
    // Get the agent's response from task notes
    const response = task.notes
      .filter((note) => note.author !== task.createdBy) // Exclude creator's notes
      .map((note) => note.content)
      .join('\n\n');

    return response || 'Task completed without response';
  }
}
