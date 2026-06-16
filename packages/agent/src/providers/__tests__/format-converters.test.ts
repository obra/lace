// ABOUTME: Tests for format conversion functions
// ABOUTME: Tests Gemini tool ID encoding/decoding and format conversion

import { describe, it, expect } from 'vitest';
import {
  convertToAnthropicFormat,
  convertToOpenAIFormat,
  convertToGeminiFormat,
} from '../format-converters';
import { ProviderMessage, ContentBlock } from '../base-provider';

describe('Format Converters', () => {
  describe('convertToGeminiFormat', () => {
    it('should decode tool name from Gemini-encoded tool call IDs', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'gemini_file_read_1234567890_abc123',
              content: [{ type: 'text', text: 'File content here' }],
              status: 'completed',
            },
            {
              id: 'gemini_bash_9876543210_def456',
              content: [{ type: 'text', text: 'Command output' }],
              status: 'completed',
            },
          ],
        },
      ];

      const result = convertToGeminiFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(2);

      // Check first function response
      const firstResponse = result[0].parts[0];
      expect(firstResponse).toHaveProperty('functionResponse');
      expect(firstResponse.functionResponse?.name).toBe('file_read');
      expect(firstResponse.functionResponse?.id).toBe('gemini_file_read_1234567890_abc123');
      expect(firstResponse.functionResponse?.response?.output).toBe('File content here');

      // Check second function response
      const secondResponse = result[0].parts[1];
      expect(secondResponse).toHaveProperty('functionResponse');
      expect(secondResponse.functionResponse?.name).toBe('bash');
      expect(secondResponse.functionResponse?.id).toBe('gemini_bash_9876543210_def456');
      expect(secondResponse.functionResponse?.response?.output).toBe('Command output');
    });

    it('should handle non-Gemini tool call IDs gracefully', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'some_other_id_format',
              content: [{ type: 'text', text: 'Some result' }],
              status: 'completed',
            },
          ],
        },
      ];

      const result = convertToGeminiFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].parts).toHaveLength(1);

      const response = result[0].parts[0];
      expect(response.functionResponse?.name).toBe('unknown_function');
      expect(response.functionResponse?.id).toBe('some_other_id_format');
    });

    it('should handle error status in tool results', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: '',
          toolResults: [
            {
              id: 'gemini_file_write_1234567890_abc123',
              content: [{ type: 'text', text: 'Permission denied' }],
              status: 'failed',
            },
          ],
        },
      ];

      const result = convertToGeminiFormat(messages);

      expect(result[0].parts[0].functionResponse?.name).toBe('file_write');
      expect(result[0].parts[0].functionResponse?.response?.error).toBe('Tool execution failed');
      expect(result[0].parts[0].functionResponse?.response?.output).toBe('Permission denied');
    });

    it('should handle user messages with image content blocks', () => {
      const imageContent: ContentBlock[] = [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        },
      ];

      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: imageContent,
        },
      ];

      const result = convertToGeminiFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].parts).toHaveLength(2);

      // Check text part
      expect(result[0].parts[0]).toHaveProperty('text', 'What is in this image?');

      // Check image part - Gemini uses inlineData
      expect(result[0].parts[1]).toHaveProperty('inlineData');
      expect(result[0].parts[1].inlineData?.mimeType).toBe('image/png');
      expect(result[0].parts[1].inlineData?.data).toContain('iVBORw0KGgo');
    });
  });

  describe('convertToAnthropicFormat — empty assistant content', () => {
    it('drops the (no response) placeholder; omits empty assistant turns entirely', () => {
      const messages: ProviderMessage[] = [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '   ' }, // whitespace only, no tool calls
        { role: 'user', content: 'are you there?' },
      ];

      const out = convertToAnthropicFormat(messages);

      // The empty assistant turn is omitted entirely.
      expect(out).toHaveLength(2);
      expect(out[0]).toEqual({ role: 'user', content: 'hi' });
      expect(out[1]).toEqual({ role: 'user', content: 'are you there?' });

      // Placeholder text must not appear anywhere.
      expect(JSON.stringify(out)).not.toContain('(no response)');
    });

    it('preserves assistant messages with non-empty text', () => {
      const messages: ProviderMessage[] = [{ role: 'assistant', content: 'Hello there.' }];
      const out = convertToAnthropicFormat(messages);
      expect(out).toEqual([{ role: 'assistant', content: 'Hello there.' }]);
    });

    it('preserves assistant messages with tool calls but no text', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 't1', name: 'tool', arguments: {} }],
        },
      ];
      const out = convertToAnthropicFormat(messages);
      expect(out).toHaveLength(1);
      expect((out[0].content as Array<{ type: string }>)[0]?.type).toBe('tool_use');
    });
  });

  describe('convertToAnthropicFormat', () => {
    it('should handle string content for user messages', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: 'Hello, world!',
        },
      ];

      const result = convertToAnthropicFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello, world!');
    });

    it('should handle content blocks with images for user messages', () => {
      const imageContent: ContentBlock[] = [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        },
      ];

      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: imageContent,
        },
      ];

      const result = convertToAnthropicFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);

      const content = result[0].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(2);

      // Check text block
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });

      // Check image block
      expect(content[1]).toHaveProperty('type', 'image');
      expect(content[1]).toHaveProperty('source');
      const source = content[1].source as Record<string, unknown>;
      expect(source.type).toBe('base64');
      expect(source.media_type).toBe('image/png');
    });

    it('should extract text from content blocks for assistant messages', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is my response.' }],
        },
      ];

      const result = convertToAnthropicFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('assistant');
      expect(result[0].content).toBe('Here is my response.');
    });

    it('emits thinking blocks first, before text and tool_use, on an assistant turn', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: 'doing the thing',
          thinkingBlocks: [
            { type: 'thinking', thinking: 'reasoning here', signature: 'sig-1' },
            { type: 'redacted_thinking', data: 'blob' },
          ],
          toolCalls: [{ id: 'tc_1', name: 'do_thing', arguments: { a: 1 } }],
        },
      ];

      const result = convertToAnthropicFormat(messages);

      const content = result[0].content as Array<Record<string, unknown>>;
      // [thinking, redacted_thinking, text, tool_use]
      expect(content).toHaveLength(4);
      expect(content[0]).toEqual({
        type: 'thinking',
        thinking: 'reasoning here',
        signature: 'sig-1',
      });
      expect(content[1]).toEqual({ type: 'redacted_thinking', data: 'blob' });
      expect(content[2]).toEqual({ type: 'text', text: 'doing the thing' });
      expect(content[3]).toHaveProperty('type', 'tool_use');
    });

    it('emits thinking blocks before text on a tool-free assistant turn', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'assistant',
          content: 'final text',
          thinkingBlocks: [{ type: 'thinking', thinking: 'mulling', signature: 'sig-2' }],
        },
      ];

      const result = convertToAnthropicFormat(messages);

      const content = result[0].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({ type: 'thinking', thinking: 'mulling', signature: 'sig-2' });
      expect(content[1]).toEqual({ type: 'text', text: 'final text' });
    });
  });

  describe('convertToOpenAIFormat', () => {
    it('should handle string content for user messages', () => {
      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: 'Hello, world!',
        },
      ];

      const result = convertToOpenAIFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(result[0].content).toBe('Hello, world!');
    });

    it('should handle content blocks with images for user messages', () => {
      const imageContent: ContentBlock[] = [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
        },
      ];

      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: imageContent,
        },
      ];

      const result = convertToOpenAIFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      expect(Array.isArray(result[0].content)).toBe(true);

      const content = result[0].content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(2);

      // Check text block
      expect(content[0]).toEqual({ type: 'text', text: 'What is in this image?' });

      // Check image block - OpenAI uses image_url with data URL
      expect(content[1]).toHaveProperty('type', 'image_url');
      expect(content[1]).toHaveProperty('image_url');
      const imageUrl = content[1].image_url as Record<string, unknown>;
      expect(imageUrl.url).toContain('data:image/png;base64,');
    });

    it('should return string content when no images present', () => {
      const textOnlyContent: ContentBlock[] = [{ type: 'text', text: 'Just text, no images.' }];

      const messages: ProviderMessage[] = [
        {
          role: 'user',
          content: textOnlyContent,
        },
      ];

      const result = convertToOpenAIFormat(messages);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
      // Should be flattened to string since no images
      expect(result[0].content).toBe('Just text, no images.');
    });
  });
});
