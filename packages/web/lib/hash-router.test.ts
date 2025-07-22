// ABOUTME: Tests for hash-based routing utilities
// ABOUTME: Validates URL parsing, building, and state management for project/session/agent navigation

import { describe, it, expect } from 'vitest';
import { parseHash, buildHash, AppState } from './hash-router';

describe('Hash Router Utilities', () => {
  describe('parseHash', () => {
    it('should parse empty hash', () => {
      expect(parseHash('')).toEqual({});
      expect(parseHash('#')).toEqual({});
      expect(parseHash('#/')).toEqual({});
    });

    it('should parse project only', () => {
      expect(parseHash('#/project/abc123')).toEqual({
        project: 'abc123',
      });
    });

    it('should parse project and session', () => {
      expect(parseHash('#/project/abc123/session/def456')).toEqual({
        project: 'abc123',
        session: 'def456',
      });
    });

    it('should parse full hierarchy', () => {
      expect(parseHash('#/project/abc123/session/def456/agent/ghi789')).toEqual({
        project: 'abc123',
        session: 'def456',
        agent: 'ghi789',
      });
    });

    it('should handle malformed paths gracefully', () => {
      expect(parseHash('#/project')).toEqual({});
      expect(parseHash('#/project/abc/session')).toEqual({
        project: 'abc',
      });
      expect(parseHash('#/unknown/value')).toEqual({});
    });

    it('should handle hash without leading #', () => {
      expect(parseHash('/project/abc123/session/def456')).toEqual({
        project: 'abc123',
        session: 'def456',
      });
    });
  });

  describe('buildHash', () => {
    it('should build empty hash for empty state', () => {
      expect(buildHash({})).toBe('');
    });

    it('should build project only hash', () => {
      expect(buildHash({ project: 'abc123' })).toBe('#/project/abc123');
    });

    it('should build project and session hash', () => {
      expect(buildHash({ project: 'abc123', session: 'def456' })).toBe(
        '#/project/abc123/session/def456'
      );
    });

    it('should build full hierarchy hash', () => {
      expect(buildHash({ project: 'abc123', session: 'def456', agent: 'ghi789' })).toBe(
        '#/project/abc123/session/def456/agent/ghi789'
      );
    });

    it('should skip undefined values', () => {
      expect(buildHash({ project: 'abc123', session: undefined, agent: 'ghi789' })).toBe(
        '#/project/abc123'
      );
    });
  });

  describe('round-trip consistency', () => {
    const testCases: AppState[] = [
      {},
      { project: 'test-project' },
      { project: 'test-project', session: 'session-123' },
      { project: 'test-project', session: 'session-123', agent: 'agent-456' },
    ];

    testCases.forEach((state) => {
      it(`should maintain consistency for ${JSON.stringify(state)}`, () => {
        const hash = buildHash(state);
        const parsed = parseHash(hash);
        expect(parsed).toEqual(state);
      });
    });
  });
});
