// ABOUTME: Provider-specific format conversion functions for enhanced ProviderMessage format
// ABOUTME: Converts generic tool call format to provider-specific native formats

import { ProviderMessage, ContentBlock, type ThinkingBlock } from './base-provider';
import type { ContentBlock as ToolResultContentBlock } from '../tools/types';
import { ToolCall } from '@lace/agent/tools/types';
import Anthropic from '@anthropic-ai/sdk';
import type { Content, FunctionResponsePart, Part } from '@google/genai';
import type {
  ResponseFunctionCallOutputItem,
  ResponseInputContent,
  ResponseInputItem,
  ResponseInputMessageContentList,
} from 'openai/resources/responses/responses';
import { getTextContent } from '@lace/agent/providers/utils/content-helpers';

/**
 * Convert stored ThinkingBlocks into Anthropic content-block params. Anthropic
 * requires these replayed verbatim (signature included) and placed before text
 * and tool_use on the assistant turn, or the request 400s.
 */
function toAnthropicThinkingBlocks(
  blocks: ThinkingBlock[] | undefined
): (Anthropic.ThinkingBlockParam | Anthropic.RedactedThinkingBlockParam)[] {
  return (blocks ?? []).map((b) =>
    b.type === 'thinking'
      ? { type: 'thinking', thinking: b.thinking, signature: b.signature }
      : { type: 'redacted_thinking', data: b.data }
  );
}

/**
 * PRI-3078. A tool result's blocks use the FLAT `tools/types` ContentBlock
 * (`{type, text?, data?, uri?, mimeType?}`), NOT the provider-side block with a
 * nested `source`. They are different types with the same name, which is how
 * the original defect survived: `block.text || ''` is valid on both, and on an
 * image block it silently yields ''.
 *
 * An image needs BOTH bytes and a media type to become a provider block. We do
 * not guess a media type when it is absent — a wrong one is an API error at
 * best and a mis-decoded image at worst — so such a block degrades to text that
 * says so, which is at least honest to the model about what happened.
 *
 * The block-array form is chosen when the result contains ANY image block, not
 * only a renderable one. Gating on renderable would send an unrenderable image
 * back down the string path, where `block.text || ''` turns it into '' — the
 * exact silent drop this change exists to remove, just narrowed to a rarer case.
 */

/**
 * Why an image block cannot become a provider image block, or null if it can.
 * Both halves matter: bytes with no media type are undecodable, and a media
 * type with no bytes is nothing at all.
 */
function unrenderableImageReason(block: ToolResultContentBlock): string | null {
  if (!block.data) return 'no image data reported by the tool';
  if (!block.mimeType) return 'no media type reported by the tool';
  return null;
}

/**
 * A tool-result block that is not an image, rendered as text.
 *
 * PRI-3079 follow-up: a `resource` block carries a `uri` and no `text` (see
 * `mcp/tool-adapter.ts`), so the unconditional `block.text || ''` flattened an
 * MCP resource link to '' — the same silent drop as the image case, one enum
 * member over. The uri is itself optional in the MCP payload, so a missing one
 * is reported rather than emitted as '' or the string 'undefined'.
 */
function nonImageToolResultBlockAsText(block: ToolResultContentBlock): string {
  if (block.type === 'resource') {
    return block.uri
      ? `[resource: ${block.uri}]`
      : '[resource omitted: no uri reported by the tool]';
  }
  return block.text || '';
}

/**
 * An empty text block carries no information on any path, and Anthropic is
 * reported to reject one outright ("text content blocks must be non-empty"),
 * which would turn a degraded block into a 400 for the whole request. Not
 * confirmed against the live API — the SDK types do not encode the constraint —
 * but there is nothing to lose by dropping it from the array forms.
 */
function hasText(block: { type: string; text?: string }): boolean {
  return block.type !== 'text' || (block.text ?? '').length > 0;
}

/**
 * PRI-3079. Some tool-result wire formats cannot carry an image at all: OpenAI's
 * `ChatCompletionToolMessageParam.content` is `string | ContentPartText[]`, and a
 * Gemini `functionResponse` reduces to its JSON `response` object on every model
 * before the Gemini 3 series (see `toGeminiToolResultResponse`).
 */
const TOOL_RESULT_IMAGE_UNSUPPORTED = 'this provider cannot carry an image in a tool result';

/**
 * Text stand-in for an image block that is not being sent as an image. The
 * result is never '' — an empty string is exactly the silent drop PRI-3078
 * removed, and the model has to be told an image existed. The media type is
 * reported when known and never guessed.
 */
function describeOmittedToolResultImage(block: ToolResultContentBlock, reason: string): string {
  const mediaType = block.mimeType ? ` (${block.mimeType})` : '';
  return `[image omitted: ${reason}${mediaType}]`;
}

/**
 * Flatten a tool-result block to text for a provider whose tool-result format
 * cannot carry images at all. Image blocks become an explanation rather than ''.
 *
 * A missing media type is NOT the reason to report here: it would imply the
 * image would otherwise have gone through, which is false for these providers.
 * Missing bytes is worth reporting, because then there was no image at all.
 */
function toolResultBlockAsText(block: ToolResultContentBlock): string {
  if (block.type !== 'image') return nonImageToolResultBlockAsText(block);
  const reason = block.data ? TOOL_RESULT_IMAGE_UNSUPPORTED : 'no image data reported by the tool';
  return describeOmittedToolResultImage(block, reason);
}

function toAnthropicToolResultBlock(
  block: ToolResultContentBlock
): Anthropic.TextBlockParam | Anthropic.ImageBlockParam {
  if (block.type !== 'image') return { type: 'text', text: nonImageToolResultBlockAsText(block) };
  const reason = unrenderableImageReason(block);
  if (reason) return { type: 'text', text: describeOmittedToolResultImage(block, reason) };
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: block.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      data: block.data as string,
    },
  };
}

/**
 * PRI-3079. The Responses API is the one tool-result format among OpenAI's and
 * Gemini's that CAN carry an image, so it gets the real bytes.
 *
 * The return type is the SDK's own, deliberately: `ResponseInputItem.FunctionCallOutput`
 * declares `output: string | ResponseFunctionCallOutputItemList`, whose items are
 * `ResponseInputTextContent | ResponseInputImageContent | ResponseInputFileContent`,
 * and `ResponseInputImageContent.image_url` documents itself as "a fully qualified
 * URL or base64 encoded image in a data URL". The provider pushes these items into
 * an `Array<unknown>`, so nothing downstream would catch an invented field name —
 * annotating here is what makes tsc check the shape against the SDK.
 *
 * As on the Anthropic path, the item-list form is chosen when the result holds
 * ANY image block, not only a renderable one: gating on renderable would push an
 * unrenderable image back down the string path, where `block.text || ''` turns
 * it into '' and recreates the silent drop in a rarer case.
 */
export function toOpenAIResponsesToolOutput(
  content: ToolResultContentBlock[]
): ResponseInputItem.FunctionCallOutput['output'] {
  if (!content.some((block) => block.type === 'image')) {
    return content.map(nonImageToolResultBlockAsText).join('\n');
  }
  return content
    .map((block): ResponseFunctionCallOutputItem => {
      if (block.type !== 'image') {
        return { type: 'input_text', text: nonImageToolResultBlockAsText(block) };
      }
      const reason = unrenderableImageReason(block);
      if (reason) {
        return { type: 'input_text', text: describeOmittedToolResultImage(block, reason) };
      }
      return {
        type: 'input_image',
        image_url: `data:${block.mimeType as string};base64,${block.data as string}`,
      };
    })
    .filter((item) => item.type !== 'input_text' || item.text.length > 0);
}

/**
 * PRI-3079. Message content for a Responses-API user turn.
 *
 * The Responses path is the default for real OpenAI, and it extracted text
 * blocks only (`getTextContent`), so a user's attached image was dropped — and
 * an image-only message was dropped whole, because the extracted text was empty
 * and nothing got pushed. Anthropic, Gemini and OpenAI chat completions all
 * carry user images; this path has to as well.
 *
 * These blocks are the PROVIDER-side `ContentBlock` with a nested `source`, not
 * the flat `tools/types` one a tool result carries. The return type is the SDK's
 * own so tsc checks the item shapes — `ResponseInputImage.detail` is required.
 *
 * Text-only content keeps the flat string form byte-for-byte.
 */
export function toOpenAIResponsesMessageContent(
  content: string | ContentBlock[]
): string | ResponseInputMessageContentList {
  if (typeof content === 'string') return content;
  if (!content.some((block) => block.type === 'image')) return getTextContent(content);
  return content
    .map(
      (block): ResponseInputContent =>
        block.type === 'text'
          ? { type: 'input_text', text: block.text }
          : {
              type: 'input_image',
              detail: 'auto',
              image_url: `data:${block.source.media_type};base64,${block.source.data}`,
            }
    )
    .filter((item) => item.type !== 'input_text' || item.text.length > 0);
}

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
        // ─────────────────────────────────────────────────────────────────
        // User messages can have tool results.
        //
        // LOAD-BEARING INVARIANT — DO NOT REORDER:
        //   When this user message responds to a prior assistant turn that
        //   contained `tool_use` blocks, the `tool_result` blocks MUST appear
        //   FIRST in this message's content array, BEFORE any text/image.
        //
        // Why: Anthropic's Messages API rejects requests where any block
        //   precedes the tool_result(s) that satisfy the prior turn's
        //   tool_use ids. The rejection surfaces with a misleading error:
        //     "messages.N: tool_use ids were found without tool_result
        //      blocks immediately after: toolu_…"
        //   The tool_result IS present in messages[N+1], just not at index 0,
        //   and Anthropic treats anything-before-tool_result as if the
        //   tool_result is absent.
        //
        // How this gets triggered: `appendOrMergeUser` merges injected text
        //   (e.g. a job-completed notification from a sibling job firing
        //   mid-turn) into the user message that already carries the
        //   tool_result. That sets msg.content = '<notification>…' AND
        //   keeps msg.toolResults intact. Without this ordering, we'd emit
        //   [text, tool_result] and the API would 400.
        //
        // Regression test:
        //   enhanced-provider-conversion.test.ts:
        //   "should place tool_result blocks BEFORE text in user messages"
        // ─────────────────────────────────────────────────────────────────
        if (msg.toolResults && msg.toolResults.length > 0) {
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = msg.toolResults.map(
            (result) => ({
              type: 'tool_result',
              tool_use_id: result.id || '',
              // PRI-3078: an image block carries `data`, not `text`, so the old
              // unconditional `block.text || ''` flattened it to an empty string —
              // the model received a blank tool result, and an agent that had just
              // 'read' a screenshot saw nothing. Anthropic accepts tool_result
              // content as either a string or a block array, so reuse the same
              // per-block conversion this file already applies to plain user
              // messages. Text-only results keep the string form byte-for-byte:
              // the common path does not change shape.
              content: result.content.some((block) => block.type === 'image')
                ? result.content.map(toAnthropicToolResultBlock).filter(hasText)
                : result.content.map(nonImageToolResultBlockAsText).join('\n'),
              // Convert our status to Anthropic's is_error flag
              ...(result.status !== 'completed' ? { is_error: true } : {}),
            })
          );

          if (hasContent(msg.content)) {
            const contentBlocks: Anthropic.ContentBlockParam[] =
              typeof msg.content === 'string'
                ? [{ type: 'text', text: msg.content }]
                : msg.content.map(toAnthropicContentBlock);
            // ORDER IS LOAD-BEARING. See banner comment above. Do not flip.
            return {
              role: 'user',
              content: [...toolResultBlocks, ...contentBlocks],
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
        // Assistant messages can have tool calls. Thinking blocks, when present,
        // must lead the content array (before text and tool_use) and be replayed
        // verbatim — Anthropic adaptive thinking round-tripping.
        const textContent = getTextContent(msg.content);
        const thinkingBlocks = toAnthropicThinkingBlocks(msg.thinkingBlocks);
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: (
            | Anthropic.ThinkingBlockParam
            | Anthropic.RedactedThinkingBlockParam
            | Anthropic.TextBlockParam
            | Anthropic.ToolUseBlockParam
          )[] = [...thinkingBlocks];

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
          // Pure text assistant message. If there is no text content at all and
          // no thinking blocks, this turn is semantically empty — upstream code
          // that produces such a turn is a bug. Returning null signals "drop this
          // message" so it never pollutes the cached prefix with a placeholder
          // the model will learn to mimic.
          const trimmed = textContent.trim();
          if (trimmed.length === 0 && thinkingBlocks.length === 0) {
            return null;
          }
          // Thinking present: emit an array with the thinking blocks first, then
          // the text (if any). Without thinking, keep the simple string form.
          if (thinkingBlocks.length > 0) {
            const content: (
              | Anthropic.ThinkingBlockParam
              | Anthropic.RedactedThinkingBlockParam
              | Anthropic.TextBlockParam
            )[] = [...thinkingBlocks];
            if (trimmed.length > 0) {
              content.push({ type: 'text', text: trimmed });
            }
            return { role: 'assistant', content };
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
              // PRI-3079: `ChatCompletionToolMessageParam.content` is
              // `string | ChatCompletionContentPartText[]` — text only, so an image
              // genuinely cannot travel in a chat-completions tool message. Say so
              // rather than flattening the block to '' and telling the model nothing.
              content: result.content.map(toolResultBlockAsText).join('\n'),
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
 * PRI-3079. Google documents multimodal function responses as available for
 * "Gemini 3 series models" only, and this catalog's default models are
 * gemini-2.5-pro/flash, so the older path is the common one and must not be
 * handed a shape the model would reject.
 *
 * Matched on the id because the model catalog has no capability flag for it:
 * `supports_attachments` is true for every Gemini entry and describes USER
 * attachments, which 2.5 does carry. The `[.-]` tail keeps a future
 * `gemini-3.5-*` in and keeps a hypothetical `gemini-30-*` out.
 */
function supportsMultimodalFunctionResponse(model: string): boolean {
  return /(?:^|\/)gemini-3(?:[.-]|$)/.test(model);
}

/**
 * PRI-3079. The `response`/`parts` pair for one Gemini functionResponse.
 *
 * `@google/genai@2.x` declares `FunctionResponse.parts?: FunctionResponsePart[]`
 * with `FunctionResponsePart.inlineData?: FunctionResponseBlob {data, mimeType}` —
 * image bytes nested INSIDE the functionResponse. Note that a sibling `inlineData`
 * part typechecks just as well (that is how a *user* image travels, above) and is
 * the wrong shape. `FunctionResponsePart` has no `text` member, so the text half
 * of a mixed result stays in `response.output`.
 *
 * A rendered image still gets a line in `output`: it keeps the tool's own ordering
 * of text and images legible, and it means an image-only result never produces the
 * empty string PRI-3078 exists to remove.
 */
function toGeminiToolResultResponse(
  content: ToolResultContentBlock[],
  model: string
): { output: string; parts?: FunctionResponsePart[] } {
  if (!supportsMultimodalFunctionResponse(model)) {
    return { output: content.map(toolResultBlockAsText).join('\n') };
  }
  const parts: FunctionResponsePart[] = [];
  const lines = content.map((block) => {
    if (block.type !== 'image') return nonImageToolResultBlockAsText(block);
    // On Gemini 3 the wire format is no longer the obstacle, so the honest reason
    // for an omission is the block's own: undecodable bytes, or no bytes at all.
    const reason = unrenderableImageReason(block);
    if (reason) return describeOmittedToolResultImage(block, reason);
    parts.push({
      inlineData: { data: block.data as string, mimeType: block.mimeType as string },
    });
    return `[image: ${block.mimeType as string}]`;
  });
  return { output: lines.join('\n'), ...(parts.length > 0 ? { parts } : {}) };
}

/**
 * Converts enhanced ProviderMessage format to Gemini Content/Part format.
 *
 * `model` decides whether a tool-result image can travel as bytes; see
 * `toGeminiToolResultResponse`. It is required rather than optional so a new call
 * site cannot silently drop images by forgetting it.
 */
export function convertToGeminiFormat(messages: ProviderMessage[], model: string): Content[] {
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

          const { output, parts: responseParts } = toGeminiToolResultResponse(
            result.content,
            model
          );
          parts.push({
            functionResponse: {
              name: toolName, // Function name for Gemini API
              id: correlationId, // Tool call ID for correlation
              ...(responseParts ? { parts: responseParts } : {}),
              response: {
                output,
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
