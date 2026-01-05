// ABOUTME: Tests for provider utility functions
// ABOUTME: Tests model string parsing and validation logic

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseProviderModel, resolveModelSpec } from './provider-utils';
import { UserSettingsManager } from '@lace/core/config/user-settings';

vi.mock('@lace/core/config/user-settings');

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

  describe('resolveModelSpec', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should use context defaults when no spec provided', () => {
      const context = {
        providerInstanceId: 'anthropic-prod',
        modelId: 'claude-3-5-haiku-20241022',
      };

      const result = resolveModelSpec(undefined, context);

      expect(result).toEqual({
        providerInstanceId: 'anthropic-prod',
        modelId: 'claude-3-5-haiku-20241022',
      });
    });

    it('should throw when no spec and no context', () => {
      expect(() => resolveModelSpec()).toThrow('No model spec provided');
    });

    it('should throw when no spec and incomplete context', () => {
      expect(() => resolveModelSpec(undefined, { providerInstanceId: 'test' })).toThrow(
        'No model spec provided'
      );
      expect(() => resolveModelSpec(undefined, { modelId: 'test' })).toThrow(
        'No model spec provided'
      );
    });

    it('should resolve fast model from user settings', () => {
      vi.mocked(UserSettingsManager.getDefaultModel).mockReturnValue('instance-fast:model-fast');

      const result = resolveModelSpec('fast');

      expect(UserSettingsManager.getDefaultModel).toHaveBeenCalledWith('fast');
      expect(result).toEqual({
        providerInstanceId: 'instance-fast',
        modelId: 'model-fast',
      });
    });

    it('should resolve smart model from user settings', () => {
      vi.mocked(UserSettingsManager.getDefaultModel).mockReturnValue('instance-smart:model-smart');

      const result = resolveModelSpec('smart');

      expect(UserSettingsManager.getDefaultModel).toHaveBeenCalledWith('smart');
      expect(result).toEqual({
        providerInstanceId: 'instance-smart',
        modelId: 'model-smart',
      });
    });

    it('should parse direct instance:model specification', () => {
      const result = resolveModelSpec('my-instance:my-model');

      expect(result).toEqual({
        providerInstanceId: 'my-instance',
        modelId: 'my-model',
      });
    });

    it('should parse complex model specifications with multiple colons', () => {
      const result = resolveModelSpec('ollama:qwen3:32b');

      expect(result).toEqual({
        providerInstanceId: 'ollama',
        modelId: 'qwen3:32b',
      });
    });

    it('should throw for invalid spec format', () => {
      expect(() => resolveModelSpec('invalid')).toThrow('Invalid model spec');
    });

    it('should throw for empty string spec', () => {
      expect(() => resolveModelSpec('')).toThrow('Invalid model spec');
    });
  });
});
