// ABOUTME: Session helper for agent-spawned LLM operations during conversations
// ABOUTME: Inherits tool policies and approval workflow from parent session

import { BaseHelper } from '~/helpers/base-helper';
import { GlobalConfigManager } from '~/config/global-config';
import { ProviderRegistry } from '~/providers/registry';
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

  /** Optional persona to use - defaults to 'lace' */
  persona?: string;
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
      // Try global config first
      const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
      const { instanceId, modelId } = parseProviderModel(providerModel);

      logger.debug('SessionHelper creating provider from global config', {
        tier: this.options.model,
        instanceId,
        modelId,
      });

      const registry = ProviderRegistry.getInstance();
      const instance = await registry.createProviderFromInstanceAndModel(instanceId, modelId);

      if (instance) {
        this.provider = instance;
        return instance;
      }
    } catch (_globalConfigError) {
      logger.debug('SessionHelper global config failed, falling back to parent provider', {
        tier: this.options.model,
      });
    }

    // Fallback: Use parent agent's provider when global config unavailable
    const parentProvider = await this.options.parentAgent.getProvider();
    if (!parentProvider) {
      throw new Error(
        'No provider available: global config failed and parent agent has no provider'
      );
    }

    logger.debug('SessionHelper using parent agent provider as fallback', {
      agentId: this.options.parentAgent.threadId,
      providerName: parentProvider.providerName,
    });

    this.provider = parentProvider;
    return parentProvider;
  }

  protected getTools(): Tool[] {
    if (this.tools) {
      return this.tools;
    }

    // Inherit tools from parent agent
    this.tools = this.options.parentAgent.getAvailableTools();

    logger.debug('SessionHelper inherited tools from parent', {
      toolCount: this.tools.length,
      toolNames: this.tools.map((t) => t.name),
    });

    return this.tools;
  }

  protected getToolExecutor(): ToolExecutor {
    if (this.toolExecutor) {
      return this.toolExecutor;
    }

    // Get tool executor from parent agent
    this.toolExecutor = this.options.parentAgent.toolExecutor;
    return this.toolExecutor;
  }

  protected getModel(): string {
    try {
      // Try to get model from global config first
      const providerModel = GlobalConfigManager.getDefaultModel(this.options.model);
      const { modelId } = parseProviderModel(providerModel);
      return modelId;
    } catch (_globalConfigError) {
      // Fallback: Get model from parent agent
      const agentInfo = this.options.parentAgent.getInfo();
      if (agentInfo?.modelId) {
        logger.debug('SessionHelper using parent agent model as fallback', {
          agentId: this.options.parentAgent.threadId,
          modelId: agentInfo.modelId,
        });
        return agentInfo.modelId;
      }

      // Last resort
      throw new Error(
        'No model available: global config failed and parent agent has no model info'
      );
    }
  }

  protected async executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    const toolExecutor = this.getToolExecutor();
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
        hasWorkingDir: !!context.workingDirectory,
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
            toolName: toolCall.name,
          });
          results.push(
            createErrorResult('Tool approval pending in single-shot helper', toolCall.id)
          );
          continue;
        }

        // Permission granted - execute
        const result = await toolExecutor.executeApprovedTool(toolCall, context);
        results.push(result);
      } catch (error) {
        logger.error('SessionHelper tool execution failed', {
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
