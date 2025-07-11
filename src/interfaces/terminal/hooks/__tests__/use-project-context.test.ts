// ABOUTME: Tests for useProjectContext hook focusing on git status parsing, path formatting, and error handling
// ABOUTME: Test-driven development for project context functionality before implementation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectContext } from '~/interfaces/terminal/hooks/use-project-context.js';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

// Mock child_process and os modules
vi.mock('child_process');
vi.mock('os');
vi.mock('path');

const mockExecSync = vi.mocked(execSync);
const mockOs = vi.mocked(os);
const mockPath = vi.mocked(path);

describe('useProjectContext', () => {
  const originalCwd = process.cwd;
  const mockCwd = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = mockCwd;
    mockOs.homedir.mockReturnValue('/Users/testuser');
    mockPath.resolve.mockImplementation((p) => p);
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  describe('path formatting', () => {
    it('should format current working directory path', () => {
      mockCwd.mockReturnValue('/Users/testuser/Documents/project');
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.cwd).toBe('/Users/testuser/Documents/project');
      expect(result.current.context.displayPath).toBe('~/Documents/project');
      expect(result.current.context.isGitRepo).toBe(false);
    });

    it('should truncate long paths from the right', () => {
      const longPath = '/Users/testuser/very/long/path/to/deeply/nested/project/directory';
      mockCwd.mockReturnValue(longPath);
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.displayPath).toMatch(/^\.\.\..*project\/directory$/);
      expect(result.current.context.displayPath.length).toBeLessThanOrEqual(40);
    });

    it('should handle paths that do not contain home directory', () => {
      mockCwd.mockReturnValue('/opt/project');
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.displayPath).toBe('/opt/project');
    });
  });

  describe('git repository detection', () => {
    it('should detect git repository correctly', () => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce('M  file1.js\n?? file2.js\n'); // git status --porcelain

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.isGitRepo).toBe(true);
      expect(result.current.context.gitStatus?.branch).toBe('main');
    });

    it('should handle non-git directories', () => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not a git repository');
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.isGitRepo).toBe(false);
      expect(result.current.context.gitStatus).toBeUndefined();
    });
  });

  describe('git status parsing', () => {
    beforeEach(() => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      // Reset mock call count for each test
      mockExecSync.mockClear();
    });

    it('should parse modified files correctly', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce(' M file1.js\n M file2.js\n'); // git status --porcelain

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.modified).toBe(2);
      expect(result.current.context.gitStatus?.deleted).toBe(0);
      expect(result.current.context.gitStatus?.untracked).toBe(0);
      expect(result.current.context.gitStatus?.staged).toBe(0);
    });

    it('should parse deleted files correctly', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce(' D file1.js\n D file2.js\n D file3.js\n');

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.deleted).toBe(3);
      expect(result.current.context.gitStatus?.modified).toBe(0);
    });

    it('should parse untracked files correctly', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce('?? file1.js\n?? file2.js\n');

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.untracked).toBe(2);
      expect(result.current.context.gitStatus?.modified).toBe(0);
    });

    it('should parse staged files correctly', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce('A  file1.js\nM  file2.js\nD  file3.js\n');

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.staged).toBe(3);
      expect(result.current.context.gitStatus?.modified).toBe(0);
    });

    it('should parse mixed file states correctly', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce(
          'M  staged-modified.js\n M working-modified.js\n?? untracked.js\n D deleted.js\n'
        );

      const { result } = renderHook(() => useProjectContext());

      const status = result.current.context.gitStatus!;
      expect(status.staged).toBe(1); // M  (staged modified)
      expect(status.modified).toBe(1); // ' M' (working tree modified)
      expect(status.untracked).toBe(1); // ??
      expect(status.deleted).toBe(1); // ' D' (working tree deleted)
    });

    it('should handle empty git status', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce(''); // clean working directory

      const { result } = renderHook(() => useProjectContext());

      const status = result.current.context.gitStatus!;
      expect(status.modified).toBe(0);
      expect(status.deleted).toBe(0);
      expect(status.untracked).toBe(0);
      expect(status.staged).toBe(0);
    });
  });

  describe('branch name handling', () => {
    beforeEach(() => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync.mockClear();
    });

    it('should handle normal branch names', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('feature/add-status-bar\n') // git branch --show-current
        .mockReturnValueOnce(''); // git status --porcelain (empty)

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.branch).toBe('feature/add-status-bar');
    });

    it('should handle detached HEAD state', () => {
      mockExecSync
        .mockReturnValueOnce('.git\n') // git rev-parse --git-dir
        .mockReturnValueOnce('') // git branch --show-current (empty for detached HEAD)
        .mockReturnValueOnce(''); // git status --porcelain (empty)

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.gitStatus?.branch).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should handle git command failures gracefully', () => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync.mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd.includes('rev-parse')) {
          throw new Error('fatal: not a git repository');
        }
        return '';
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.context.isGitRepo).toBe(false);
      expect(result.current.context.gitStatus).toBeUndefined();
      expect(result.current.isRefreshing).toBe(false);
    });

    it('should provide refresh functionality', async () => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const { result } = renderHook(() => useProjectContext());

      expect(result.current.isRefreshing).toBe(false);

      await act(async () => {
        await result.current.refreshContext();
      });

      expect(result.current.isRefreshing).toBe(false);
    });
  });

  describe('caching behavior', () => {
    it('should not re-run git commands on every render', () => {
      mockCwd.mockReturnValue('/Users/testuser/project');
      mockExecSync
        .mockReturnValueOnce('.git\n')
        .mockReturnValueOnce('main\n')
        .mockReturnValueOnce('');

      const { result, rerender } = renderHook(() => useProjectContext());

      const initialCallCount = mockExecSync.mock.calls.length;

      // Re-render should not trigger new git commands
      rerender();

      expect(mockExecSync.mock.calls.length).toBe(initialCallCount);
      expect(result.current.context.isGitRepo).toBe(true);
    });
  });
});
