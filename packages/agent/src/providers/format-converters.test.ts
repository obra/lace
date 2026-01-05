// ABOUTME: Tests for format conversion functions
// ABOUTME: Tests Gemini tool ID encoding/decoding and format conversion

import { describe, it, expect } from 'vitest';
import { convertToGeminiFormat } from './format-converters';
import { ProviderMessage } from './base-provider';

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
  });
});
