// ABOUTME: Unit tests for WorktreeManager security validations
// ABOUTME: Tests path traversal prevention and input validation

import { describe, it, expect } from 'vitest';
import { WorktreeManager } from './worktree-manager';

describe('WorktreeManager Security', () => {
  describe('validateSessionId', () => {
    it('should accept valid sessionIds with alphanumeric, dashes, and underscores', () => {
      const validIds = [
        'abc123',
        'test-session',
        'test_session',
        'abc-123_xyz',
        'SESSION123',
        'a',
        '123',
      ];

      for (const sessionId of validIds) {
        expect(() => WorktreeManager.getWorktreePath(sessionId)).not.toThrow();
      }
    });

    it('should reject sessionIds with path separators', () => {
      const invalidIds = ['../etc/passwd', 'test/../etc', 'test/../../etc', './../test'];

      for (const sessionId of invalidIds) {
        expect(() => WorktreeManager.getWorktreePath(sessionId)).toThrow(/Invalid sessionId/);
      }
    });

    it('should reject sessionIds with shell metacharacters', () => {
      const invalidIds = [
        'test; rm -rf /',
        'test && echo hi',
        'test | cat',
        'test$(whoami)',
        'test`whoami`',
        'test$HOME',
        'test;whoami',
        'test||echo',
        'test>file',
        'test<file',
        'test*',
        'test?',
        'test[abc]',
        'test{1,2}',
        'test (parens)',
        'test@host',
      ];

      for (const sessionId of invalidIds) {
        expect(() => WorktreeManager.getWorktreePath(sessionId)).toThrow(/Invalid sessionId/);
      }
    });

    it('should reject sessionIds with dots', () => {
      const invalidIds = ['.', '..', '...', 'test.exe', '.hidden'];

      for (const sessionId of invalidIds) {
        expect(() => WorktreeManager.getWorktreePath(sessionId)).toThrow(/Invalid sessionId/);
      }
    });

    it('should reject sessionIds with spaces', () => {
      const invalidIds = ['test session', ' test', 'test ', 'te st'];

      for (const sessionId of invalidIds) {
        expect(() => WorktreeManager.getWorktreePath(sessionId)).toThrow(/Invalid sessionId/);
      }
    });
  });

  describe('resolveWorktreePath', () => {
    it('should return path within worktrees directory for valid sessionId', () => {
      const sessionId = 'test-session-123';
      const path = WorktreeManager.getWorktreePath(sessionId);

      expect(path).toContain('worktrees');
      expect(path).toContain(sessionId);
      expect(path).not.toContain('..');
    });

    it('should normalize path and verify it stays within worktrees', () => {
      // Even if validation was bypassed, the path resolver should catch traversal
      const sessionId = 'valid-session';
      const path = WorktreeManager.getWorktreePath(sessionId);

      // Path should be absolute and contain worktrees directory
      expect(path).toMatch(/^\/.*worktrees.*valid-session$/);
    });
  });

  describe('getSessionBranchName', () => {
    it('should accept valid sessionIds', () => {
      const sessionId = 'test-session-123';
      const branchName = WorktreeManager.getSessionBranchName(sessionId);

      expect(branchName).toBe('lace/session/test-session-123');
    });

    it('should reject invalid sessionIds', () => {
      const invalidIds = ['../etc', 'test;whoami', 'test|cat'];

      for (const sessionId of invalidIds) {
        expect(() => WorktreeManager.getSessionBranchName(sessionId)).toThrow(/Invalid sessionId/);
      }
    });
  });
});
