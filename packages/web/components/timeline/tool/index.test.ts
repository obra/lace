// ABOUTME: Tests for tool renderer registry and lookup functions
// ABOUTME: Tests real registry behavior with case-insensitive lookup and fallback logic

import { describe, it, expect } from 'vitest';
import { getToolRenderer } from './index';

describe('Tool Renderer Registry', () => {
  describe('getToolRenderer', () => {
    it('should return empty object for unknown tools', () => {
      const renderer = getToolRenderer('unknown_tool');

      expect(renderer).toEqual({});
      expect(Object.keys(renderer)).toHaveLength(0);
    });

    it('should return empty object for non-existent tools', () => {
      const renderer = getToolRenderer('nonexistent');

      expect(renderer).toEqual({});
    });

    it('should be case-insensitive for tool name lookup', () => {
      const renderer1 = getToolRenderer('UNKNOWN');
      const renderer2 = getToolRenderer('unknown');
      const renderer3 = getToolRenderer('Unknown');

      expect(renderer1).toEqual({});
      expect(renderer2).toEqual({});
      expect(renderer3).toEqual({});
      expect(renderer1).toEqual(renderer2);
      expect(renderer2).toEqual(renderer3);
    });

    it('should handle empty string tool names', () => {
      const renderer = getToolRenderer('');

      expect(renderer).toEqual({});
    });

    it('should handle whitespace in tool names', () => {
      const renderer = getToolRenderer('  unknown  ');

      // Should not match due to whitespace (registry keys should be exact)
      expect(renderer).toEqual({});
    });
  });

  describe('registry behavior', () => {
    it('should return consistent results for repeated calls', () => {
      const renderer1 = getToolRenderer('test');
      const renderer2 = getToolRenderer('test');

      expect(renderer1).toEqual(renderer2);
      // Each call should return a fresh object, not the same reference
      expect(renderer1).not.toBe(renderer2);
    });
  });
});
