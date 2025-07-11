// ABOUTME: React hook for project context including git status and current working directory
// ABOUTME: Provides formatted path display and parsed git repository information with caching

import { useState, useEffect, useCallback, useRef } from 'react';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface GitStatus {
  branch?: string;
  modified: number;
  deleted: number;
  untracked: number;
  staged: number;
}

export interface ProjectContext {
  cwd: string;
  displayPath: string;
  isGitRepo: boolean;
  gitStatus?: GitStatus;
  error?: string;
}

export interface UseProjectContextResult {
  context: ProjectContext;
  refreshContext: () => Promise<void>;
  isRefreshing: boolean;
}

/**
 * Custom hook for managing project context including git information and working directory
 *
 * Features:
 * - Formats current working directory with home directory substitution
 * - Detects git repositories and parses status information
 * - Provides caching to avoid repeated git command execution
 * - Handles all git command failures gracefully
 * - Supports manual refresh for updates after command completion
 */
export function useProjectContext(): UseProjectContextResult {
  const [context, setContext] = useState<ProjectContext>(() => getInitialContext());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get initial context synchronously to avoid loading states
  function getInitialContext(): ProjectContext {
    try {
      const cwd = process.cwd();
      const displayPath = formatDisplayPath(cwd);

      // Try to get git info synchronously for initial load
      const gitInfo = getGitInfo();

      return {
        cwd,
        displayPath,
        isGitRepo: gitInfo.isGitRepo,
        gitStatus: gitInfo.gitStatus,
        error: gitInfo.error,
      };
    } catch (error) {
      const cwd = process.cwd();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        cwd,
        displayPath: formatDisplayPath(cwd),
        isGitRepo: false,
        error: `Context initialization failed: ${errorMessage}`,
      };
    }
  }

  // Format path for display with home directory replacement and truncation
  function formatDisplayPath(cwd: string): string {
    const homeDir = os.homedir();
    let displayPath = cwd;

    // Replace home directory with ~
    if (cwd.startsWith(homeDir)) {
      displayPath = cwd.replace(homeDir, '~');
    }

    // Truncate long paths from the left, keeping ~40 characters
    if (displayPath.length > 40) {
      const parts = displayPath.split(path.sep);
      let truncated = '';
      let i = parts.length - 1;

      // Build path from right to left until we exceed length
      while (i >= 0 && truncated.length + parts[i].length + 1 <= 37) {
        // -3 for "..."
        truncated = parts[i] + (truncated ? path.sep + truncated : '');
        i--;
      }

      displayPath = '...' + path.sep + truncated;
    }

    return displayPath;
  }

  // Get git repository information
  function getGitInfo(): { isGitRepo: boolean; gitStatus?: GitStatus; error?: string } {
    try {
      // Check if we're in a git repository
      execSync('git rev-parse --git-dir', {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 2000,
      });

      // Get branch name
      let branch: string | undefined;
      try {
        const branchOutput = execSync('git branch --show-current', {
          stdio: 'pipe',
          encoding: 'utf8',
          timeout: 2000,
        }).trim();
        branch = branchOutput || undefined; // Empty string becomes undefined (detached HEAD)
      } catch {
        // Branch command failed, leave undefined
      }

      // Get status
      const statusOutput = execSync('git status --porcelain', {
        stdio: 'pipe',
        encoding: 'utf8',
        timeout: 2000,
      });

      const gitStatus = parseGitStatus(statusOutput, branch);

      return {
        isGitRepo: true,
        gitStatus,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown git error';
      return {
        isGitRepo: false,
        error: `Git error: ${errorMessage}`,
      };
    }
  }

  // Parse git status --porcelain output into counts
  function parseGitStatus(statusOutput: string, branch?: string): GitStatus {
    const lines = statusOutput.split('\n').filter((line) => line.length > 0);

    let modified = 0;
    let deleted = 0;
    let untracked = 0;
    let staged = 0;

    for (const line of lines) {
      if (line.length < 2) continue;

      const indexStatus = line[0]; // Staged changes
      const workingStatus = line[1]; // Working tree changes

      // Count working tree changes
      if (workingStatus === 'M') modified++;
      if (workingStatus === 'D') deleted++;

      // Count untracked files
      if (line.startsWith('??')) untracked++;

      // Count staged changes
      if (indexStatus === 'A' || indexStatus === 'M' || indexStatus === 'D') {
        staged++;
      }
    }

    return {
      branch,
      modified,
      deleted,
      untracked,
      staged,
    };
  }

  // Refresh context with debouncing to prevent excessive git command execution
  const refreshContext = useCallback(async () => {
    // Clear any pending refresh
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    // Debounce rapid refresh calls
    return new Promise<void>((resolve) => {
      refreshTimeoutRef.current = setTimeout(() => {
        setIsRefreshing(true);

        try {
          const cwd = process.cwd();
          const displayPath = formatDisplayPath(cwd);
          const gitInfo = getGitInfo();

          setContext({
            cwd,
            displayPath,
            isGitRepo: gitInfo.isGitRepo,
            gitStatus: gitInfo.gitStatus,
            error: gitInfo.error,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          setContext((prev) => ({
            ...prev,
            error: `Context refresh failed: ${errorMessage}`,
          }));
        } finally {
          setIsRefreshing(false);
          resolve();
        }
      }, 500); // 500ms debounce
    });
  }, []);

  // Initialize context on mount (only if different from initial)
  useEffect(() => {
    const currentCwd = process.cwd();
    if (currentCwd !== context.cwd) {
      void refreshContext();
    }
  }, []); // Empty deps - only run once on mount

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  return {
    context,
    refreshContext,
    isRefreshing,
  };
}
