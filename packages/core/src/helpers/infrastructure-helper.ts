// ABOUTME: Infrastructure helper for Lace's internal systems to execute LLM tasks
// ABOUTME: Bypasses user approval with programmatic tool whitelist for trusted operations

import { BaseHelper } from '~/helpers/base-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { parseProviderModel } from '~/providers/provider-utils';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '~/tools/types';
import type { AIProvider } from '~/providers/base-provider';
import { logger } from '~/utils/logger';

export interface InfrastructureHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';

  /** Explicit whitelist of tool names that can be used */
  tools: string[];

  /** Fallback provider when global model config unavailable */
  fallbackProvider?: AIProvider;

  /** Fallback model ID when global model config unavailable */
  fallbackModelId?: string;

  /** Optional working directory for file operations */
  workingDirectory?: string;

  /** Optional environment variables for subprocess execution */
  processEnv?: NodeJS.ProcessEnv;

  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Helper for infrastructure-level LLM operations
 * Used by Lace's internal systems for tasks like memory management, naming, etc.
 * Bypasses user approval system with explicit tool whitelist
 */
export class InfrastructureHelper extends BaseHelper {
  private provider: AIProvider | null = null;
  private toolExecutor: ToolExecutor;
  private availableTools: Tool[] = [];

  constructor(private options: InfrastructureHelperOptions) {
    super();
    this.toolExecutor = new ToolExecutor();
    this.toolExecutor.registerAllAvailableTools();
  }

  protected async getProvider(): Promise<AIProvider> {
    if (this.provider) {
      return this.provider;
    }

    let instanceId: string;
    let modelId: string;

    try {
      // Try to get model configuration from global config first
      const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
      const parsed = parseProviderModel(providerModel);
      instanceId = parsed.instanceId;
      modelId = parsed.modelId;

      logger.debug('InfrastructureHelper using global model config', {
        tier: this.options.model,
        instanceId,
        modelId,
      });
    } catch (error) {
      // Fall back to explicit provider if global config unavailable
      if (this.options.fallbackProvider) {
        logger.debug('InfrastructureHelper using fallback provider', {
          tier: this.options.model,
          reason: 'global config unavailable',
        });

        this.provider = this.options.fallbackProvider;
        return this.provider;
      } else {
        // No fallback available, re-throw original error
        throw error;
      }
    }

    // Get provider instance with explicit model
    const instanceManager = new ProviderInstanceManager();
    const instance = await instanceManager.getInstance(instanceId, modelId);

    if (!instance) {
      // Try fallback provider if instance lookup fails too
      if (this.options.fallbackProvider) {
        logger.debug('InfrastructureHelper using fallback provider after instance lookup failure', {
          failedInstanceId: instanceId,
        });
        this.provider = this.options.fallbackProvider;
        return this.provider;
      }
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    this.provider = instance;
    return instance;
  }

  protected getTools(): Tool[] {
    if (this.availableTools.length > 0) {
      return this.availableTools;
    }

    // Get tool instances for whitelisted names
    this.availableTools = this.options.tools
      .map((name) => this.toolExecutor.getTool(name))
      .filter((tool): tool is Tool => tool !== undefined);

    logger.debug('InfrastructureHelper resolved tools', {
      requested: this.options.tools,
      available: this.availableTools.map((t) => t.name),
    });

    const missing = this.options.tools.filter(
      (name) => !this.availableTools.some((t) => t.name === name)
    );
    if (missing.length > 0) {
      logger.warn('Some whitelisted tools are not registered', { missing });
    }

    return this.availableTools;
  }

  protected getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  protected getModel(): string {
    try {
      // Try to extract model ID from global config first
      const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
      const { modelId } = parseProviderModel(providerModel);
      return modelId;
    } catch (error) {
      // Fall back to explicit model if global config unavailable
      if (this.options.fallbackModelId) {
        return this.options.fallbackModelId;
      }
      // No fallback available, re-throw original error
      throw error;
    }
  }

  protected async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const whitelist = new Set(this.options.tools);

    for (const toolCall of toolCalls) {
      // Check abort signal
      if (signal?.aborted) {
        results.push(createErrorResult('Execution aborted', toolCall.id));
        continue;
      }

      // Security check: only allow whitelisted tools
      if (!whitelist.has(toolCall.name)) {
        logger.warn('InfrastructureHelper blocked non-whitelisted tool', {
          toolName: toolCall.name,
          whitelist: this.options.tools,
        });

        results.push(createErrorResult(`Tool '${toolCall.name}' not in whitelist`, toolCall.id));
        continue;
      }

      // Build context without agent (infrastructure mode)
      const composedSignal = this.options.abortSignal ?? signal ?? new AbortController().signal;
      const context: ToolContext = {
        signal: composedSignal,
        workingDirectory: this.options.workingDirectory,
        processEnv: this.options.processEnv,
        // NO agent property - this is infrastructure mode
      };

      logger.debug('InfrastructureHelper executing tool', {
        toolName: toolCall.name,
        hasWorkingDir: !!context.workingDirectory,
        hasProcessEnv: !!context.processEnv,
      });

      try {
        // Execute directly (bypass approval)
        const result = await this.toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('InfrastructureHelper tool execution failed', {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error),
        });

        results.push(
          createErrorResult(
            `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
            toolCall.id
          )
        );
      }
    }

    return results;
  }
}
