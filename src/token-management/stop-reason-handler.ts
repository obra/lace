// ABOUTME: Handles provider stop reasons and filters incomplete tool calls
// ABOUTME: Prevents broken tool calls from crashing the system when max_tokens is reached

import { ProviderResponse, ProviderToolCall } from '~/providers/base-provider.js';
import { Tool } from '~/tools/tool.js';
import { logger } from '~/utils/logger.js';

export interface StopReasonHandlerConfig {
  logTokenExhaustion?: boolean;
  requireAllParameters?: boolean;
}

export class StopReasonHandler {
  private readonly _config: StopReasonHandlerConfig;

  constructor(config: StopReasonHandlerConfig = {}) {
    this._config = {
      logTokenExhaustion: true,
      requireAllParameters: true,
      ...config,
    };
  }

  /**
   * Processes a provider response and handles incomplete tool calls
   * when max_tokens limit is reached
   */
  handleResponse(response: ProviderResponse, availableTools: Tool[]): ProviderResponse {
    // Check for token exhaustion
    if (response.stopReason === 'max_tokens') {
      if (this._config.logTokenExhaustion) {
        logger.warn('Token limit reached during response generation', {
          stopReason: response.stopReason,
          contentLength: response.content.length,
          toolCallCount: response.toolCalls.length,
          usage: response.usage,
        });
      }

      // Filter out incomplete tool calls
      const completedToolCalls = this._filterIncompleteToolCalls(
        response.toolCalls,
        availableTools
      );

      if (completedToolCalls.length < response.toolCalls.length) {
        const removedCount = response.toolCalls.length - completedToolCalls.length;
        logger.warn('Filtered incomplete tool calls due to token exhaustion', {
          originalCount: response.toolCalls.length,
          completedCount: completedToolCalls.length,
          removedCount,
          removedToolCalls: response.toolCalls.slice(completedToolCalls.length).map((tc) => ({
            name: tc.name,
            hasInput: !!tc.input,
            inputKeys: Object.keys(tc.input || {}),
          })),
        });
      }

      return {
        ...response,
        toolCalls: completedToolCalls,
      };
    }

    // No special handling needed for other stop reasons
    return response;
  }

  /**
   * Filters out tool calls that are missing required parameters
   */
  private _filterIncompleteToolCalls(
    toolCalls: ProviderToolCall[],
    availableTools: Tool[]
  ): ProviderToolCall[] {
    if (!this._config.requireAllParameters) {
      return toolCalls;
    }

    return toolCalls.filter((toolCall) => {
      const tool = availableTools.find((t) => t.name === toolCall.name);
      if (!tool) {
        logger.debug('Tool call for unknown tool, keeping anyway', {
          toolName: toolCall.name,
          availableTools: availableTools.map((t) => t.name),
        });
        return true; // Keep unknown tools - let tool executor handle the error
      }

      const isComplete = this._isToolCallComplete(toolCall, tool);

      if (!isComplete) {
        logger.debug('Tool call incomplete, filtering out', {
          toolName: toolCall.name,
          providedInput: toolCall.input,
          requiredSchema: tool.inputSchema,
        });
      }

      return isComplete;
    });
  }

  /**
   * Checks if a tool call has all required parameters based on the tool's schema
   */
  private _isToolCallComplete(toolCall: ProviderToolCall, tool: Tool): boolean {
    if (!toolCall.input || typeof toolCall.input !== 'object') {
      return false;
    }

    // Check if all required parameters are present
    const schema = tool.inputSchema;
    if (schema && schema.required && Array.isArray(schema.required)) {
      for (const requiredParam of schema.required) {
        if (
          !(requiredParam in toolCall.input) ||
          toolCall.input[requiredParam] === null ||
          toolCall.input[requiredParam] === undefined
        ) {
          return false;
        }
      }
    }

    // Additional validation: check for empty strings in required string parameters
    if (schema && schema.properties) {
      for (const [paramName, paramDef] of Object.entries(schema.properties)) {
        const isRequired = schema.required?.includes(paramName);
        const value = toolCall.input[paramName];

        if (isRequired && typeof paramDef === 'object' && paramDef !== null) {
          const paramDefObj = paramDef as { type?: string };
          if (
            paramDefObj.type === 'string' &&
            (value === '' || value === null || value === undefined)
          ) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Checks if a response indicates token exhaustion
   */
  isTokenExhausted(response: ProviderResponse): boolean {
    return response.stopReason === 'max_tokens';
  }

  /**
   * Gets a summary of token usage from a response
   */
  getTokenUsageSummary(response: ProviderResponse): {
    used: number;
    available: number | null;
    efficiency: number | null;
  } {
    const usage = response.usage;
    if (!usage) {
      return { used: 0, available: null, efficiency: null };
    }

    const used = usage.totalTokens;

    // We don't have max_tokens in the response, so we can't calculate availability
    // This would need to be passed in from the provider configuration
    return {
      used,
      available: null,
      efficiency: null,
    };
  }
}
