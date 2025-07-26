// ABOUTME: Schema-based delegate tool for spawning subagents with specific tasks using Zod validation
// ABOUTME: Enables efficient token usage by delegating to cheaper models with enhanced parameter validation

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import type { TaskManager } from '~/tasks/task-manager';
import type { Task } from '~/tasks/types';
import { logger } from '~/utils/logger';

// Model format validation
const ModelFormat = z.string().refine(
  (value) => {
    const [providerName, modelName] = value.split(':');
    return providerName && modelName;
  },
  {
    message:
      'Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3-5-haiku-latest")',
  }
);

const delegateSchema = z.object({
  title: NonEmptyString.describe(
    'Short active voice sentence describing the task (e.g., "Find security vulnerabilities")'
  ),
  prompt: NonEmptyString.describe('Complete instructions for the subagent - be specific and clear'),
  expected_response: NonEmptyString.describe(
    'Description of the expected format/content of the response (guides the subagent)'
  ),
  model: ModelFormat.default('anthropic:claude-3-5-haiku-latest').describe(
    'Provider and model in format "provider:model"'
  ),
});

export class DelegateTool extends Tool {
  name = 'delegate';
  description = `Delegate a specific task to a subagent using a less expensive model.
Ideal for research, data extraction, log analysis, or any focused task with clear outputs.
The subagent starts fresh with only your instructions - no conversation history.

Examples:
- title: "Analyze test failures", prompt: "Review the test output and identify the root cause of failures", expected_response: "List of failing tests with specific error reasons"
- title: "Search authentication logs", prompt: "grep through the application logs for authentication errors in the last hour", expected_response: "Timestamps and error messages for each auth failure"
- title: "Count code statistics", prompt: "Count total lines of code, number of files, and test coverage percentage", expected_response: "JSON with {loc: number, files: number, coverage: number}"`;

  schema = delegateSchema;
  annotations: ToolAnnotations = {
    openWorldHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    if (!context?.taskManager) {
      return this.createError('TaskManager is required for delegation');
    }

    try {
      const { title, prompt, expected_response, model } = args;
      return await this.performTaskBasedDelegation(
        { title, prompt, expected_response, model },
        context
      );
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
      model: string;
    },
    context: ToolContext
  ): Promise<ToolResult> {
    const { title, prompt, expected_response, model } = params;
    const taskManager = context.taskManager;

    if (!taskManager) {
      return this.createError('TaskManager context access needs implementation');
    }

    // Parse provider:model format
    const [providerName, modelName] = model.split(':');

    try {
      // Create task with agent spawning
      const task = await taskManager.createTask(
        {
          title,
          prompt: this.formatDelegatePrompt(prompt, expected_response),
          assignedTo: `new:${providerName}/${modelName}`,
          priority: 'high',
        },
        {
          actor: context.threadId || 'unknown',
        }
      );

      logger.debug('DelegateTool: Created task for delegation', {
        taskId: task.id,
        title,
        model: `${providerName}/${modelName}`,
      });

      // Wait for task completion via events
      const result = await this.waitForTaskCompletion(
        task.id,
        taskManager,
        context.threadId || 'unknown'
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
      return this.createError(
        `Task-based delegation failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      );
    }
  }

  private formatDelegatePrompt(prompt: string, expectedResponse: string): string {
    return `${prompt}

IMPORTANT: Your response should match this format/structure:
${expectedResponse}

Please complete the task and provide your response in the expected format.`;
  }

  private async waitForTaskCompletion(
    taskId: string,
    taskManager: TaskManager,
    creatorThreadId: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const handleTaskUpdate = (event: { task: Task; creatorThreadId: string }) => {
        if (event.task.id === taskId && event.creatorThreadId === creatorThreadId) {
          if (event.task.status === 'completed') {
            taskManager.off('task:updated', handleTaskUpdate);
            const response = this.extractResponseFromTask(event.task);
            resolve(response);
          } else if (event.task.status === 'blocked') {
            taskManager.off('task:updated', handleTaskUpdate);
            reject(new Error(`Task ${taskId} is blocked`));
          }
        }
      };

      taskManager.on('task:updated', handleTaskUpdate);
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
