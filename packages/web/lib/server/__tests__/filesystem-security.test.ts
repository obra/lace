// ABOUTME: Tests for filesystem security utilities
// ABOUTME: Validates isPathInsideHome function which prevents directory traversal attacks

import { describe, it, expect } from 'vitest';
import { sep } from 'path';
import { isPathInsideHome } from '@lace/web/lib/server/filesystem-security';

describe('isPathInsideHome', () => {
  describe('exact home directory match', () => {
    it('returns true when path equals home directory exactly', () => {
      expect(isPathInsideHome('/Users/alice', '/Users/alice')).toBe(true);
    });

    it('returns true when both home and path have trailing separator', () => {
      expect(isPathInsideHome(`/Users/alice${sep}`, `/Users/alice${sep}`)).toBe(true);
    });
  });

  describe('subdirectories of home', () => {
    it('returns true for direct subdirectory of home', () => {
      expect(isPathInsideHome('/Users/alice/Documents', '/Users/alice')).toBe(true);
    });

    it('returns true for deeply nested subdirectory of home', () => {
      expect(isPathInsideHome('/Users/alice/Documents/Projects/lace/src', '/Users/alice')).toBe(
        true
      );
    });

    it('returns true when home directory ends with separator', () => {
      expect(isPathInsideHome('/Users/alice/Documents', `/Users/alice${sep}`)).toBe(true);
    });
  });

  describe('paths outside home (should return false)', () => {
    it('returns false for completely different path', () => {
      expect(isPathInsideHome('/var/log', '/Users/alice')).toBe(false);
    });

    it('returns false for sibling directory with shared prefix', () => {
      // This is the critical security case: /Users/alice-admin should NOT match /Users/alice
      expect(isPathInsideHome('/Users/alice-admin', '/Users/alice')).toBe(false);
    });

    it('returns false for parent directory of home', () => {
      expect(isPathInsideHome('/Users', '/Users/alice')).toBe(false);
    });

    it('returns false for partial prefix match without separator', () => {
      expect(isPathInsideHome('/Users/alicesmith/files', '/Users/alice')).toBe(false);
    });

    it('returns false when path starts with home but diverges after partial match', () => {
      expect(isPathInsideHome('/Users/alice2/Documents', '/Users/alice')).toBe(false);
    });
  });

  describe('trailing separator edge cases', () => {
    it('handles path with trailing separator when home has none', () => {
      expect(isPathInsideHome(`/Users/alice/Documents${sep}`, '/Users/alice')).toBe(true);
    });

    it('handles home with trailing separator when path has none', () => {
      expect(isPathInsideHome('/Users/alice/Documents', `/Users/alice${sep}`)).toBe(true);
    });

    it('handles both with trailing separators', () => {
      expect(isPathInsideHome(`/Users/alice/Documents${sep}`, `/Users/alice${sep}`)).toBe(true);
    });
  });

  describe('root directory edge cases', () => {
    it('returns true when home is root and path is a subdirectory', () => {
      // When home is root ("/"), any absolute path should be inside
      expect(isPathInsideHome('/Users/alice', sep)).toBe(true);
    });

    it('returns true when home is root and path is root', () => {
      expect(isPathInsideHome(sep, sep)).toBe(true);
    });

    it('handles root with deeper path correctly', () => {
      expect(isPathInsideHome('/var/log/system.log', sep)).toBe(true);
    });
  });

  describe('Windows-style paths (on Windows)', () => {
    // These tests are conceptual - on Unix systems they may not apply,
    // but the function should work correctly on both platforms
    it('handles paths with consistent separators', () => {
      // Using path.sep ensures cross-platform compatibility
      const winStyleHome = `C:${sep}Users${sep}alice`;
      const winStylePath = `C:${sep}Users${sep}alice${sep}Documents`;
      expect(isPathInsideHome(winStylePath, winStyleHome)).toBe(true);
    });
  });

  describe('empty and edge inputs', () => {
    it('returns false for empty path', () => {
      expect(isPathInsideHome('', '/Users/alice')).toBe(false);
    });

    it('returns false for empty home', () => {
      expect(isPathInsideHome('/Users/alice', '')).toBe(false);
    });

    it('returns false when both are empty', () => {
      expect(isPathInsideHome('', '')).toBe(false);
    });
  });
});
