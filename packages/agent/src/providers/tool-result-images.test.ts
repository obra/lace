// ABOUTME: PRI-3078 — tool-result image blocks must survive conversion to the wire format.
// ABOUTME: They were flattened to `block.text || ''`, so an image became an empty string
// ABOUTME: before the model saw it: an agent that had just "read" a screenshot saw nothing.
// ABOUTME: NOTE the shape used here is the FLAT tools/types ContentBlock a real tool result
// ABOUTME: carries ({type,data,mimeType}), not the nested-`source` provider block.

import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from './base-provider';
import type { ContentBlock as ToolResultContentBlock } from '../tools/types';
import {
  convertToAnthropicFormat,
  convertToGeminiFormat,
  convertToOpenAIFormat,
  toOpenAIResponsesToolOutput,
} from './format-converters';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function withToolResults(toolResults: ProviderMessage['toolResults']): ProviderMessage[] {
  return [{ role: 'user', content: '', toolResults }];
}

function firstToolResult(out: unknown[]): Record<string, unknown> {
  return (out[0] as { content: Array<Record<string, unknown>> }).content[0];
}

describe('PRI-3078: tool-result image blocks reach the model', () => {
  it('keeps a text-only tool result as a flat string (common path unchanged)', () => {
    const out = convertToAnthropicFormat(
      withToolResults([
        { id: 'toolu_1', status: 'completed', content: [{ type: 'text', text: 'hello' }] },
      ])
    );
    expect(firstToolResult(out)?.content).toBe('hello');
  });

  it('emits an image block when the tool result carries data + mimeType', () => {
    const out = convertToAnthropicFormat(
      withToolResults([
        {
          id: 'toolu_2',
          status: 'completed',
          content: [
            { type: 'text', text: 'screenshot.png' },
            { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
          ],
        },
      ])
    );
    const inner = firstToolResult(out)?.content as Array<Record<string, unknown>>;
    expect(Array.isArray(inner)).toBe(true);
    expect(inner[0]).toEqual({ type: 'text', text: 'screenshot.png' });
    expect(inner[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: PNG_1PX },
    });
  });

  it('does not silently drop the image bytes', () => {
    const out = convertToAnthropicFormat(
      withToolResults([
        {
          id: 'toolu_3',
          status: 'completed',
          content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
        },
      ])
    );
    expect(JSON.stringify(out)).toContain(PNG_1PX);
  });

  it('degrades to explanatory text rather than guessing a missing media type', () => {
    // A wrong media_type is an API error at best and a mis-decoded image at
    // worst. Saying so is more useful to the model than a silent empty string.
    const out = convertToAnthropicFormat(
      withToolResults([
        { id: 'toolu_4', status: 'completed', content: [{ type: 'image', data: PNG_1PX }] },
      ])
    );
    const inner = firstToolResult(out)?.content as Array<Record<string, unknown>>;
    expect(inner[0]).toEqual({
      type: 'text',
      text: '[image omitted: no media type reported by the tool]',
    });
  });

  it('still marks a failed image-bearing tool result as an error', () => {
    const out = convertToAnthropicFormat(
      withToolResults([
        {
          id: 'toolu_5',
          status: 'failed',
          content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
        },
      ])
    );
    expect(firstToolResult(out)?.is_error).toBe(true);
  });
});

describe('PRI-3079: OpenAI Responses API tool output', () => {
  it('keeps a text-only tool result as a flat string (common path unchanged)', () => {
    expect(toOpenAIResponsesToolOutput([{ type: 'text', text: 'hello' }])).toBe('hello');
  });

  it('emits an input_image data URL when the block carries data + mimeType', () => {
    // Verified against openai@6 `ResponseInputItem.FunctionCallOutput`:
    // `output: string | ResponseFunctionCallOutputItemList`, whose items are
    // ResponseInputTextContent | ResponseInputImageContent | ResponseInputFileContent.
    const out = toOpenAIResponsesToolOutput([
      { type: 'text', text: 'screenshot.png' },
      { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
    ]);
    expect(out).toEqual([
      { type: 'input_text', text: 'screenshot.png' },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG_1PX}` },
    ]);
  });

  it('does not silently drop the image bytes', () => {
    const out = toOpenAIResponsesToolOutput([
      { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
    ]);
    expect(JSON.stringify(out)).toContain(PNG_1PX);
  });

  it('degrades to explanatory text when the media type is missing', () => {
    const out = toOpenAIResponsesToolOutput([{ type: 'image', data: PNG_1PX }]);
    expect(out).toEqual([
      { type: 'input_text', text: '[image omitted: no media type reported by the tool]' },
    ]);
  });

  it('degrades to explanatory text when the image data is missing', () => {
    const out = toOpenAIResponsesToolOutput([{ type: 'image', mimeType: 'image/png' }]);
    expect(out).toEqual([
      {
        type: 'input_text',
        text: '[image omitted: no image data reported by the tool (image/png)]',
      },
    ]);
  });
});

describe('PRI-3079: OpenAI chat-completions tool message', () => {
  it('keeps a text-only tool result as a flat string (common path unchanged)', () => {
    const out = convertToOpenAIFormat(
      withToolResults([
        { id: 'call_1', status: 'completed', content: [{ type: 'text', text: 'hello' }] },
      ])
    );
    expect(out[0]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'hello' });
  });

  it('tells the model an image was produced instead of sending an empty string', () => {
    // `ChatCompletionToolMessageParam.content` is `string | ChatCompletionContentPartText[]`
    // in openai@6 — text only, so the image genuinely cannot travel here.
    const out = convertToOpenAIFormat(
      withToolResults([
        {
          id: 'call_2',
          status: 'completed',
          content: [
            { type: 'text', text: 'screenshot.png' },
            { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
          ],
        },
      ])
    );
    expect(out[0]).toEqual({
      role: 'tool',
      tool_call_id: 'call_2',
      content:
        'screenshot.png\n[image omitted: this provider cannot carry an image in a tool result (image/png)]',
    });
  });

  it('never yields an empty string for an image-only result', () => {
    const out = convertToOpenAIFormat(
      withToolResults([
        {
          id: 'call_3',
          status: 'completed',
          content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
        },
      ])
    );
    expect((out[0] as { content: string }).content).not.toBe('');
  });

  it('reports the omission without inventing a media type it was not given', () => {
    const out = convertToOpenAIFormat(
      withToolResults([
        { id: 'call_4', status: 'completed', content: [{ type: 'image', data: PNG_1PX }] },
      ])
    );
    expect((out[0] as { content: string }).content).toBe(
      '[image omitted: this provider cannot carry an image in a tool result]'
    );
  });

  it('reports missing bytes rather than an unsupported wire format', () => {
    // Missing bytes is a different failure from "this format is text-only", and the
    // model is better served by the specific one: there was no image at all.
    const out = convertToOpenAIFormat(
      withToolResults([
        { id: 'call_5', status: 'completed', content: [{ type: 'image', mimeType: 'image/png' }] },
      ])
    );
    expect((out[0] as { content: string }).content).toBe(
      '[image omitted: no image data reported by the tool (image/png)]'
    );
  });
});

describe('PRI-3079: Gemini functionResponse', () => {
  function geminiFunctionResponseOutput(content: ToolResultContentBlock[]): unknown {
    const out = convertToGeminiFormat(
      withToolResults([{ id: 'gemini_read_file_123_abc', status: 'completed', content }])
    );
    const part = out[0]?.parts?.[0] as { functionResponse?: { response?: { output?: unknown } } };
    return part.functionResponse?.response?.output;
  }

  it('keeps a text-only tool result as a flat string (common path unchanged)', () => {
    expect(geminiFunctionResponseOutput([{ type: 'text', text: 'hello' }])).toBe('hello');
  });

  it('tells the model an image was produced instead of sending an empty string', () => {
    // @google/genai@1.x `FunctionResponse` is `{id?, name?, response?: Record<string, unknown>,
    // willContinue?, scheduling?}` — there is no `parts` field, so inline image bytes
    // cannot be expressed here.
    expect(
      geminiFunctionResponseOutput([
        { type: 'text', text: 'screenshot.png' },
        { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
      ])
    ).toBe(
      'screenshot.png\n[image omitted: this provider cannot carry an image in a tool result (image/png)]'
    );
  });

  it('never yields an empty string for an image-only result', () => {
    expect(
      geminiFunctionResponseOutput([{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }])
    ).not.toBe('');
  });

  it('reports the omission without inventing a media type it was not given', () => {
    expect(geminiFunctionResponseOutput([{ type: 'image', data: PNG_1PX }])).toBe(
      '[image omitted: this provider cannot carry an image in a tool result]'
    );
  });

  it('reports missing bytes rather than an unsupported wire format', () => {
    expect(geminiFunctionResponseOutput([{ type: 'image', mimeType: 'image/png' }])).toBe(
      '[image omitted: no image data reported by the tool (image/png)]'
    );
  });
});

describe('PRI-3079: resource blocks are not flattened to an empty string', () => {
  // mcp/tool-adapter.ts emits `{type:'resource', uri}` with NO `text`, so every
  // `block.text || ''` on a tool-result path silently turned an MCP resource link
  // into an empty tool result — the same defect as the image case, one enum member
  // over. `uri` is itself optional there, so a missing one must not become
  // '' or the string 'undefined'.
  const RESOURCE_URI = 'file:///tmp/notes.txt';
  const RESOURCE_BLOCK: ToolResultContentBlock = { type: 'resource', uri: RESOURCE_URI };
  const RESOURCE_TEXT = `[resource: ${RESOURCE_URI}]`;

  function geminiOutput(content: ToolResultContentBlock[]): unknown {
    const out = convertToGeminiFormat(
      withToolResults([{ id: 'gemini_read_file_123_abc', status: 'completed', content }])
    );
    const part = out[0]?.parts?.[0] as { functionResponse?: { response?: { output?: unknown } } };
    return part.functionResponse?.response?.output;
  }

  it('names the resource on the Anthropic string path', () => {
    const out = convertToAnthropicFormat(
      withToolResults([{ id: 'toolu_r1', status: 'completed', content: [RESOURCE_BLOCK] }])
    );
    expect(firstToolResult(out)?.content).toBe(RESOURCE_TEXT);
  });

  it('names the resource alongside an image on the Anthropic block path', () => {
    const out = convertToAnthropicFormat(
      withToolResults([
        {
          id: 'toolu_r2',
          status: 'completed',
          content: [RESOURCE_BLOCK, { type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
        },
      ])
    );
    const inner = firstToolResult(out)?.content as Array<Record<string, unknown>>;
    expect(inner[0]).toEqual({ type: 'text', text: RESOURCE_TEXT });
  });

  it('names the resource on the OpenAI Responses string path', () => {
    expect(toOpenAIResponsesToolOutput([RESOURCE_BLOCK])).toBe(RESOURCE_TEXT);
  });

  it('names the resource alongside an image on the OpenAI Responses item path', () => {
    const out = toOpenAIResponsesToolOutput([
      RESOURCE_BLOCK,
      { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
    ]);
    expect(out).toEqual([
      { type: 'input_text', text: RESOURCE_TEXT },
      { type: 'input_image', image_url: `data:image/png;base64,${PNG_1PX}` },
    ]);
  });

  it('names the resource on the OpenAI chat-completions path', () => {
    const out = convertToOpenAIFormat(
      withToolResults([{ id: 'call_r1', status: 'completed', content: [RESOURCE_BLOCK] }])
    );
    expect((out[0] as { content: string }).content).toBe(RESOURCE_TEXT);
  });

  it('names the resource on the Gemini path', () => {
    expect(geminiOutput([RESOURCE_BLOCK])).toBe(RESOURCE_TEXT);
  });

  it('says so when the resource has no uri, on every path', () => {
    const noUri: ToolResultContentBlock[] = [{ type: 'resource' }];
    const missing = '[resource omitted: no uri reported by the tool]';
    const anthropic = convertToAnthropicFormat(
      withToolResults([{ id: 'toolu_r3', status: 'completed', content: noUri }])
    );
    expect(firstToolResult(anthropic)?.content).toBe(missing);
    expect(toOpenAIResponsesToolOutput(noUri)).toBe(missing);
    const openai = convertToOpenAIFormat(
      withToolResults([{ id: 'call_r2', status: 'completed', content: noUri }])
    );
    expect((openai[0] as { content: string }).content).toBe(missing);
    expect(geminiOutput(noUri)).toBe(missing);
  });
});

describe('PRI-3079: empty text blocks stay off the wire', () => {
  // An empty text block carries no information on any path. Anthropic is reported
  // to reject a content array holding one ("text content blocks must be
  // non-empty"), which would turn a silent degradation into a hard 400 for the
  // whole request; that rejection is not confirmed against the live API and the
  // SDK types do not encode it, but dropping the block costs nothing either way.
  const EMPTY_AND_IMAGE: ToolResultContentBlock[] = [
    { type: 'text', text: '' },
    { type: 'image', data: PNG_1PX, mimeType: 'image/png' },
  ];

  it('omits the empty text block from the Anthropic block array', () => {
    const out = convertToAnthropicFormat(
      withToolResults([{ id: 'toolu_e1', status: 'completed', content: EMPTY_AND_IMAGE }])
    );
    const inner = firstToolResult(out)?.content as Array<Record<string, unknown>>;
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({ type: 'image' });
  });

  it('omits the empty text item from the OpenAI Responses item list', () => {
    const out = toOpenAIResponsesToolOutput(EMPTY_AND_IMAGE);
    expect(out).toEqual([{ type: 'input_image', image_url: `data:image/png;base64,${PNG_1PX}` }]);
  });
});
