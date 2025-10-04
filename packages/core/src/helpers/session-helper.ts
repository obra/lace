// ABOUTME: Session helper for agent-spawned LLM operations during conversations
// ABOUTME: Inherits tool policies and approval workflow from parent session

import { BaseHelper } from './base-helper';
import { UserSettingsManager } from '@lace/core/config/user-settings';
import { ProviderRegistry } from '@lace/core/providers/registry';
import { parseProviderModel } from '@lace/core/providers/provider-utils';
import { ToolExecutor } from '@lace/core/tools/executor';
import { Tool } from '@lace/core/tools/tool';
import { ToolCall, ToolResult, ToolContext, createErrorResult } from '@lace/core/tools/types';
import type { AIProvider } from '@lace/core/providers/base-provider';

import { Agent } from '@lace/core/agents/agent';
import { logger } from '@lace/core/utils/logger';

export interface SessionHelperOptions {
  /** Model tier to use - 'fast' or 'smart' */
  model: 'fast' | 'smart';

  /** Parent agent to inherit context and policies from */
  parentAgent: Agent;

  /** Explicit whitelist of tool names this helper can use (fail-closed security) */
  allowedTools?: string[];

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
  private cachedModelId: string | null = null;

  constructor(private options: SessionHelperOptions) {
    super();
  }

  protected async getProvider(): Promise<AIProvider> {
    if (this.provider) {
      return this.provider;
    }

    try {
      // Try user settings first
      const providerModel = UserSettingsManager.getDefaultModel(this.options.model);
      const { instanceId, modelId } = parseProviderModel(providerModel);

      logger.debug('SessionHelper creating provider from user settings', {
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
    } catch (_settingsError) {
      logger.debug('SessionHelper user settings failed, falling back to parent provider', {
        tier: this.options.model,
      });
    }

    // Fallback: Use parent agent's provider when user settings unavailable
    const parentProvider = await this.options.parentAgent.getProvider();
    if (!parentProvider) {
      throw new Error(
        'No provider available: user settings failed and parent agent has no provider'
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

  protected getPersona(): string | undefined {
    return this.options.persona;
  }

  protected getModel(): string {
    try {
      // Try to get model from global config first
      if (!this.cachedModelId) {
        const providerModel = UserSettingsManager.getDefaultModel(this.options.model);
        this.cachedModelId = parseProviderModel(providerModel).modelId;
      }
      return this.cachedModelId;
    } catch (_globalConfigError) {
      // Fallback: Get model from parent agent
      const parentAgentModel = this.options.parentAgent.model;
      if (parentAgentModel && parentAgentModel !== 'unknown-model') {
        logger.debug('SessionHelper using parent agent model as fallback', {
          agentId: this.options.parentAgent.threadId,
          modelId: parentAgentModel,
        });
        this.cachedModelId = parentAgentModel;
        return parentAgentModel;
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
      const composedSignal = this.options.abortSignal ?? signal ?? new AbortController().signal;
      const context: ToolContext = {
        signal: composedSignal,
        agent: this.options.parentAgent, // Key difference - has agent context
        workingDirectory: session?.getWorkingDirectory(),
      };

      logger.debug('SessionHelper requesting tool permission', {
        toolName: toolCall.name,
        hasAgent: !!context.agent,
        hasWorkingDir: !!context.workingDirectory,
      });

      try {
        // SECURITY: Check explicit tool whitelist first (fail-closed)
        if (this.options.allowedTools) {
          const whitelist = new Set(this.options.allowedTools);
          if (!whitelist.has(toolCall.name)) {
            results.push(
              createErrorResult(`Tool '${toolCall.name}' not in helper whitelist`, toolCall.id)
            );
            continue;
          }
        }

        // If no explicit whitelist, fall back to session policy checking
        if (!this.options.allowedTools) {
          const policy = session?.getToolPolicy(toolCall.name);
          const config = session?.getEffectiveConfiguration();

          // Deny if tool not in session allowlist
          if (config?.tools && !config.tools.includes(toolCall.name)) {
            results.push(
              createErrorResult(
                `Tool '${toolCall.name}' not available in session configuration`,
                toolCall.id
              )
            );
            continue;
          }

          // Deny if tool requires approval (helpers cannot handle approvals)
          if (policy === 'ask' || policy === 'deny' || !policy) {
            results.push(
              createErrorResult(
                `Tool '${toolCall.name}' requires approval - not available in helper context`,
                toolCall.id
              )
            );
            continue;
          }

          // Must be 'allow' policy to reach here
        }

        // Execute the tool (either whitelisted or explicitly allowed)
        const result = await toolExecutor.execute(toolCall, context);
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
