// ABOUTME: Tests for session and agent configuration with validation and inheritance
// ABOUTME: Tests configuration schemas, presets, and hierarchical configuration merging

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SessionConfiguration,
  ConfigurationPresetManager,
  ConfigurationValidator,
  SessionConfigurationSchema,
  AgentConfigurationSchema,
} from '~/sessions/session-config';

describe('Session configuration', () => {
  let presetManager: ConfigurationPresetManager;

  beforeEach(() => {
    presetManager = new ConfigurationPresetManager();
  });

  describe('Configuration schemas', () => {
    it('should validate valid session configuration', () => {
      const config = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000,
        temperature: 0.7,
        systemPrompt: 'You are a helpful assistant.',
        tools: ['file-read', 'bash'],
        toolPolicies: {
          bash: 'require-approval',
        },
      };

      const result = SessionConfigurationSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBe('anthropic');
        expect(result.data.model).toBe('claude-3-sonnet');
        expect(result.data.maxTokens).toBe(4000);
        expect(result.data.temperature).toBe(0.7);
      }
    });

    it('should reject invalid session configuration', () => {
      const config = {
        provider: 'invalid-provider',
        maxTokens: -100,
        temperature: 3.0,
      };

      const result = SessionConfigurationSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should validate valid agent configuration', () => {
      const config = {
        role: 'code-reviewer',
        provider: 'anthropic',
        model: 'claude-3-haiku',
        temperature: 0.1,
        capabilities: ['code-analysis', 'security-review'],
        restrictions: ['no-file-write'],
        memorySize: 1000,
      };

      const result = AgentConfigurationSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('code-reviewer');
        expect(result.data.capabilities).toEqual(['code-analysis', 'security-review']);
        expect(result.data.restrictions).toEqual(['no-file-write']);
      }
    });

    it('should reject invalid agent configuration', () => {
      const config = {
        memorySize: -50,
        conversationHistory: 0,
      };

      const result = AgentConfigurationSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('Configuration validator', () => {
    it('should validate session configuration', () => {
      const config = {
        provider: 'openai',
        model: 'gpt-4',
        maxTokens: 8000,
        temperature: 0.5,
      };

      const validated = ConfigurationValidator.validateSessionConfiguration(config);
      expect(validated.provider).toBe('openai');
      expect(validated.model).toBe('gpt-4');
      expect(validated.maxTokens).toBe(8000);
      expect(validated.temperature).toBe(0.5);
    });

    it('should throw error for invalid session configuration', () => {
      const config = {
        maxTokens: -100,
        temperature: 5.0,
      };

      expect(() => {
        ConfigurationValidator.validateSessionConfiguration(config);
      }).toThrow('Configuration validation failed');
    });

    it('should merge configurations correctly', () => {
      const base: SessionConfiguration = {
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        maxTokens: 4000,
        toolPolicies: {
          'file-read': 'allow',
          bash: 'require-approval',
        },
        environmentVariables: {
          BASE_VAR: 'base-value',
          SHARED_VAR: 'base-shared',
        },
      };

      const override: Partial<SessionConfiguration> = {
        model: 'claude-3-haiku',
        temperature: 0.8,
        toolPolicies: {
          bash: 'allow',
          'file-write': 'require-approval',
        },
        environmentVariables: {
          OVERRIDE_VAR: 'override-value',
          SHARED_VAR: 'override-shared',
        },
      };

      const merged = ConfigurationValidator.mergeConfigurations(base, override);

      expect(merged.provider).toBe('anthropic'); // From base
      expect(merged.model).toBe('claude-3-haiku'); // Overridden
      expect(merged.maxTokens).toBe(4000); // From base
      expect(merged.temperature).toBe(0.8); // Overridden
      expect(merged.toolPolicies).toEqual({
        'file-read': 'allow',
        bash: 'allow', // Overridden
        'file-write': 'require-approval', // Added
      });
      expect(merged.environmentVariables).toEqual({
        BASE_VAR: 'base-value',
        SHARED_VAR: 'override-shared', // Overridden
        OVERRIDE_VAR: 'override-value', // Added
      });
    });
  });

  describe('Configuration presets', () => {
    it('should save and retrieve configuration presets', () => {
      const presetConfig = {
        model: 'claude-3-sonnet',
        temperature: 0.2,
        maxTokens: 8000,
        systemPrompt: 'You are a senior software engineer conducting code reviews.',
        tools: ['file-read', 'file-write', 'bash'],
        toolPolicies: {
          'file-write': 'require-approval' as const,
          bash: 'require-approval' as const,
        },
      };

      presetManager.savePreset('code-review', presetConfig, {
        name: 'Code Review',
        description: 'Configuration optimized for code review tasks',
      });

      const preset = presetManager.getPreset('code-review');
      expect(preset).toBeDefined();
      expect(preset?.name).toBe('Code Review');
      expect(preset?.description).toBe('Configuration optimized for code review tasks');
      expect(preset?.configuration.model).toBe('claude-3-sonnet');
      expect(preset?.configuration.temperature).toBe(0.2);
      expect(preset?.configuration.tools).toEqual(['file-read', 'file-write', 'bash']);
    });

    it('should list all presets', () => {
      presetManager.savePreset('preset1', { model: 'claude-3-haiku' }, { name: 'Preset 1' });
      presetManager.savePreset('preset2', { model: 'gpt-4' }, { name: 'Preset 2' });

      const presets = presetManager.getPresets();
      expect(presets).toHaveLength(2);
      expect(presets.map((p) => p.id)).toContain('preset1');
      expect(presets.map((p) => p.id)).toContain('preset2');
    });

    it('should manage default presets', () => {
      presetManager.savePreset(
        'default',
        { model: 'claude-3-sonnet' },
        {
          name: 'Default',
          isDefault: true,
        }
      );
      presetManager.savePreset('custom', { model: 'claude-3-haiku' }, { name: 'Custom' });

      const defaultPreset = presetManager.getDefaultPreset();
      expect(defaultPreset).toBeDefined();
      expect(defaultPreset?.id).toBe('default');
    });

    it('should delete presets', () => {
      presetManager.savePreset('temp', { model: 'claude-3-haiku' }, { name: 'Temporary' });

      expect(presetManager.getPreset('temp')).toBeDefined();

      const deleted = presetManager.deletePreset('temp');
      expect(deleted).toBe(true);
      expect(presetManager.getPreset('temp')).toBeUndefined();
    });

    it('should validate preset configuration', () => {
      const invalidConfig = {
        maxTokens: -100,
        temperature: 5.0,
      };

      expect(() => {
        presetManager.savePreset('invalid', invalidConfig, { name: 'Invalid' });
      }).toThrow('Configuration validation failed');
    });
  });
});
