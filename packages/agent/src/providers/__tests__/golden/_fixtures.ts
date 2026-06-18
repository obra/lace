// ABOUTME: Shared fixture corpus for the per-provider golden-bytes tests. Each
// fixture is a deterministic ProviderMessage[] + tools + systemPrompt that
// exercises one wire-shape concern (thinking, tool args, images, compaction
// era, unicode, orphaned tool block). The SAME fixtures feed every provider's
// golden test so a refactor is checked byte-for-byte against committed bytes.

import { Tool } from '@lace/agent/tools/tool';
import { z } from 'zod';
import type { ToolContext, ToolResult } from '@lace/agent/tools/types';
import type { ProviderMessage } from '@lace/agent/providers/base-provider';

export class EchoTool extends Tool {
  name = 'echo';
  description = 'Echo a value';
  schema = z.object({ v: z.string() });
  protected async executeValidated(args: { v: string }, _c: ToolContext): Promise<ToolResult> {
    return await Promise.resolve(this.createResult(args.v));
  }
}

export type GoldenFixture = {
  name: string;
  systemPrompt: string;
  tools: Tool[];
  messages: ProviderMessage[];
};

const SYSTEM = 'You are Lace. Cached system block.';

export const FIXTURES: GoldenFixture[] = [
  {
    name: 'plain-conversation',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'how are you' },
    ],
  },
  {
    name: 'thinking-blocks',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'think about this' },
      {
        role: 'assistant',
        content: 'done',
        thinkingBlocks: [{ type: 'thinking', thinking: 'let me reason', signature: 'sig-abc' }],
      },
    ],
  },
  {
    name: 'tool-call-multikey-numeric-args',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'use the tool' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'echo',
            arguments: { v: 'x', count: 3, flag: true, nested: { a: 1 } },
          },
        ],
      },
      {
        role: 'user',
        content: '',
        toolResults: [
          { id: 'call_1', content: [{ type: 'text', text: 'x' }], status: 'completed' },
        ],
      },
    ],
  },
  {
    name: 'unicode-and-surrogates',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'café — 日本語 — 😀 — \uD83D' }, // trailing lone high surrogate on purpose
      { role: 'assistant', content: 'ok' },
    ],
  },
  {
    name: 'image-block',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
          },
        ],
      },
      { role: 'assistant', content: 'an image' },
    ],
  },
  {
    name: 'orphaned-tool-block',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_orphan', name: 'echo', arguments: { v: 'y' } }],
      },
      // no matching tool_result — the converter/guard must handle this deterministically
      { role: 'user', content: 'next question' },
    ],
  },
  {
    name: 'post-compaction-double-system',
    systemPrompt: SYSTEM,
    tools: [new EchoTool()],
    messages: [
      { role: 'user', content: 'summary of prior era' },
      { role: 'assistant', content: 'acknowledged' },
      { role: 'user', content: 'new turn after compaction' },
    ],
  },
];
