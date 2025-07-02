// ABOUTME: Delegate tool for spawning subagents with specific tasks
// ABOUTME: Enables efficient token usage by delegating to cheaper models

import {
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
  createErrorResult,
} from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';
import { ApprovalDecision } from '../approval-types.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { ToolExecutor } from '../executor.js';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';
import { LMStudioProvider } from '../../providers/lmstudio-provider.js';
import { OllamaProvider } from '../../providers/ollama-provider.js';
import { AIProvider } from '../../providers/base-provider.js';
import { TokenBudgetConfig } from '../../token-management/types.js';
import { getEnvVar } from '../../config/env-loader.js';
import { logger } from '../../utils/logger.js';

export class DelegateTool extends BaseTool {
  name = 'delegate';
  description = `Delegate a specific task to a subagent using a less expensive model.
Ideal for research, data extraction, log analysis, or any focused task with clear outputs.
The subagent starts fresh with only your instructions - no conversation history.

Examples:
- title: "Analyze test failures", prompt: "Review the test output and identify the root cause of failures", expected_response: "List of failing tests with specific error reasons"
- title: "Search authentication logs", prompt: "grep through the application logs for authentication errors in the last hour", expected_response: "Timestamps and error messages for each auth failure"
- title: "Count code statistics", prompt: "Count total lines of code, number of files, and test coverage percentage", expected_response: "JSON with {loc: number, files: number, coverage: number}"`;

  annotations = {
    openWorldHint: true,
  };

  inputSchema = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description:
          'Short active voice sentence describing the task (e.g., "Find security vulnerabilities")',
      },
      prompt: {
        type: 'string',
        description: 'Complete instructions for the subagent - be specific and clear',
      },
      expected_response: {
        type: 'string',
        description:
          'Description of the expected format/content of the response (guides the subagent)',
      },
      model: {
        type: 'string',
        description:
          'Provider and model in format "provider:model" (default: "anthropic:claude-3-5-haiku-latest")',
        examples: [
          'anthropic:claude-3-5-haiku-latest',
          'anthropic:claude-3-5-sonnet-latest',
          'lmstudio:qwen2.5-coder-7b-instruct',
          'ollama:qwen2.5-coder:3b',
        ],
      },
    },
    required: ['title', 'prompt', 'expected_response'],
  };

  // Dependencies injected by the main agent's context
  private threadManager?: ThreadManager;
  private parentToolExecutor?: ToolExecutor;
  private defaultTimeout: number = 300000; // 5 minutes default

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const title = this.validateNonEmptyStringParam(call.arguments.title, 'title', call.id);
      const prompt = this.validateNonEmptyStringParam(call.arguments.prompt, 'prompt', call.id);
      const expected_response = this.validateNonEmptyStringParam(call.arguments.expected_response, 'expected_response', call.id);
      const model = this.validateOptionalParam(
        call.arguments.model,
        'model',
        (value) => {
          const modelStr = this.validateStringParam(value, 'model');
          const [providerName, modelName] = modelStr.split(':');
          if (!providerName || !modelName) {
            throw new Error('Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3.5-haiku-latest")');
          }
          return modelStr;
        },
        call.id
      ) ?? 'anthropic:claude-3-5-haiku-latest';

      return await this.performDelegation({ title, prompt, expected_response, model }, call.id);
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }

      return this.createStructuredError(
        'Delegate tool validation failed',
        'Check the title, prompt, expected_response, and model parameters',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
    }
  }

  private async performDelegation(params: { title: string; prompt: string; expected_response: string; model: string }, callId?: string): Promise<ToolResult> {
    const { title, prompt, expected_response, model } = params;

    // Parse provider:model format
    const [providerName, modelName] = model.split(':');

    try {
      // Create provider for subagent
      const provider = await this.createProvider(providerName, modelName, expected_response);
      if (!provider) {
        return createErrorResult(`Unknown provider: ${providerName}`, call.id);
      }

      // Use shared thread manager from parent (avoids multiple SQLite connections)
      if (!this.threadManager) {
        return createErrorResult(
          'Delegate tool not properly initialized - missing ThreadManager',
          call.id
        );
      }
      const threadManager = this.threadManager;

      // Create restricted tool executor for subagent (remove delegate to prevent recursion)
      if (!this.parentToolExecutor) {
        return createErrorResult(
          'Delegate tool not properly initialized - missing parent ToolExecutor',
          call.id
        );
      }

      const toolExecutor = this.createRestrictedToolExecutor();

      // Create new delegate thread for subagent
      const parentThreadId = this.threadManager.getCurrentThreadId();
      if (!parentThreadId) {
        throw new Error('No active thread for delegation');
      }

      const delegateThread = this.threadManager.createDelegateThreadFor(parentThreadId);
      const subagentThreadId = delegateThread.id;

      // Note: Delegation metadata is now shown in the delegation box UI

      // Get all tools for the subagent
      const availableTools = toolExecutor.getAllTools();

      // Configure token budget for subagent (more conservative than parent)
      const tokenBudget: TokenBudgetConfig = {
        warningThreshold: 0.7,
        maxTokens: 50000, // Lower limit for subagents
        reserveTokens: 1000, // Keep some tokens in reserve
      };

      // Create subagent
      let subagent: Agent | null = null; // Declare outside try block
      logger.debug('DelegateTool: Creating subagent', { subagentThreadId });
      try {
        subagent = new Agent({
          provider,
          toolExecutor,
          threadManager,
          threadId: subagentThreadId,
          tools: availableTools,
          tokenBudget,
        });

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

        // Create promise that resolves when conversation completes or times out
        const resultPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            logger.error('DelegateTool: Subagent timed out', { subagentThreadId });
            reject(new Error(`Subagent timeout after ${this.defaultTimeout}ms`));
          }, this.defaultTimeout);

          const completeHandler = () => {
            logger.debug('DelegateTool: Subagent conversation complete', { subagentThreadId });
            clearTimeout(timeout);
            resolve();
          };

          const errorHandler = ({ error }: { error: Error }) => {
            logger.error('DelegateTool: Subagent error during conversation', {
              subagentThreadId,
              error: error.message,
            });
            clearTimeout(timeout);
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
        return createSuccessResult(
          [
            {
              type: 'text',
              text: combinedResponse || 'Subagent completed without response',
            },
          ],
          call.id,
          { threadId: subagentThreadId }
        );
      } catch (error) {
        logger.error('DelegateTool: Error during subagent execution', {
          error: error instanceof Error ? error.message : String(error),
        });
        // CLEANUP: Remove event listeners even on error to prevent memory leaks
        if (subagent) {
          subagent.removeAllListeners();
        }

        return createErrorResult(
          error instanceof Error ? `Subagent error: ${error.message}` : 'Unknown error occurred',
          call.id
        );
      }
    } catch (error) {
      return createErrorResult(
        error instanceof Error
          ? `Provider setup error: ${error.message}`
          : 'Unknown error occurred',
        call.id
      );
    }
  }

  private async createProvider(
    providerName: string,
    modelName: string,
    expectedResponse: string
  ): Promise<AIProvider | null> {
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

    const config = {
      model: modelName,
      systemPrompt,
      maxTokens: 4000,
    };

    switch (providerName.toLowerCase()) {
      case 'anthropic': {
        const apiKey = getEnvVar('ANTHROPIC_KEY');
        if (!apiKey) {
          throw new Error('ANTHROPIC_KEY environment variable required for Anthropic provider');
        }
        return new AnthropicProvider({ ...config, apiKey });
      }
      case 'lmstudio': {
        return new LMStudioProvider(config);
      }
      case 'ollama': {
        return new OllamaProvider(config);
      }
      default:
        return null;
    }
  }

  // Method to inject dependencies (called by main agent setup)
  setDependencies(threadManager: ThreadManager, toolExecutor: ToolExecutor): void {
    this.threadManager = threadManager;
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
        async requestApproval(): Promise<ApprovalDecision> {
          return ApprovalDecision.DENY;
        },
      });
    }

    return childExecutor;
  }
}
