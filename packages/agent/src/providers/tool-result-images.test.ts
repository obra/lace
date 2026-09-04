// ABOUTME: PRI-3078 — tool-result image blocks must survive conversion to the wire format.
// ABOUTME: They were flattened to `block.text || ''`, so an image became an empty string
// ABOUTME: before the model saw it: an agent that had just "read" a screenshot saw nothing.
// ABOUTME: NOTE the shape used here is the FLAT tools/types ContentBlock a real tool result
// ABOUTME: carries ({type,data,mimeType}), not the nested-`source` provider block.

import { describe, expect, it } from 'vitest';
import type { ProviderMessage } from './base-provider';
import { convertToAnthropicFormat } from './format-converters';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function withToolResults(toolResults: ProviderMessage['toolResults']): ProviderMessage[] {
  return [{ role: 'user', content: '', toolResults }];
}

function firstToolResult(out: ProviderMessage[] | Record<string, unknown>[]) {
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
          status: 'error',
          content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }],
        },
      ])
    );
    expect(firstToolResult(out)?.is_error).toBe(true);
  });
});
