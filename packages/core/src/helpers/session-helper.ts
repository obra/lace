// ABOUTME: Session helper for agent-spawned LLM operations during conversations  
// ABOUTME: Inherits tool policies and approval workflow from parent session

import { BaseHelper } from './base-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderInstanceManager } from '~/providers/instance/manager';
import { parseProviderModel } from '~/providers/provider-utils';
import { ToolExecutor } from '~/tools/executor';
import { Tool } from '~/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '~/tools/types';
import { AIProvider } from '~/providers/base-provider';
import { Agent } from '~/agents/agent';
import { logger } from '~/utils/logger';

export interface SessionHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';
  
  /** Parent agent to inherit context and policies from */
  parentAgent: Agent;
  
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Helper for session-level LLM operations
 * Used by agents to spawn sub-tasks during conversation flow
 * Inherits tool policies and approval workflow from parent session
 */
export class SessionHelper extends BaseHelper {
  private provider: AIProvider | null = null;
  private toolExecutor: ToolExecutor | null = null;
  private tools: Tool[] | null = null;
  
  constructor(private options: SessionHelperOptions) {
    super();
  }

  protected async getProvider(): Promise<AIProvider> {
    if (this.provider) {
      return this.provider;
    }

    try {
      // Try to get provider from parent agent first
      this.provider = await this.options.parentAgent.getProvider();
      if (this.provider) {
        // Clone the provider and set our model
        const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
        const { modelId } = parseProviderModel(providerModel);
        // Note: setModelId method may not exist on all providers, but this is the pattern from the plan
        return this.provider;
      }
    } catch (error) {
      logger.debug('SessionHelper could not get provider from parent agent', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Fallback: create new provider instance
    const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
    const { instanceId, modelId } = parseProviderModel(providerModel);

    logger.debug('SessionHelper creating new provider', {
      tier: this.options.model,
      instanceId,
      modelId
    });

    const instanceManager = new ProviderInstanceManager();
    const instance = await instanceManager.getInstance(instanceId);
    
    if (!instance) {
      throw new Error(`Provider instance not found: ${instanceId}`);
    }

    this.provider = instance;
    return instance;
  }

  protected async getTools(): Promise<Tool[]> {
    if (this.tools) {
      return this.tools;
    }

    // Inherit tools from parent agent
    this.tools = this.options.parentAgent.getAvailableTools();
    
    logger.debug('SessionHelper inherited tools from parent', {
      toolCount: this.tools.length,
      toolNames: this.tools.map(t => t.name)
    });

    return this.tools;
  }

  protected async getToolExecutor(): Promise<ToolExecutor> {
    if (this.toolExecutor) {
      return this.toolExecutor;
    }

    // Get tool executor from parent agent
    this.toolExecutor = this.options.parentAgent.toolExecutor;
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
    const toolExecutor = await this.getToolExecutor();
    const session = await this.options.parentAgent.getFullSession();

    for (const toolCall of toolCalls) {
      // Check abort signal
      if (signal?.aborted) {
        results.push(createErrorResult('Execution aborted', toolCall.id));
        continue;
      }

      // Build context with parent agent (inherit session policies)
      const context: ToolContext = {
        signal: this.options.abortSignal || signal || new AbortController().signal,
        agent: this.options.parentAgent, // Key difference - has agent context
        workingDirectory: session?.getWorkingDirectory(),
      };

      logger.debug('SessionHelper requesting tool permission', {
        toolName: toolCall.name,
        hasAgent: !!context.agent,
        hasWorkingDir: !!context.workingDirectory
      });

      try {
        // Go through normal approval flow
        const permission = await toolExecutor.requestToolPermission(toolCall, context);
        
        if (typeof permission === 'object' && 'status' in permission) {
          // Permission denied - return as result
          results.push(permission);
          continue;
        }
        
        if (permission === 'pending') {
          // This shouldn't happen in single-shot execution
          logger.warn('SessionHelper got pending approval in single-shot mode', {
            toolName: toolCall.name
          });
          results.push(createErrorResult(
            'Tool approval pending in single-shot helper',
            toolCall.id
          ));
          continue;
        }
        
        // Permission granted - execute
        const result = await toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('SessionHelper tool execution failed', {
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