// ABOUTME: Tests for the updated NewAgentSpec format with flexible model specifications
// ABOUTME: Tests parsing and creation of agent specs with fast/smart/explicit model specs

import { describe, it, expect } from 'vitest';
import { isNewAgentSpec, parseNewAgentSpec, createNewAgentSpec, asNewAgentSpec } from './types';

describe('NewAgentSpec v2', () => {
  describe('isNewAgentSpec', () => {
    it('accepts valid formats', () => {
      // Just persona
      expect(isNewAgentSpec('new:lace')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent')).toBe(true);

      // With speed preference
      expect(isNewAgentSpec('new:lace;fast')).toBe(true);
      expect(isNewAgentSpec('new:lace;smart')).toBe(true);

      // With explicit model
      expect(isNewAgentSpec('new:lace;anthropic:claude-3')).toBe(true);
      expect(isNewAgentSpec('new:helper;openai:gpt-4')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isNewAgentSpec('lace')).toBe(false);
      expect(isNewAgentSpec('new:')).toBe(false);
      expect(isNewAgentSpec('new')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
    });
  });

  describe('parseNewAgentSpec', () => {
    it('parses persona-only format', () => {
      const spec = asNewAgentSpec('new:lace');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBeUndefined();
    });

    it('parses with fast preference', () => {
      const spec = asNewAgentSpec('new:coding-agent;fast');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('coding-agent');
      expect(parsed.modelSpec).toBe('fast');
    });

    it('parses with smart preference', () => {
      const spec = asNewAgentSpec('new:helper;smart');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('helper');
      expect(parsed.modelSpec).toBe('smart');
    });

    it('parses with explicit model', () => {
      const spec = asNewAgentSpec('new:lace;anthropic-prod:claude-3-haiku');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBe('anthropic-prod:claude-3-haiku');
    });

    it('handles complex persona names', () => {
      const spec = asNewAgentSpec('new:my-custom-agent_v2');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('my-custom-agent_v2');
    });

    it('handles models with multiple colons', () => {
      const spec = asNewAgentSpec('new:lace;ollama:qwen3:32b');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.persona).toBe('lace');
      expect(parsed.modelSpec).toBe('ollama:qwen3:32b');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('invalid');
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
    });
  });

  describe('createNewAgentSpec', () => {
    it('creates persona-only spec', () => {
      const spec = createNewAgentSpec('lace');
      expect(spec).toBe('new:lace');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('creates spec with model', () => {
      const spec = createNewAgentSpec('lace', 'fast');
      expect(spec).toBe('new:lace;fast');

      const spec2 = createNewAgentSpec('helper', 'anthropic:claude');
      expect(spec2).toBe('new:helper;anthropic:claude');
    });

    it('round-trips correctly', () => {
      const specs = [
        { persona: 'lace', modelSpec: undefined },
        { persona: 'helper', modelSpec: 'fast' },
        { persona: 'coder', modelSpec: 'smart' },
        { persona: 'analyst', modelSpec: 'prod:gpt-4' },
      ];

      for (const original of specs) {
        const spec = createNewAgentSpec(original.persona, original.modelSpec);
        const parsed = parseNewAgentSpec(spec);

        expect(parsed.persona).toBe(original.persona);
        expect(parsed.modelSpec).toBe(original.modelSpec);
      }
    });
  });

  describe('integration scenarios', () => {
    it('supports all expected formats for delegation', () => {
      // Scenario 1: Use session defaults
      const spec1 = createNewAgentSpec('lace');
      const parsed1 = parseNewAgentSpec(spec1);
      expect(parsed1.persona).toBe('lace');
      expect(parsed1.modelSpec).toBeUndefined();

      // Scenario 2: Use fast model
      const spec2 = createNewAgentSpec('lace', 'fast');
      const parsed2 = parseNewAgentSpec(spec2);
      expect(parsed2.persona).toBe('lace');
      expect(parsed2.modelSpec).toBe('fast');

      // Scenario 3: Use smart model
      const spec3 = createNewAgentSpec('lace', 'smart');
      const parsed3 = parseNewAgentSpec(spec3);
      expect(parsed3.persona).toBe('lace');
      expect(parsed3.modelSpec).toBe('smart');

      // Scenario 4: Explicit model
      const spec4 = createNewAgentSpec('lace', 'my-instance:my-model');
      const parsed4 = parseNewAgentSpec(spec4);
      expect(parsed4.persona).toBe('lace');
      expect(parsed4.modelSpec).toBe('my-instance:my-model');
    });
  });
});
