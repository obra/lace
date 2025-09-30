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

      // Track token usage from last turn
      if (response.usage) {
        // Current context = input + output (output is now in conversation for next turn)
        const currentTokens = response.usage.promptTokens + response.usage.completionTokens;
        const contextLimit = 100000; // Default reasonable limit for helpers
        const percentUsed = contextLimit > 0 ? currentTokens / contextLimit : 0;

        totalUsage = {
          // Last turn's token counts
          turn: {
            inputTokens: response.usage.promptTokens,
            outputTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          },
          // Current context window state
          // Note: totalPromptTokens contains the current context size (input + previous outputs)
          // despite the confusing field name (kept for backwards compatibility)
          context: {
            totalPromptTokens: currentTokens, // Current context = last input + last output
            totalCompletionTokens: 0, // Not separately tracked in context state
            totalTokens: currentTokens,
            contextLimit,
            percentUsed,
            nearLimit: percentUsed >= 0.8,
          },
        };
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
