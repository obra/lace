// ABOUTME: Base class for helper agents providing common multi-turn execution logic
// ABOUTME: Extended by InfrastructureHelper and SessionHelper for specific use cases

import { HelperResult } from './types';
import { ToolCall, ToolResult } from '~/tools/types';
import { Tool } from '~/tools/tool';
import { ToolExecutor } from '~/tools/executor';
import { AIProvider, ProviderMessage } from '~/providers/base-provider';
import { CombinedTokenUsage } from '~/token-management/types';
import { logger } from '~/utils/logger';

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
  protected abstract getTools(): Promise<Tool[]>;

  /**
   * Get the tool executor for this helper
   */
  protected abstract getToolExecutor(): Promise<ToolExecutor>;

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
  protected abstract getModel(): Promise<string>;

  /**
   * Execute a prompt and return the complete result
   * May involve multiple LLM calls and tool executions internally
   */
  async execute(prompt: string, signal?: AbortSignal): Promise<HelperResult> {
    const provider = await this.getProvider();
    const tools = await this.getTools();
    const model = await this.getModel();
    
    // Build initial conversation
    const conversation: ProviderMessage[] = [
      { role: 'user', content: prompt }
    ];

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
        conversationLength: conversation.length
      });

      // Get LLM response
      const response = await provider.createResponse(conversation, tools, model);

      // Add assistant response to conversation
      conversation.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      });

      // Aggregate token usage
      if (response.usage) {
        if (!totalUsage) {
          totalUsage = {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens
          };
        } else {
          totalUsage.promptTokens += response.usage.promptTokens;
          totalUsage.completionTokens += response.usage.completionTokens;
          totalUsage.totalTokens += response.usage.totalTokens;
        }
      }

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        logger.debug('Helper completed', {
          turnCount,
          toolCallsTotal: allToolCalls.length
        });

        return {
          content: response.content,
          toolCalls: allToolCalls,
          toolResults: allToolResults,
          tokenUsage: totalUsage
        };
      }

      // Execute tool calls
      logger.debug('Helper executing tool calls', {
        turnCount,
        toolCount: response.toolCalls.length
      });

      const toolResults = await this.executeToolCalls(response.toolCalls, signal);
      
      // Track tool usage
      allToolCalls.push(...response.toolCalls);
      allToolResults.push(...toolResults);

      // Add tool results to conversation
      for (let i = 0; i < response.toolCalls.length; i++) {
        const toolCall = response.toolCalls[i];
        const toolResult = toolResults[i];
        
        if (toolResult) {
          // Convert tool result to conversation message
          conversation.push({
            role: 'tool',
            content: toolResult.content.map(block => block.text || '').join('\n'),
            toolResultId: toolCall.id
          });
        }
      }
    }
  }
}