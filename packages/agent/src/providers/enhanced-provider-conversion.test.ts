// ABOUTME: Tests for provider-specific conversion from enhanced generic format
// ABOUTME: Tests how each provider converts enhanced ProviderMessage to their native format

import { describe, it, expect } from 'vitest';
import { ProviderMessage } from './base-provider';
import {
  convertToAnthropicFormat,
  convertToOpenAIFormat,
  convertToTextOnlyFormat,
} from './format-converters';

describe('Provider-Specific Format Conversion', () => {
  const enhancedMessages: ProviderMessage[] = [
    {
      role: 'user',
      content: 'Read a file',
    },
    {
      role: 'assistant',
      content: 'I will read the file for you.',
      toolCalls: [
        {
          id: 'toolu_123',
          name: 'file_read',
          arguments: { path: 'src/tools/types.ts' },
        },
      ],
    },
    {
      role: 'user',
      content: '',
      toolResults: [
        {
          id: 'toolu_123',
          content: [{ type: 'text', text: 'export interface Tool { ... }' }],
          status: 'completed',
        },
      ],
    },
    {
      role: 'assistant',
      content: 'Here is the content of the file.',
    },
  ];

  describe('Anthropic format conversion', () => {
    it('should convert enhanced format to Anthropic content blocks format', () => {
      const anthropicMessages = convertToAnthropicFormat(enhancedMessages);

      // Expected Anthropic format with content blocks
      expect(anthropicMessages).toEqual([
        {
          role: 'user',
          content: 'Read a file',
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'I will read the file for you.',
            },
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'file_read',
              input: { path: 'src/tools/types.ts' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_123',
              content: 'export interface Tool { ... }',
            },
          ],
        },
        {
          role: 'assistant',
          content: 'Here is the content of the file.',
        },
      ]);
    });

    it('should handle assistant message with only tool calls (no text)', () => {
      const messagesWithToolCallsOnly: ProviderMessage[] = [
        {
          role: 'user',
          content: 'Run command',
        },
        {
          role: 'assistant',
          content: '', // No text content, just tool call
          toolCalls: [
            {
              id: 'toolu_456',
              name: 'bash',
              arguments: { command: 'ls -la' },
            },
          ],
        },
      ];

      const anthropicMessages = convertToAnthropicFormat(messagesWithToolCallsOnly);

      expect(anthropicMessages).toEqual([
        {
          role: 'user',
          content: 'Run command',
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_456',
              name: 'bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      ]);
    });

    it('should handle user message with only tool results (no text)', () => {
      const messagesWithToolResultsOnly: ProviderMessage[] = [
        {
          role: 'user',
          content: '', // No text content, just tool result
          toolResults: [
            {
              id: 'toolu_789',
              content: [{ type: 'text', text: 'total 24\ndrwxr-xr-x  5 user  staff  160 ...' }],
              status: 'completed',
            },
          ],
        },
      ];

      const anthropicMessages = convertToAnthropicFormat(messagesWithToolResultsOnly);

      expect(anthropicMessages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_789',
              content: 'total 24\ndrwxr-xr-x  5 user  staff  160 ...',
            },
          ],
        },
      ]);
    });

    it('should place tool_result blocks BEFORE text in user messages (Anthropic rejects text-first)', () => {
      // Regression test: when a user message has both toolResults AND text content
      // (e.g. a context_injected notification merged via appendOrMergeUser into the
      // user message that already held the tool_result), the wire format must emit
      // tool_result blocks FIRST, then the text. Anthropic's API rejects requests
      // where a text block precedes the tool_result that satisfies the prior
      // assistant turn's tool_use — even though both are present in the same user
      // message. Observed in production as: messages.N: tool_use ids were found
      // without tool_result blocks immediately after.
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'toolu_B', name: 'delegate', arguments: {} }],
        },
        {
          role: 'user',
          content: '<notification kind="job-completed" job-id="other">…</notification>',
          toolResults: [
            {
              id: 'toolu_B',
              content: [{ type: 'text', text: '{"jobId":"job_x","status":"started"}' }],
              status: 'completed',
            },
          ],
        },
      ];

      const anthropicMessages = convertToAnthropicFormat(messages);

      // The user message at index 1 must place tool_result FIRST, text SECOND.
      const userMsg = anthropicMessages[1];
      expect(userMsg.role).toBe('user');
      expect(Array.isArray(userMsg.content)).toBe(true);
      const blocks = userMsg.content as Array<{ type: string }>;
      expect(blocks[0].type).toBe('tool_result');
      expect(blocks[1].type).toBe('text');
    });

    it('should handle tool results with errors', () => {
      const messagesWithErrors: ProviderMessage[] = [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'toolu_error',
              content: [{ type: 'text', text: 'Permission denied' }],
              status: 'failed',
            },
          ],
        },
      ];

      const anthropicMessages = convertToAnthropicFormat(messagesWithErrors);

      expect(anthropicMessages).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_error',
              content: 'Permission denied',
              is_error: true,
            },
          ],
        },
      ]);
    });
  });

  describe('OpenAI format conversion (for future support)', () => {
    it('should convert enhanced format to OpenAI tool_calls format', () => {
      const openaiMessages = convertToOpenAIFormat(enhancedMessages);

      // Expected OpenAI format
      expect(openaiMessages).toEqual([
        {
          role: 'user',
          content: 'Read a file',
        },
        {
          role: 'assistant',
          content: 'I will read the file for you.',
          tool_calls: [
            {
              id: 'toolu_123',
              type: 'function',
              function: {
                name: 'file_read',
                arguments: JSON.stringify({ path: 'src/tools/types.ts' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'toolu_123',
          content: 'export interface Tool { ... }',
        },
        {
          role: 'assistant',
          content: 'Here is the content of the file.',
        },
      ]);
    });
  });

  describe('Text-only format conversion (for providers without tool support)', () => {
    it('should convert enhanced format to text descriptions for non-tool-supporting providers', () => {
      const textMessages = convertToTextOnlyFormat(enhancedMessages);

      // For providers that don't support tool calling, we fall back to text descriptions
      expect(textMessages).toEqual([
        {
          role: 'user',
          content: 'Read a file',
        },
        {
          role: 'assistant',
          content:
            'I will read the file for you.\n\n[Called tool: file_read with input: {"path":"src/tools/types.ts"}]',
        },
        {
          role: 'user',
          content: '[Tool result: SUCCESS - export interface Tool { ... }]',
        },
        {
          role: 'assistant',
          content: 'Here is the content of the file.',
        },
      ]);
    });

    it('should handle tool results with errors in text format', () => {
      const messagesWithErrors: ProviderMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'toolu_error',
              name: 'bash',
              arguments: { command: 'invalid-cmd' },
            },
          ],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'toolu_error',
              content: [{ type: 'text', text: 'Command not found' }],
              status: 'failed',
            },
          ],
        },
      ];

      const textMessages = convertToTextOnlyFormat(messagesWithErrors);

      expect(textMessages).toEqual([
        {
          role: 'assistant',
          content: '[Called tool: bash with input: {"command":"invalid-cmd"}]',
        },
        {
          role: 'user',
          content: '[Tool result: ERROR - Command not found]',
        },
      ]);
    });
  });

  describe('Multiple tool calls and results grouping', () => {
    it('should handle multiple tool calls in single assistant message', () => {
      const multiToolMessages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: 'I will read both files.',
          toolCalls: [
            {
              id: 'toolu_file1',
              name: 'file_read',
              arguments: { path: 'file1.txt' },
            },
            {
              id: 'toolu_file2',
              name: 'file_read',
              arguments: { path: 'file2.txt' },
            },
          ],
        },
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'toolu_file1',
              content: [{ type: 'text', text: 'Content 1' }],
              status: 'completed',
            },
            {
              id: 'toolu_file2',
              content: [{ type: 'text', text: 'Content 2' }],
              status: 'completed',
            },
          ],
        },
      ];

      const anthropicMessages = convertToAnthropicFormat(multiToolMessages);

      expect(anthropicMessages).toEqual([
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'I will read both files.',
            },
            {
              type: 'tool_use',
              id: 'toolu_file1',
              name: 'file_read',
              input: { path: 'file1.txt' },
            },
            {
              type: 'tool_use',
              id: 'toolu_file2',
              name: 'file_read',
              input: { path: 'file2.txt' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_file1',
              content: 'Content 1',
            },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_file2',
              content: 'Content 2',
            },
          ],
        },
      ]);
    });
  });
});
