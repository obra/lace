// ABOUTME: Delegate tool for spawning subagents with specific tasks
// ABOUTME: Enables efficient token usage by delegating to cheaper models

import { Tool, ToolResult, ToolContext } from '../types.js';
import { Agent } from '../../agents/agent.js';
import { ThreadManager } from '../../threads/thread-manager.js';
import { ToolExecutor } from '../executor.js';
import { ToolRegistry } from '../registry.js';
import { AnthropicProvider } from '../../providers/anthropic-provider.js';
import { LMStudioProvider } from '../../providers/lmstudio-provider.js';
import { OllamaProvider } from '../../providers/ollama-provider.js';
import { AIProvider } from '../../providers/types.js';
import { TokenBudgetConfig } from '../../token-management/types.js';
import { generateThreadId } from '../../threads/session.js';
import { getEnvVar } from '../../config/env-loader.js';

export class DelegateTool implements Tool {
  name = 'delegate';
  description = `Delegate a specific task to a subagent using a less expensive model.
Ideal for research, data extraction, log analysis, or any focused task with clear outputs.
The subagent starts fresh with only your instructions - no conversation history.

Examples:
- title: "Analyze test failures", prompt: "Review the test output and identify the root cause of failures", expected_response: "List of failing tests with specific error reasons"
- title: "Search authentication logs", prompt: "grep through the application logs for authentication errors in the last hour", expected_response: "Timestamps and error messages for each auth failure"
- title: "Count code statistics", prompt: "Count total lines of code, number of files, and test coverage percentage", expected_response: "JSON with {loc: number, files: number, coverage: number}"`;

  destructive = false;

  input_schema = {
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
  private toolRegistry?: ToolRegistry;
  private defaultTimeout: number = 300000; // 5 minutes default

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const {
      title,
      prompt,
      expected_response,
      model = 'anthropic:claude-3-5-haiku-latest',
    } = input as {
      title: string;
      prompt: string;
      expected_response: string;
      model?: string;
    };

    // Validate inputs
    if (!title || typeof title !== 'string') {
      return {
        success: false,
        content: [],
        error: 'Title must be a non-empty string',
      };
    }

    if (!prompt || typeof prompt !== 'string') {
      return {
        success: false,
        content: [],
        error: 'Prompt must be a non-empty string',
      };
    }

    if (!expected_response || typeof expected_response !== 'string') {
      return {
        success: false,
        content: [],
        error: 'Expected response must be a non-empty string',
      };
    }

    // Parse provider:model format
    const [providerName, modelName] = model.split(':');
    if (!providerName || !modelName) {
      return {
        success: false,
        content: [],
        error:
          'Invalid model format. Use "provider:model" (e.g., "anthropic:claude-3.5-haiku-latest")',
      };
    }

    try {
      // Create provider for subagent
      const provider = await this.createProvider(providerName, modelName, expected_response);
      if (!provider) {
        return {
          success: false,
          content: [],
          error: `Unknown provider: ${providerName}`,
        };
      }

      // Use shared thread manager from parent (avoids multiple SQLite connections)
      if (!this.threadManager) {
        return {
          success: false,
          content: [],
          error: 'Delegate tool not properly initialized - missing ThreadManager',
        };
      }
      const threadManager = this.threadManager;

      // Clone tool registry and remove delegate to prevent recursion
      const parentRegistry = this.toolRegistry || new ToolRegistry();
      const toolRegistry = new ToolRegistry();

      // Copy all tools except delegate
      parentRegistry
        .getAllTools()
        .filter((tool) => tool.name !== 'delegate')
        .forEach((tool) => toolRegistry.registerTool(tool));

      // Create isolated tool executor
      const toolExecutor = new ToolExecutor(toolRegistry);

      // Create new thread for subagent with delegate prefix
      const subagentThreadId = `delegate_${generateThreadId()}`;

      // Create the thread in ThreadManager
      threadManager.createThread(subagentThreadId);

      // Get all tools for the subagent
      const availableTools = toolRegistry.getAllTools();

      // Configure token budget for subagent (more conservative than parent)
      const tokenBudget: TokenBudgetConfig = {
        warningThreshold: 0.7,
        maxTokens: 50000, // Lower limit for subagents
        reserveTokens: 1000, // Keep some tokens in reserve
      };

      // Create subagent
      const subagent = new Agent({
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

      // Forward tool events (for future approval mechanism)
      subagent.on('tool_call_start', (_data) => {
        // When tool approval is implemented, this will forward to main agent's approval flow
        // For now, just log that a tool was called
      });

      // Start subagent
      subagent.start();

      // Send the task
      const taskMessage = `Task: ${title}\n\n${prompt}`;

      // Create promise that resolves when conversation completes or times out
      const resultPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Subagent timeout after ${this.defaultTimeout}ms`));
        }, this.defaultTimeout);

        const completeHandler = () => {
          clearTimeout(timeout);
          resolve();
        };

        const errorHandler = ({ error }: { error: Error }) => {
          clearTimeout(timeout);
          reject(error);
        };

        subagent.once('conversation_complete', completeHandler);
        subagent.once('error', errorHandler);
      });

      // Send message and wait for completion
      await subagent.sendMessage(taskMessage);
      await resultPromise;

      // Return collected responses
      const combinedResponse = responses.join('\n\n');
      return {
        success: true,
        content: [
          {
            type: 'text',
            text: combinedResponse || 'Subagent completed without response',
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [],
        error:
          error instanceof Error ? `Subagent error: ${error.message}` : 'Unknown error occurred',
      };
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
- Use tools as needed to complete the task
- If you cannot complete the task, explain why briefly

Expected response format: ${expectedResponse}

Remember: You are optimized for efficiency. Get the job done and report back.`;

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
  setDependencies(threadManager: ThreadManager, toolRegistry: ToolRegistry): void {
    this.threadManager = threadManager;
    this.toolRegistry = toolRegistry;
  }
}
