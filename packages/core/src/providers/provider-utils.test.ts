// ABOUTME: Tests for provider utility functions
// ABOUTME: Tests model string parsing and validation logic

import { describe, it, expect } from 'vitest';
import { parseProviderModel } from './provider-utils';

describe('Provider Utils', () => {
  describe('parseProviderModel', () => {
    it('should parse provider:model format correctly', () => {
      const result = parseProviderModel('anthropic:claude-sonnet-4-20250514');
      expect(result).toEqual({
        instanceId: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
      });
    });

    it('should parse openai models correctly', () => {
      const result = parseProviderModel('openai:gpt-4o');
      expect(result).toEqual({
        instanceId: 'openai',
        modelId: 'gpt-4o',
      });
    });

    it('should parse lmstudio models correctly', () => {
      const result = parseProviderModel('lmstudio:my-local-model');
      expect(result).toEqual({
        instanceId: 'lmstudio',
        modelId: 'my-local-model',
      });
    });

    it('should parse ollama models correctly', () => {
      const result = parseProviderModel('ollama:qwen3:32b');
      expect(result).toEqual({
        instanceId: 'ollama',
        modelId: 'qwen3:32b',
      });
    });

    it('should handle models with multiple colons', () => {
      const result = parseProviderModel('lmstudio:namespace/model:v1.0');
      expect(result).toEqual({
        instanceId: 'lmstudio',
        modelId: 'namespace/model:v1.0',
      });
    });

    it('should throw error for invalid format', () => {
      expect(() => parseProviderModel('invalid-format')).toThrow(
        'Invalid model format. Expected "provider:model"'
      );
    });

    it('should throw error for empty provider', () => {
      expect(() => parseProviderModel(':model-name')).toThrow(
        'Invalid model format. Expected "provider:model"'
      );
    });

    it('should throw error for empty model', () => {
      expect(() => parseProviderModel('provider:')).toThrow(
        'Invalid model format. Expected "provider:model"'
      );
    });

    it('should throw error for empty string', () => {
      expect(() => parseProviderModel('')).toThrow(
        'Invalid model format. Expected "provider:model"'
      );
    });
  });
});