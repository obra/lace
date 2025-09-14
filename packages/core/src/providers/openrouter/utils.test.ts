import { describe, it, expect } from 'vitest';
import { extractProvider, convertPricing, hasCapability } from './utils';

describe('OpenRouter Utils', () => {
  describe('extractProvider', () => {
    it('should extract provider from model ID', () => {
      expect(extractProvider('openai/gpt-4o')).toBe('openai');
      expect(extractProvider('anthropic/claude-3')).toBe('anthropic');
      expect(extractProvider('meta-llama/llama-3')).toBe('meta-llama');
    });

    it('should handle IDs without slash', () => {
      expect(extractProvider('gpt-4')).toBe('unknown');
    });

    it('should handle complex provider names', () => {
      expect(extractProvider('google/gemini-pro-1.5')).toBe('google');
      expect(extractProvider('mistralai/mixtral-8x7b')).toBe('mistralai');
      expect(extractProvider('nvidia/nemotron-4-340b')).toBe('nvidia');
    });

    it('should handle empty and invalid inputs', () => {
      expect(extractProvider('')).toBe('unknown');
      expect(extractProvider('/')).toBe('');
      expect(extractProvider('/model-name')).toBe('');
    });
  });

  describe('convertPricing', () => {
    it('should convert string pricing to cost per million', () => {
      expect(convertPricing('0.0000025')).toBe(2.5);
      expect(convertPricing('0.00001')).toBe(10);
    });

    it('should handle zero pricing', () => {
      expect(convertPricing('0')).toBe(0);
      expect(convertPricing('0.0')).toBe(0);
    });

    it('should handle very small values', () => {
      expect(convertPricing('0.000000001')).toBe(0.001);
    });

    it('should handle large values', () => {
      expect(convertPricing('0.1')).toBe(100000);
    });

    it('should handle scientific notation', () => {
      expect(convertPricing('2.5e-6')).toBe(2.5);
    });
  });

  describe('hasCapability', () => {
    it('should check if model has capability', () => {
      const params = ['tools', 'temperature', 'top_p'];
      expect(hasCapability(params, 'tools')).toBe(true);
      expect(hasCapability(params, 'temperature')).toBe(true);
      expect(hasCapability(params, 'vision')).toBe(false);
    });

    it('should handle undefined supported_parameters', () => {
      expect(hasCapability(undefined, 'tools')).toBe(false);
    });

    it('should handle empty supported_parameters', () => {
      expect(hasCapability([], 'tools')).toBe(false);
    });

    it('should be case sensitive', () => {
      const params = ['Tools', 'TEMPERATURE'];
      expect(hasCapability(params, 'tools')).toBe(false);
      expect(hasCapability(params, 'Tools')).toBe(true);
    });
  });
});
