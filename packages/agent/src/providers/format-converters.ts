// ABOUTME: Provider-specific format conversion functions for enhanced ProviderMessage format
// ABOUTME: Converts generic tool call format to provider-specific native formats

import { ProviderMessage, ContentBlock } from './base-provider';
import { ToolCall } from '@lace/agent/tools/types';
import Anthropic from '@anthropic-ai/sdk';
import type { Content, Part } from '@google/genai';
import { getTextContent } from '@lace/agent/providers/utils/content-helpers';

/**
 * Helper to convert our ContentBlock to Anthropic's content block format
 */
function toAnthropicContentBlock(
  block: ContentBlock
): Anthropic.TextBlockParam | Anthropic.ImageBlockParam {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  } else {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: block.source.media_type as
          | 'image/jpeg'
          | 'image/png'
          | 'image/gif'
          | 'image/webp',
        data: block.source.data,
      },
    };
  }
}

/**
 * Helper to check if content has any non-empty value
 */
function hasContent(content: string | ContentBlock[]): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  return content.length > 0;
}

/**
 * Converts enhanced ProviderMessage format to Anthropic's content blocks format
 */
export function convertToAnthropicFormat(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((msg): Anthropic.MessageParam | null => {
      if (msg.role === 'user') {
        // User messages can have tool results
        if (msg.toolResults && msg.toolResults.length > 0) {
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = msg.toolResults.map(
            (result) => ({
              type: 'tool_result',
              tool_use_id: result.id || '',
              content: result.content.map((block) => block.text || '').join('\n'),
              // Convert our status to Anthropic's is_error flag
              ...(result.status !== 'completed' ? { is_error: true } : {}),
            })
          );

          // If there's also text/image content, add it
          if (hasContent(msg.content)) {
            const contentBlocks: Anthropic.ContentBlockParam[] =
              typeof msg.content === 'string'
                ? [{ type: 'text', text: msg.content }]
                : msg.content.map(toAnthropicContentBlock);
            return {
              role: 'user',
              content: [...contentBlocks, ...toolResultBlocks],
            };
          }

          return {
            role: 'user',
            content: toolResultBlocks,
          };
        } else {
          // Pure user message (text or text+images)
          if (typeof msg.content === 'string') {
            return {
              role: 'user',
              content: msg.content,
            };
          } else {
            // Content blocks with potential images
            return {
              role: 'user',
              content: msg.content.map(toAnthropicContentBlock),
            };
          }
        }
      } else if (msg.role === 'assistant') {
        // Assistant messages can have tool calls
        const textContent = getTextContent(msg.content);
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];

          // Add text content if present
          if (textContent.trim()) {
            content.push({ type: 'text', text: textContent });
          }

          // Add tool calls
          msg.toolCalls.forEach((toolCall: ToolCall) => {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments,
            });
          });

          return {
            role: 'assistant',
            content,
          };
        } else {
          // Pure text assistant message. If there is no text content at all,
          // this turn is semantically empty — upstream code that produces such
          // a turn is a bug. Returning null signals "drop this message" so it
          // never pollutes the cached prefix with a placeholder the model will
          // learn to mimic.
          const trimmed = textContent.trim();
          if (trimmed.length === 0) {
            return null;
          }
          return {
            role: 'assistant',
            content: trimmed,
          };
        }
      } else {
        // System messages shouldn't reach here due to filter, but handle gracefully
        return {
          role: 'assistant',
          content: getTextContent(msg.content),
        };
      }
    })
    .filter((m): m is Anthropic.MessageParam => m !== null);
}

/**
 * Helper to convert our ContentBlock to OpenAI's content part format
 */
type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toOpenAIContentPart(block: ContentBlock): OpenAIContentPart {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  } else {
    // OpenAI uses data URLs for base64 images
    return {
      type: 'image_url',
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
      },
    };
  }
}

/**
 * Convert content to OpenAI format - string for simple text, array for images
 */
function toOpenAIContent(content: string | ContentBlock[]): string | OpenAIContentPart[] {
  if (typeof content === 'string') return content;

  // Check if we have any images
  const hasImages = content.some((b) => b.type === 'image');
  if (!hasImages) {
    // Just text, return as string
    return content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  // Has images, return as array
  return content.map(toOpenAIContentPart);
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
          const toolMessages = msg.toolResults
            .filter((result) => result.id) // Only include results with valid IDs
            .map((result) => ({
              role: 'tool',
              tool_call_id: result.id!, // Safe to use ! since we filtered
              content: result.content.map((block) => block.text || '').join('\n'),
            }));

          // If there's also text/image content, include the user message first
          if (hasContent(msg.content)) {
            return [{ role: 'user', content: toOpenAIContent(msg.content) }, ...toolMessages];
          }

          return toolMessages;
        } else {
          return [
            {
              role: 'user',
              content: toOpenAIContent(msg.content),
            },
          ];
        }
      } else if (msg.role === 'assistant') {
        const textContent = getTextContent(msg.content);
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          return [
            {
              role: 'assistant',
              content: textContent || null,
              tool_calls: msg.toolCalls.map((toolCall: ToolCall) => ({
                id: toolCall.id,
                type: 'function',
                function: {
                  name: toolCall.name,
                  arguments: JSON.stringify(toolCall.arguments),
                },
              })),
            },
          ];
        } else {
          return [
            {
              role: 'assistant',
              content: textContent,
            },
          ];
        }
      } else {
        return [
          {
            role: msg.role,
            content: getTextContent(msg.content),
          },
        ];
      }
    });
}

/**
 * Converts enhanced ProviderMessage format to text-only format
 * (Fallback for providers that don't support native tool calling)
 * Note: Images are discarded in text-only format as they cannot be represented as text
 */
export function convertToTextOnlyFormat(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.map((msg): ProviderMessage => {
    const textContent = getTextContent(msg.content);
    if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
      // Convert tool results to text descriptions
      const toolResultTexts = msg.toolResults.map((result) => {
        const outputText = result.content.map((block) => block.text || '').join('\n');
        if (result.status === 'completed') {
          return `[Tool result: SUCCESS - ${outputText}]`;
        } else {
          return `[Tool result: ERROR - ${outputText}]`;
        }
      });

      const combinedContent = [textContent, ...toolResultTexts].filter(Boolean).join('\n\n');

      return {
        role: 'user',
        content: combinedContent || toolResultTexts.join('\n\n'),
      };
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Convert tool calls to text descriptions
      const toolCallTexts = msg.toolCalls.map(
        (toolCall) =>
          `[Called tool: ${toolCall.name} with input: ${JSON.stringify(toolCall.arguments)}]`
      );

      const combinedContent = [textContent, ...toolCallTexts].filter(Boolean).join('\n\n');

      return {
        role: 'assistant',
        content: combinedContent || toolCallTexts.join('\n\n'),
      };
    } else {
      // No tool calls/results, return as-is (with text content only)
      return {
        role: msg.role,
        content: textContent,
      };
    }
  });
}

/**
 * Converts enhanced ProviderMessage format to Gemini Content/Part format
 */
export function convertToGeminiFormat(messages: ProviderMessage[]): Content[] {
  return messages
    .filter((msg) => msg.role !== 'system') // System handled separately in Gemini
    .map((msg): Content => {
      const parts: Part[] = [];

      // Add content blocks (text and images)
      if (typeof msg.content === 'string') {
        if (msg.content.trim()) {
          parts.push({ text: msg.content });
        }
      } else {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text.trim()) {
            parts.push({ text: block.text });
          } else if (block.type === 'image') {
            // Gemini uses inlineData for base64 images
            parts.push({
              inlineData: {
                mimeType: block.source.media_type,
                data: block.source.data,
              },
            });
          }
        }
      }

      if (msg.role === 'assistant' && msg.toolCalls) {
        // Add function calls
        msg.toolCalls.forEach((toolCall) => {
          parts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.arguments,
            },
          });
        });
      }

      if (msg.role === 'user' && msg.toolResults) {
        // Add function responses
        msg.toolResults.forEach((result) => {
          // Decode tool name and call ID from Gemini-encoded tool call ID
          const toolCallId = result.id || '';
          let toolName = 'unknown_function';
          let correlationId = toolCallId;

          // Extract tool name from encoded ID format: gemini_{toolName}_{timestamp}_{random}
          if (toolCallId.startsWith('gemini_')) {
            // Find the last two underscores (timestamp and random parts)
            const lastUnderscoreIndex = toolCallId.lastIndexOf('_');
            const secondLastUnderscoreIndex = toolCallId.lastIndexOf('_', lastUnderscoreIndex - 1);

            if (secondLastUnderscoreIndex > 6) {
              // "gemini_".length = 7, so index > 6 means there's a tool name
              toolName = toolCallId.substring(7, secondLastUnderscoreIndex); // Extract between "gemini_" and second-last "_"
              correlationId = toolCallId; // Use full ID for correlation
            }
          }

          parts.push({
            functionResponse: {
              name: toolName, // Function name for Gemini API
              id: correlationId, // Tool call ID for correlation
              response: {
                output: result.content.map((c) => c.text || '').join('\n'),
                ...(result.status !== 'completed' ? { error: 'Tool execution failed' } : {}),
              },
            },
          });
        });
      }

      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });
}
