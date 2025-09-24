// ABOUTME: Comprehensive tests for NewAgentSpec format validation and parsing
// ABOUTME: Tests all functionality: validation, parsing, creation, and integration scenarios

import { describe, it, expect } from 'vitest';
import { isNewAgentSpec, parseNewAgentSpec, createNewAgentSpec, asNewAgentSpec } from './types';

describe('NewAgentSpec', () => {
  describe('Format Validation', () => {
    it('accepts valid formats', () => {
      // Persona only (use session defaults)
      expect(isNewAgentSpec('new:lace')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent')).toBe(true);
      expect(isNewAgentSpec('new:my-custom-agent_v2')).toBe(true);

      // Speed preferences
      expect(isNewAgentSpec('new:lace;fast')).toBe(true);
      expect(isNewAgentSpec('new:lace;smart')).toBe(true);

      // Explicit provider:model
      expect(isNewAgentSpec('new:lace;anthropic:claude-3-sonnet')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent;openai:gpt-4')).toBe(true);
      expect(isNewAgentSpec('new:helper;ollama:qwen3:32b')).toBe(true);
    });

    it('rejects invalid formats', () => {
      // Missing new: prefix
      expect(isNewAgentSpec('lace')).toBe(false);
      expect(isNewAgentSpec('anthropic:claude-3-sonnet')).toBe(false);

      // Empty persona
      expect(isNewAgentSpec('new:')).toBe(false);

      // Missing colon
      expect(isNewAgentSpec('new')).toBe(false);

      // Old format with forward slash (should be rejected)
      expect(isNewAgentSpec('new:anthropic/claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:openai/gpt-4')).toBe(false);

      // Empty string
      expect(isNewAgentSpec('')).toBe(false);
    });
  });

  describe('Parsing', () => {
    it('parses persona-only format', () => {
      const spec = asNewAgentSpec('new:lace');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBeUndefined();
    });

    it('parses speed preference format', () => {
      const fastSpec = asNewAgentSpec('new:helper;fast');
      const fastParsed = parseNewAgentSpec(fastSpec);
      expect(fastParsed.persona).toBe('helper');
      expect(fastParsed.modelSpec).toBe('fast');

      const smartSpec = asNewAgentSpec('new:analyst;smart');
      const smartParsed = parseNewAgentSpec(smartSpec);
      expect(smartParsed.persona).toBe('analyst');
      expect(smartParsed.modelSpec).toBe('smart');
    });

    it('parses explicit provider:model format', () => {
      const spec = asNewAgentSpec('new:coding-agent;anthropic:claude-3-sonnet');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.modelSpec).toBe('anthropic:claude-3-sonnet');
    });

    it('handles complex model names with multiple colons', () => {
      const spec = asNewAgentSpec('new:lace;ollama:qwen3:32b');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBe('ollama:qwen3:32b');
    });

    it('handles special characters in persona names', () => {
      const spec = asNewAgentSpec('new:my-custom-agent_v2;provider:model');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('my-custom-agent_v2');
      expect(parsed.modelSpec).toBe('provider:model');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('invalid-format');
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
      expect(() => parseNewAgentSpec(spec)).toThrow('Expected format: new:persona[;modelSpec]');
    });
  });

  describe('Creation', () => {
    it('creates persona-only specs', () => {
      const spec = createNewAgentSpec('lace');
      expect(spec).toBe('new:lace');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('creates specs with speed preferences', () => {
      const fastSpec = createNewAgentSpec('lace', 'fast');
      expect(fastSpec).toBe('new:lace;fast');
      expect(isNewAgentSpec(fastSpec)).toBe(true);

      const smartSpec = createNewAgentSpec('helper', 'smart');
      expect(smartSpec).toBe('new:helper;smart');
      expect(isNewAgentSpec(smartSpec)).toBe(true);
    });

    it('creates specs with explicit provider:model', () => {
      const spec = createNewAgentSpec('coder', 'anthropic:claude-3-sonnet');
      expect(spec).toBe('new:coder;anthropic:claude-3-sonnet');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('round-trips correctly for all formats', () => {
      const testCases = [
        { persona: 'lace', modelSpec: undefined },
        { persona: 'helper', modelSpec: 'fast' },
        { persona: 'analyst', modelSpec: 'smart' },
        { persona: 'coder', modelSpec: 'anthropic:claude-3-sonnet' },
        { persona: 'researcher', modelSpec: 'openai:gpt-4-turbo' },
        { persona: 'data-processor', modelSpec: 'ollama:qwen3:32b' },
      ];

      for (const original of testCases) {
        const spec = createNewAgentSpec(original.persona, original.modelSpec);
        const parsed = parseNewAgentSpec(spec);

        expect(parsed.persona).toBe(original.persona);
        expect(parsed.modelSpec).toBe(original.modelSpec);
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('supports all expected delegation patterns', () => {
      // Use session defaults
      const defaultSpec = createNewAgentSpec('lace');
      expect(isNewAgentSpec(defaultSpec)).toBe(true);
      expect(parseNewAgentSpec(defaultSpec).modelSpec).toBeUndefined();

      // Use fast model
      const fastSpec = createNewAgentSpec('lace', 'fast');
      expect(isNewAgentSpec(fastSpec)).toBe(true);
      expect(parseNewAgentSpec(fastSpec).modelSpec).toBe('fast');

      // Use smart model
      const smartSpec = createNewAgentSpec('lace', 'smart');
      expect(isNewAgentSpec(smartSpec)).toBe(true);
      expect(parseNewAgentSpec(smartSpec).modelSpec).toBe('smart');

      // Use explicit model
      const explicitSpec = createNewAgentSpec('lace', 'custom:model-name');
      expect(isNewAgentSpec(explicitSpec)).toBe(true);
      expect(parseNewAgentSpec(explicitSpec).modelSpec).toBe('custom:model-name');
    });

    it('supports common persona names', () => {
      const personas = ['lace', 'coding-agent', 'helper-agent', 'data-analyst', 'devops-assistant'];

      for (const persona of personas) {
        const spec = createNewAgentSpec(persona, 'anthropic:claude-3-sonnet');
        expect(isNewAgentSpec(spec)).toBe(true);

        const parsed = parseNewAgentSpec(spec);
        expect(parsed.persona).toBe(persona);
        expect(parsed.modelSpec).toBe('anthropic:claude-3-sonnet');
      }
    });

    it('supports common provider:model combinations', () => {
      const combinations = [
        'anthropic:claude-3-sonnet',
        'anthropic:claude-3-haiku',
        'openai:gpt-4',
        'openai:gpt-4-turbo',
        'ollama:llama2',
        'lmstudio:custom-model-v1.0',
        'ollama:qwen3:32b', // Model with multiple colons
      ];

      for (const modelSpec of combinations) {
        const spec = createNewAgentSpec('lace', modelSpec);
        expect(isNewAgentSpec(spec)).toBe(true);

        const parsed = parseNewAgentSpec(spec);
        expect(parsed.persona).toBe('lace');
        expect(parsed.modelSpec).toBe(modelSpec);
      }
    });
  });

  describe('asNewAgentSpec (Unsafe Cast)', () => {
    it('casts valid format without validation', () => {
      const result = asNewAgentSpec('new:lace;anthropic:claude-3-sonnet');
      expect(result).toBe('new:lace;anthropic:claude-3-sonnet');
    });

    it('casts invalid format without validation (unsafe)', () => {
      const result = asNewAgentSpec('invalid-format');
      expect(result).toBe('invalid-format');
    });
  });
});
