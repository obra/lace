// ABOUTME: Infrastructure helper for Lace's internal systems to execute LLM tasks
// ABOUTME: Bypasses user approval with programmatic tool whitelist for trusted operations

import { BaseHelper } from './base-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { parseProviderModel } from '~/providers/provider-utils';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '~/tools/types';
import { AIProvider } from '~/providers/base-provider';
import { logger } from '~/utils/logger';

export interface InfrastructureHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';
  
  /** Explicit whitelist of tool names that can be used */
  tools: string[];
  
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

    // Get model configuration from global config
    const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
    const { instanceId, modelId } = parseProviderModel(providerModel);

    logger.debug('InfrastructureHelper resolving provider', {
      tier: this.options.model,
      instanceId,
      modelId
    });

    // Get provider instance
    const instanceManager = new ProviderInstanceManager();
    const instance = await instanceManager.getInstance(instanceId);
    
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    this.provider = instance;
    return instance;
  }

  protected async getTools(): Promise<Tool[]> {
    if (this.availableTools.length > 0) {
      return this.availableTools;
    }

    // Get tool instances for whitelisted names
    this.availableTools = this.options.tools
      .map(name => this.toolExecutor.getTool(name))
      .filter((tool): tool is Tool => tool !== undefined);

    logger.debug('InfrastructureHelper resolved tools', {
      requested: this.options.tools,
      available: this.availableTools.map(t => t.name)
    });

    return this.availableTools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    return this.toolExecutor;
  }

  protected async getModel(): Promise<string> {
    // Extract model ID from provider model string
    const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
    const { modelId } = parseProviderModel(providerModel);
    return modelId;
  }

  protected async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      // Check abort signal
      if (signal?.aborted) {
        results.push(createErrorResult('Execution aborted', toolCall.id));
        continue;
      }

      // Security check: only allow whitelisted tools
      if (!this.options.tools.includes(toolCall.name)) {
        logger.warn('InfrastructureHelper blocked non-whitelisted tool', {
          toolName: toolCall.name,
          whitelist: this.options.tools
        });
        
        results.push(createErrorResult(
          `Tool '${toolCall.name}' not in whitelist`,
          toolCall.id
        ));
        continue;
      }

      // Build context without agent (infrastructure mode)
      const context: ToolContext = {
        signal: this.options.abortSignal || signal || new AbortController().signal,
        workingDirectory: this.options.workingDirectory,
        processEnv: this.options.processEnv,
        // NO agent property - this is infrastructure mode
      };

      logger.debug('InfrastructureHelper executing tool', {
        toolName: toolCall.name,
        hasWorkingDir: !!context.workingDirectory,
        hasProcessEnv: !!context.processEnv
      });

      try {
        // Execute directly (bypass approval)
        const result = await this.toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('InfrastructureHelper tool execution failed', {
          toolName: toolCall.name,
          error: error instanceof Error ? error.message : String(error)
        });
        
        results.push(createErrorResult(
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
          toolCall.id
        ));
      }
    }

    return results;
  }
}