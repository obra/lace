// ABOUTME: Base class for helper agents providing common multi-turn execution logic
// ABOUTME: Extended by InfrastructureHelper and SessionHelper for specific use cases

import { HelperResult } from '~/helpers/types';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider, ProviderMessage } from '~/providers/base-provider';
import { CombinedTokenUsage } from '~/token-management/types';
import { logger } from '~/utils/logger';
import { loadPromptConfig } from '~/config/prompts';

/**
 * Base class for helper agents
 * Provides the core multi-turn execution loop
 * Subclasses implement specific tool execution and provider access patterns
 */
export abstract class BaseHelper {
  private static readonly MAX_TURNS = 10;

  /**
   * Get the AI provider instance for this helper
   */
  protected abstract getProvider(): Promise<AIProvider>;

  /**
   * Get the tools available to this helper
   */
  protected abstract getTools(): Tool[];

  /**
   * Get the tool executor for this helper
   */
  protected abstract getToolExecutor(): ToolExecutor;

  /**
   * Execute tool calls according to the helper's security model
   * Infrastructure helpers bypass approval, Session helpers respect policies
   */
  protected abstract executeToolCalls(
    toolCalls: ToolCall[],
    signal?: AbortSignal
  ): Promise<ToolResult[]>;

  /**
   * Get the model to use for this helper
   */
  protected abstract getModel(): string;

  /**
   * Get the persona to use for this helper (optional - defaults to no system prompt)
   */
  protected getPersona(): string | undefined {
    return undefined;
  }

  /**
   * Execute a prompt and return the complete result
   * May involve multiple LLM calls and tool executions internally
   */
  async execute(prompt: string, signal?: AbortSignal): Promise<HelperResult> {
    const provider = await this.getProvider();
    const tools = this.getTools();
    const model = this.getModel();
    const persona = this.getPersona();

    // Build initial conversation with optional system prompt
    const conversation: ProviderMessage[] = [];

    // Add system prompt if persona is specified
    if (persona) {
      try {
        const promptConfig = await loadPromptConfig({ persona });
        conversation.push({ role: 'system', content: promptConfig.systemPrompt });
      } catch (error) {
        logger.warn('Failed to load persona system prompt, continuing without it', {
          persona,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    conversation.push({ role: 'user', content: prompt });

    // Track all tool usage
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];
    let totalUsage: CombinedTokenUsage | undefined;

    // Multi-turn execution loop
    let turnCount = 0;

    while (true) {
      // Check abort signal
      if (signal?.aborted) {
        throw new Error('Helper execution aborted');
      }

      // Prevent infinite loops
      if (++turnCount > BaseHelper.MAX_TURNS) {
        throw new Error(`Helper exceeded maximum turns (${BaseHelper.MAX_TURNS})`);
      }

      logger.debug('Helper executing turn', {
        turnCount,
        conversationLength: conversation.length,
      });

      // Get LLM response
      const response = await provider.createResponse(conversation, tools, model);

      // Add assistant response to conversation
      conversation.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // Aggregate token usage
      if (response.usage) {
        if (!totalUsage) {
          totalUsage = {
            message: {
              promptTokens: response.usage.promptTokens,
              completionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
            },
            thread: {
              totalPromptTokens: response.usage.promptTokens,
              totalCompletionTokens: response.usage.completionTokens,
              totalTokens: response.usage.totalTokens,
              contextLimit: 100000, // Default reasonable limit
              percentUsed: 0,
              nearLimit: false,
            },
          };
        } else {
          // Update message usage for current response
          totalUsage.message = {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          };

          // Aggregate to thread totals
          totalUsage.thread.totalPromptTokens += response.usage.promptTokens;
          totalUsage.thread.totalCompletionTokens += response.usage.completionTokens;
          totalUsage.thread.totalTokens += response.usage.totalTokens;
          totalUsage.thread.percentUsed =
            (totalUsage.thread.totalTokens / totalUsage.thread.contextLimit) * 100;
          totalUsage.thread.nearLimit = totalUsage.thread.percentUsed > 80;
        }
      }

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.debug('Helper completed', {
          turnCount,
          toolCallsTotal: allToolCalls.length,
        });

        return {
          content: response.content,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          tokenUsage: totalUsage,
        };
      }

      // Execute tool calls
      logger.debug('Helper executing tool calls', {
        turnCount,
        toolCount: response.toolCalls.length,
      });

      const toolResults = await this.executeToolCalls(response.toolCalls, signal);

      // Track tool usage
      allToolCalls.push(...response.toolCalls);
      allToolResults.push(...toolResults);

      // Add tool results to conversation as user message
      if (toolResults.length > 0) {
        conversation.push({
          role: 'user',
          content: '', // Empty content since tool results are in toolResults field
          toolResults: toolResults,
        });
      }
    }
  }
}
