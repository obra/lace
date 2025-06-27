// ABOUTME: Provider-specific format conversion functions for enhanced ProviderMessage format
// ABOUTME: Converts generic tool call format to provider-specific native formats

import { ProviderMessage, ProviderToolCall, ProviderToolResult } from './base-provider.js';
import { Tool } from '../tools/types.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Converts enhanced ProviderMessage format to Anthropic's content blocks format
 */
export function convertToAnthropicFormat(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((msg): Anthropic.MessageParam => {
      if (msg.role === 'user') {
        // User messages can have tool results
        if (msg.toolResults && msg.toolResults.length > 0) {
          const content: Anthropic.ToolResultBlockParam[] = msg.toolResults.map(
            (result: ProviderToolResult) => ({
              type: 'tool_result',
              tool_use_id: result.id,
              content: result.content.map((block) => block.text || '').join('\n'),
              ...(result.isError ? { is_error: true } : {}),
            })
          );

          // If there's also text content, add it
          if (msg.content && msg.content.trim()) {
            return {
              role: 'user',
              content: [{ type: 'text', text: msg.content }, ...content],
            };
          }

          return {
            role: 'user',
            content,
          };
        } else {
          // Pure text user message
          return {
            role: 'user',
            content: msg.content,
          };
        }
      } else if (msg.role === 'assistant') {
        // Assistant messages can have tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];

          // Add text content if present
          if (msg.content && msg.content.trim()) {
            content.push({ type: 'text', text: msg.content });
          }

          // Add tool calls
          msg.toolCalls.forEach((toolCall: ProviderToolCall) => {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            });
          });

          return {
            role: 'assistant',
            content,
          };
        } else {
          // Pure text assistant message
          return {
            role: 'assistant',
            content: msg.content,
          };
        }
      } else {
        // System messages shouldn't reach here due to filter, but handle gracefully
        return {
          role: 'assistant',
          content: msg.content,
        };
      }
    });
}

/**
 * Converts enhanced ProviderMessage format to OpenAI's tool_calls format
 * (Future implementation for OpenAI provider support)
 */
export function convertToOpenAIFormat(messages: ProviderMessage[]): Record<string, unknown>[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .flatMap((msg): Record<string, unknown>[] => {
      if (msg.role === 'user') {
        if (msg.toolResults && msg.toolResults.length > 0) {
          // OpenAI uses separate messages with role 'tool' for each tool result
          const toolMessages = msg.toolResults.map((result: ProviderToolResult) => ({
            role: 'tool',
            tool_call_id: result.id,
            content: result.content.map((block) => block.text || '').join('\n'),
          }));

          // If there's also text content, include the user message first
          if (msg.content && msg.content.trim()) {
            return [{ role: 'user', content: msg.content }, ...toolMessages];
          }

          return toolMessages;
        } else {
          return [
            {
              role: 'user',
              content: msg.content,
            },
          ];
        }
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          return [
            {
              role: 'assistant',
              content: msg.content || null,
              tool_calls: msg.toolCalls.map((toolCall: ProviderToolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.input),
                },
              })),
            },
          ];
        } else {
          return [
            {
              role: 'assistant',
              content: msg.content,
            },
          ];
        }
      } else {
        return [
          {
            role: msg.role,
            content: msg.content,
          },
        ];
      }
    });
}

/**
 * Converts enhanced ProviderMessage format to LMStudio's simple message format
 * Preserves structure by converting tool calls to JSON blocks instead of bracketed text
 */
export function convertToLMStudioFormat(
  messages: ProviderMessage[]
): Array<{ role: string; content: string }> {
  return messages.map((msg) => {
    if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
      // Convert tool results to text descriptions (same as text-only format)
      const toolResultTexts = msg.toolResults.map((result: ProviderToolResult) => {
        const outputText = result.content.map((block) => block.text || '').join('\n');
        if (!result.isError) {
          return `[Tool result: SUCCESS - ${outputText}]`;
        } else {
          return `[Tool result: ERROR - ${outputText}]`;
        }
      });

      const combinedContent = [msg.content, ...toolResultTexts].filter(Boolean).join('\n\n');

      return {
        role: msg.role,
        content: combinedContent || toolResultTexts.join('\n\n'),
      };
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Convert tool calls to JSON blocks (NOT bracketed text)
      const toolCallJsonBlocks = msg.toolCalls.map(
        (toolCall: ProviderToolCall) =>
          `\`\`\`json\n{\n  "name": "${toolCall.name}",\n  "arguments": ${JSON.stringify(toolCall.input)}\n}\n\`\`\``
      );

      const combinedContent = [msg.content, ...toolCallJsonBlocks].filter(Boolean).join('\n\n');

      return {
        role: msg.role,
        content: combinedContent || toolCallJsonBlocks.join('\n\n'),
      };
    } else {
      // No tool calls/results, return as-is with content safety
      return {
        role: msg.role,
        content: msg.content || '',
      };
    }
  });
}

/**
 * Converts Lace Tool format to LMStudio rawTools format
 * Used for native tool calling with LMStudio's .respond() method
 */
export function convertToLMStudioTools(tools: Tool[]): {
  type: 'toolArray';
  tools: LMStudioTool[];
} {
  const lmstudioTools: LMStudioTool[] = tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));

  return {
    type: 'toolArray',
    tools: lmstudioTools,
  };
}

/**
 * Type definitions for LMStudio tool format
 */
interface LMStudioTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Converts enhanced ProviderMessage format to text-only format
 * (Fallback for providers that don't support native tool calling)
 */
export function convertToTextOnlyFormat(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.map((msg): ProviderMessage => {
    if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
      // Convert tool results to text descriptions
      const toolResultTexts = msg.toolResults.map((result) => {
        const outputText = result.content.map((block) => block.text || '').join('\n');
        if (!result.isError) {
          return `[Tool result: SUCCESS - ${outputText}]`;
        } else {
          return `[Tool result: ERROR - ${outputText}]`;
        }
      });

      const combinedContent = [msg.content, ...toolResultTexts].filter(Boolean).join('\n\n');

      return {
        role: 'user',
        content: combinedContent || toolResultTexts.join('\n\n'),
      };
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Convert tool calls to text descriptions
      const toolCallTexts = msg.toolCalls.map(
        (toolCall) =>
          `[Called tool: ${toolCall.name} with input: ${JSON.stringify(toolCall.input)}]`
      );

      const combinedContent = [msg.content, ...toolCallTexts].filter(Boolean).join('\n\n');

      return {
        role: 'assistant',
        content: combinedContent || toolCallTexts.join('\n\n'),
      };
    } else {
      // No tool calls/results, return as-is
      return {
        role: msg.role,
        content: msg.content,
      };
    }
  });
}
