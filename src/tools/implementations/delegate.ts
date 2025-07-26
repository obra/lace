// ABOUTME: Schema-based delegate tool for spawning subagents with specific tasks using Zod validation
// ABOUTME: Enables efficient token usage by delegating to cheaper models with enhanced parameter validation

import { z } from 'zod';
import { Tool } from '~/tools/tool';
import { NonEmptyString } from '~/tools/schemas/common';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { ApprovalDecision } from '~/tools/approval-types';
import { Agent } from '~/agents/agent';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider } from '~/providers/base-provider';
import { TokenBudgetConfig } from '~/token-management/types';
import { ProviderRegistry } from '~/providers/registry';
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

  // Dependencies injected by the main agent's context
  private parentAgent?: Agent;
  private parentToolExecutor?: ToolExecutor;

  protected async executeValidated(
    args: z.infer<typeof delegateSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { title, prompt, expected_response, model } = args;

      // Check if we have TaskManager in context for new task-based approach
      if (context?.taskManager) {
        return await this.performTaskBasedDelegation(
          { title, prompt, expected_response, model },
          context
        );
      }

      // Fall back to old delegation approach if no TaskManager
      return await this.performDelegation({ title, prompt, expected_response, model });
    } catch (error: unknown) {
      return this.createError(
        `Delegate tool execution failed: ${error instanceof Error ? error.message : 'Unknown error occurred'}. Check the parameters and try again.`
      );
    }
  }

  private async performDelegation(params: {
    title: string;
    prompt: string;
    expected_response: string;
    model: string;
  }): Promise<ToolResult> {
    const { title, prompt, expected_response, model } = params;

    // Parse provider:model format
    const [providerName, modelName] = model.split(':');

    try {
      // Create provider for subagent
      const provider = this.createProvider(providerName, modelName, expected_response);
      if (!provider) {
        return this.createError(`Unknown provider: ${providerName}`);
      }

      // Use parent agent for delegation
      if (!this.parentAgent) {
        return this.createError('Delegate tool not properly initialized - missing parent Agent');
      }

      // Create restricted tool executor for subagent (remove delegate to prevent recursion)
      if (!this.parentToolExecutor) {
        return this.createError(
          'Delegate tool not properly initialized - missing parent ToolExecutor'
        );
      }

      const toolExecutor = this.createRestrictedToolExecutor();

      // Note: Delegation metadata is now shown in the delegation box UI

      // Configure token budget for subagent (more conservative than parent)
      const tokenBudget: TokenBudgetConfig = {
        warningThreshold: 0.7,
        maxTokens: 50000, // Lower limit for subagents
        reserveTokens: 1000, // Keep some tokens in reserve
      };

      // Create subagent using parent Agent's delegation method
      let subagent: Agent | null = null; // Declare outside try block
      logger.debug('DelegateTool: Creating subagent via parent Agent');
      try {
        subagent = this.parentAgent.createDelegateAgent(toolExecutor, provider, tokenBudget);

        // Collect responses
        const responses: string[] = [];

        // Set up event handlers
        subagent.on('agent_response_complete', ({ content }) => {
          responses.push(content);
        });

        // Start subagent
        logger.debug('DelegateTool: Starting subagent');
        await subagent.start();

        // Send the task
        const taskMessage = `Task: ${title}\n\n${prompt}`;
        logger.debug('DelegateTool: Sending message to subagent', {
          taskMessageLength: taskMessage.length,
        });

        // Create promise that resolves when conversation completes (no timeout)
        const resultPromise = new Promise<void>((resolve, reject) => {
          const completeHandler = () => {
            logger.debug('DelegateTool: Subagent conversation complete', { title });
            resolve();
          };

          const errorHandler = ({ error }: { error: Error }) => {
            logger.error('DelegateTool: Subagent error during conversation', {
              title,
              error: error.message,
            });
            reject(error);
          };

          subagent!.once('conversation_complete', completeHandler);
          subagent!.once('error', errorHandler);
        });

        // Send message and wait for completion
        await subagent.sendMessage(taskMessage);
        await resultPromise;

        // CLEANUP: Remove event listeners to prevent memory leaks
        subagent.removeAllListeners();

        // Return collected responses
        const combinedResponse = responses.join('\n\n');
        logger.debug('DelegateTool: Subagent finished, returning result', {
          combinedResponseLength: combinedResponse.length,
        });
        return this.createResult(combinedResponse || 'Subagent completed without response', {
          taskTitle: title,
        });
      } catch (error) {
        logger.error('DelegateTool: Error during subagent execution', {
          error: error instanceof Error ? error.message : String(error),
        });
        // CLEANUP: Remove event listeners even on error to prevent memory leaks
        if (subagent) {
          subagent.removeAllListeners();
        }

        return this.createError(
          error instanceof Error ? `Subagent error: ${error.message}` : 'Unknown error occurred'
        );
      }
    } catch (error) {
      return this.createError(
        error instanceof Error ? `Provider setup error: ${error.message}` : 'Unknown error occurred'
      );
    }
  }

  private createProvider(
    providerName: string,
    modelName: string,
    expectedResponse: string
  ): AIProvider | null {
    // Create system prompt for subagent
    const systemPrompt = `You are a focused task assistant. You have been delegated a specific task by another agent.

Your instructions:
- Complete ONLY the task described in the prompt
- Return results in the format specified in "expected response"
- Be concise and direct - no pleasantries or meta-commentary
- Use tools as needed to gather information, but STOP using tools once you have enough information to answer
- After gathering sufficient data, provide your final answer WITHOUT using more tools
- If you cannot complete the task, explain why briefly

Expected response format: ${expectedResponse}

IMPORTANT: Once you have gathered enough information to provide the expected response, STOP using tools and give your final answer. Do not continue exploring or gathering more data indefinitely.`;

    try {
      const registry = ProviderRegistry.createWithAutoDiscovery();
      return registry.createProvider(providerName, {
        model: modelName,
        systemPrompt,
        maxTokens: 4000,
      });
    } catch (error) {
      // Return null for unknown providers (will be handled by caller)
      if (error instanceof Error && error.message.includes('Unknown provider')) {
        return null;
      }
      throw error;
    }
  }

  // Method to inject dependencies (called by main agent setup)
  setDependencies(parentAgent: Agent, toolExecutor: ToolExecutor): void {
    this.parentAgent = parentAgent;
    this.parentToolExecutor = toolExecutor;
  }

  private createRestrictedToolExecutor(): ToolExecutor {
    const childExecutor = new ToolExecutor();

    // Get available tools from parent and filter out delegate to prevent recursion
    const parentTools = this.parentToolExecutor?.getAllTools() || [];
    const allowedTools = parentTools.filter((tool) => tool.name !== 'delegate');

    childExecutor.registerTools(allowedTools);

    // SECURITY: Pass through parent's approval callback or default to deny-all
    const parentApprovalCallback = this.parentToolExecutor?.getApprovalCallback();
    if (parentApprovalCallback) {
      // Use same approval policy as parent
      childExecutor.setApprovalCallback(parentApprovalCallback);
    } else {
      // SAFE DEFAULT: If no approval callback, deny all tools
      childExecutor.setApprovalCallback({
        async requestApproval() {
          return await Promise.resolve(ApprovalDecision.DENY);
        },
      });
    }

    return childExecutor;
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
