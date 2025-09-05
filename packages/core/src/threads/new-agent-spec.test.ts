import { describe, it, expect } from 'vitest';
import { 
  isNewAgentSpec, 
  parseNewAgentSpec, 
  createNewAgentSpec,
  asNewAgentSpec 
} from './types';

describe('NewAgentSpec', () => {
  describe('isNewAgentSpec', () => {
    it('accepts valid new format', () => {
      expect(isNewAgentSpec('new:lace:anthropic/claude-3-sonnet')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent:openai/gpt-4')).toBe(true);
      expect(isNewAgentSpec('new:helper:ollama/llama2')).toBe(true);
    });

    it('rejects old format', () => {
      expect(isNewAgentSpec('new:anthropic/claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:openai/gpt-4')).toBe(false);
    });

    it('rejects invalid formats', () => {
      expect(isNewAgentSpec('anthropic/claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:lace')).toBe(false);
      expect(isNewAgentSpec('new:lace:anthropic')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
    });

    it('handles special characters in names', () => {
      expect(isNewAgentSpec('new:my-custom-agent:provider-x/model-v2.1')).toBe(true);
      expect(isNewAgentSpec('new:agent_v2:my-provider/model_name')).toBe(true);
    });

    it('rejects malformed formats', () => {
      expect(isNewAgentSpec('new::anthropic/claude-3-sonnet')).toBe(false); // Empty persona
      expect(isNewAgentSpec('new:persona::model')).toBe(false); // Empty provider
      expect(isNewAgentSpec('new:persona:provider/')).toBe(false); // Empty model
    });
  });

  describe('parseNewAgentSpec', () => {
    it('parses valid specs correctly', () => {
      const spec = asNewAgentSpec('new:coding-agent:anthropic/claude-3-sonnet');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.provider).toBe('anthropic'); 
      expect(parsed.model).toBe('claude-3-sonnet');
    });

    it('handles complex model names', () => {
      const spec = asNewAgentSpec('new:lace:openai/gpt-4-turbo-preview');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.model).toBe('gpt-4-turbo-preview');
    });

    it('handles special characters in all parts', () => {
      const spec = asNewAgentSpec('new:my-custom-agent:provider-x/model_v2.1-beta');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.persona).toBe('my-custom-agent');
      expect(parsed.provider).toBe('provider-x');
      expect(parsed.model).toBe('model_v2.1-beta');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('new:anthropic/claude-3-sonnet'); // Old format
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
      expect(() => parseNewAgentSpec(spec)).toThrow('Expected format: new:persona:provider/model');
    });

    it('throws descriptive errors for various invalid formats', () => {
      const invalidSpecs = [
        'invalid-format',
        'new:only-persona',
        'new:persona:no-model',
        'new::empty-persona:provider/model',
      ];

      for (const invalidSpec of invalidSpecs) {
        expect(() => parseNewAgentSpec(asNewAgentSpec(invalidSpec))).toThrow(/Invalid NewAgentSpec format/);
      }
    });
  });

  describe('createNewAgentSpec', () => {
    it('creates valid specs', () => {
      const spec = createNewAgentSpec('lace', 'anthropic', 'claude-3-sonnet');
      expect(spec).toBe('new:lace:anthropic/claude-3-sonnet');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('handles special characters in names', () => {
      const spec = createNewAgentSpec('my-custom-agent', 'provider-x', 'model-v2.1');
      expect(spec).toBe('new:my-custom-agent:provider-x/model-v2.1');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('creates parsable specs', () => {
      const spec = createNewAgentSpec('helper-agent', 'openai', 'gpt-4-turbo');
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.persona).toBe('helper-agent');
      expect(parsed.provider).toBe('openai');
      expect(parsed.model).toBe('gpt-4-turbo');
    });

    it('creates specs that round-trip correctly', () => {
      const originalPersona = 'coding-assistant';
      const originalProvider = 'anthropic';
      const originalModel = 'claude-3-sonnet';
      
      const spec = createNewAgentSpec(originalPersona, originalProvider, originalModel);
      const parsed = parseNewAgentSpec(spec);
      
      expect(parsed.persona).toBe(originalPersona);
      expect(parsed.provider).toBe(originalProvider);
      expect(parsed.model).toBe(originalModel);
    });
  });

  describe('asNewAgentSpec', () => {
    it('casts valid format without validation', () => {
      const result = asNewAgentSpec('new:lace:anthropic/claude-3-sonnet');
      expect(result).toBe('new:lace:anthropic/claude-3-sonnet');
    });

    it('casts invalid format without validation (unsafe)', () => {
      const result = asNewAgentSpec('invalid-format');
      expect(result).toBe('invalid-format');
    });
  });

  describe('integration with real use cases', () => {
    it('supports common persona names', () => {
      const personas = ['lace', 'coding-agent', 'helper-agent', 'data-analyst', 'devops-assistant'];
      
      for (const persona of personas) {
        const spec = createNewAgentSpec(persona, 'anthropic', 'claude-3-sonnet');
        expect(isNewAgentSpec(spec)).toBe(true);
        
        const parsed = parseNewAgentSpec(spec);
        expect(parsed.persona).toBe(persona);
      }
    });

    it('supports common provider/model combinations', () => {
      const combinations = [
        { provider: 'anthropic', model: 'claude-3-sonnet' },
        { provider: 'anthropic', model: 'claude-3-haiku' },
        { provider: 'openai', model: 'gpt-4' },
        { provider: 'openai', model: 'gpt-4-turbo' },
        { provider: 'ollama', model: 'llama2' },
        { provider: 'lmstudio', model: 'custom-model-v1.0' },
      ];

      for (const { provider, model } of combinations) {
        const spec = createNewAgentSpec('lace', provider, model);
        expect(isNewAgentSpec(spec)).toBe(true);
        
        const parsed = parseNewAgentSpec(spec);
        expect(parsed.provider).toBe(provider);
        expect(parsed.model).toBe(model);
      }
    });
  });

  describe('backward compatibility awareness', () => {
    it('clearly rejects old format strings', () => {
      const oldFormatExamples = [
        'new:anthropic/claude-3-sonnet',
        'new:openai/gpt-4',
        'new:ollama/llama2',
      ];

      for (const oldFormat of oldFormatExamples) {
        expect(isNewAgentSpec(oldFormat)).toBe(false);
      }
    });

    it('provides clear error messages for migration', () => {
      const oldFormat = asNewAgentSpec('new:anthropic/claude-3-sonnet');
      
      expect(() => parseNewAgentSpec(oldFormat)).toThrow(
        'Invalid NewAgentSpec format: new:anthropic/claude-3-sonnet. Expected format: new:persona:provider/model'
      );
    });
  });
});