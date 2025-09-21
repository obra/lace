// ABOUTME: Tests for NewAgentSpec format validation and parsing
// ABOUTME: Comprehensive tests for the flexible model specification system

import { describe, it, expect } from 'vitest';
import { isNewAgentSpec, parseNewAgentSpec, createNewAgentSpec, asNewAgentSpec } from './types';

describe('NewAgentSpec', () => {
  describe('isNewAgentSpec', () => {
    it('accepts valid formats', () => {
      // Persona only
      expect(isNewAgentSpec('new:lace')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent')).toBe(true);

      // Speed preferences
      expect(isNewAgentSpec('new:lace;fast')).toBe(true);
      expect(isNewAgentSpec('new:lace;smart')).toBe(true);

      // Explicit provider:model
      expect(isNewAgentSpec('new:lace;anthropic:claude-3-sonnet')).toBe(true);
      expect(isNewAgentSpec('new:coding-agent;openai:gpt-4')).toBe(true);
    });

    it('rejects invalid formats', () => {
      expect(isNewAgentSpec('anthropic:claude-3-sonnet')).toBe(false);
      expect(isNewAgentSpec('new:')).toBe(false);
      expect(isNewAgentSpec('')).toBe(false);
      expect(isNewAgentSpec('new')).toBe(false);
    });
  });

  describe('parseNewAgentSpec', () => {
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

    it('handles complex model names', () => {
      const spec = asNewAgentSpec('new:lace;openai:gpt-4-turbo-preview');
      const parsed = parseNewAgentSpec(spec);

      expect(parsed.modelSpec).toBe('openai:gpt-4-turbo-preview');
    });

    it('throws on invalid format', () => {
      const spec = asNewAgentSpec('invalid-format');
      expect(() => parseNewAgentSpec(spec)).toThrow('Invalid NewAgentSpec format');
    });
  });

  describe('createNewAgentSpec', () => {
    it('creates persona-only specs', () => {
      const spec = createNewAgentSpec('lace');
      expect(spec).toBe('new:lace');
      expect(isNewAgentSpec(spec)).toBe(true);
    });

    it('creates specs with model specifications', () => {
      const spec1 = createNewAgentSpec('lace', 'fast');
      expect(spec1).toBe('new:lace;fast');

      const spec2 = createNewAgentSpec('helper', 'anthropic:claude-3-sonnet');
      expect(spec2).toBe('new:helper;anthropic:claude-3-sonnet');
    });

    it('round-trips correctly', () => {
      const specs = [
        { persona: 'lace', modelSpec: undefined },
        { persona: 'helper', modelSpec: 'fast' },
        { persona: 'analyst', modelSpec: 'smart' },
        { persona: 'coder', modelSpec: 'anthropic:claude-3-sonnet' },
      ];

      for (const original of specs) {
        const spec = createNewAgentSpec(original.persona, original.modelSpec);
        const parsed = parseNewAgentSpec(spec);

        expect(parsed.persona).toBe(original.persona);
        expect(parsed.modelSpec).toBe(original.modelSpec);
      }
    });
  });
});
