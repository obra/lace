// ABOUTME: Manages git worktrees for session isolation
// ABOUTME: Creates worktrees on session branches that remain connected to main repo

import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, resolve, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { logger } from '~/utils/logger';

const execFileAsync = promisify(execFile);

export class WorktreeManager {
  private static get WORKTREES_DIR(): string {
    const laceDir = process.env.LACE_DIR || join(homedir(), '.lace');
    return join(laceDir, 'worktrees');
  }

  /**
   * Validate that sessionId contains only safe characters
   * Prevents path traversal and command injection
   */
  private static validateSessionId(sessionId: string): void {
    const safePattern = /^[a-zA-Z0-9_-]+$/;
    if (!safePattern.test(sessionId)) {
      throw new Error(
        `Invalid sessionId: must contain only alphanumeric characters, dashes, and underscores. Got: ${sessionId}`
      );
    }
  }

  /**
   * Safely resolve worktree path and verify it doesn't escape the worktrees directory
   * Prevents directory traversal attacks
   */
  private static resolveWorktreePath(sessionId: string): string {
    this.validateSessionId(sessionId);

    const worktreesDir = this.WORKTREES_DIR;
    const targetPath = resolve(join(worktreesDir, sessionId));

    // Verify the resolved path is within the worktrees directory
    if (!targetPath.startsWith(worktreesDir + sep)) {
      throw new Error(
        `Path traversal detected: sessionId "${sessionId}" resolves outside worktrees directory`
      );
    }

    return targetPath;
  }

  /**
   * Execute git command safely using execFile to prevent command injection
   */
  private static async runGit(
    args: string[],
    cwd?: string,
    timeoutMs: number = 10000
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync('git', args, { cwd, timeout: timeoutMs });
      return result;
    } catch (error: unknown) {
      // execFile throws on non-zero exit codes or timeout
      const execError = error as { stdout?: string; stderr?: string; message?: string };
      throw new Error(
        `Git command failed: ${execError.message || 'Unknown error'}\nstderr: ${execError.stderr || ''}`
      );
    }
  }

  /**
   * Create a git worktree for a session on a new branch
   * The worktree stays connected to the main repo - commits appear immediately
   */
  static async createSessionWorktree(projectDir: string, sessionId: string): Promise<string> {
    // Validate projectDir is not empty
    if (!projectDir || projectDir.trim() === '') {
      throw new Error('projectDir cannot be empty - this would cause git init in cwd');
    }

    // Validate sessionId and resolve safe worktree path
    const worktreePath = this.resolveWorktreePath(sessionId);

    logger.debug('createSessionWorktree called', { projectDir, sessionId, worktreePath });

    // Check if it's a git repository, initialize if not
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      logger.warn('Project is not a git repository, initializing git', { projectDir });

      try {
        await this.runGit(['init'], projectDir);

        // Set default user if not configured globally
        try {
          await this.runGit(['config', 'user.email'], projectDir);
        } catch {
          // User email not set, use a default
          await this.runGit(['config', 'user.email', 'lace@localhost'], projectDir);
          await this.runGit(['config', 'user.name', 'Lace User'], projectDir);
        }

        // Create initial commit with all files
        await this.runGit(['add', '-A'], projectDir);
        await this.runGit(
          ['commit', '-m', 'Initial commit for workspace isolation', '--allow-empty'],
          projectDir
        );

        logger.info('Git repository initialized successfully', { projectDir });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to initialize git repository: ${message}`);
      }
    }

    // Ensure worktrees directory exists
    mkdirSync(this.WORKTREES_DIR, { recursive: true });

    // Remove existing worktree if it exists
    if (existsSync(worktreePath)) {
      try {
        // Try to remove via git first (cleaner)
        await this.runGit(['worktree', 'remove', worktreePath, '--force'], projectDir);
      } catch {
        // Fallback to filesystem removal
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Branch name for this session
    const branchName = `lace/session/${sessionId}`;

    // Create worktree on new branch
    try {
      await this.runGit(['worktree', 'add', '-b', branchName, worktreePath], projectDir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create worktree: ${message}`);
    }

    logger.info('Worktree created', {
      projectDir,
      sessionId,
      worktreePath,
      branchName,
    });

    return worktreePath;
  }

  /**
   * Remove a session's worktree and optionally its branch
   */
  static async removeSessionWorktree(
    projectDir: string,
    sessionId: string,
    removeBranch = false
  ): Promise<void> {
    // Validate sessionId and resolve safe worktree path
    const worktreePath = this.resolveWorktreePath(sessionId);
    const branchName = `lace/session/${sessionId}`;

    // Remove worktree
    if (existsSync(worktreePath)) {
      try {
        await this.runGit(['worktree', 'remove', worktreePath, '--force'], projectDir);
      } catch (error) {
        logger.warn('Failed to remove worktree via git, trying filesystem', {
          sessionId,
          error,
        });
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Optionally remove the branch
    if (removeBranch) {
      try {
        await this.runGit(['branch', '-D', branchName], projectDir);
      } catch (error) {
        logger.warn('Failed to remove session branch', { sessionId, branchName, error });
      }
    }

    logger.info('Worktree removed', { sessionId, removeBranch });
  }

  /**
   * Get the path to a session's worktree directory
   */
  static getWorktreePath(sessionId: string): string {
    return this.resolveWorktreePath(sessionId);
  }

  /**
   * List all session worktrees
   */
  static listSessionWorktrees(): string[] {
    if (!existsSync(this.WORKTREES_DIR)) {
      return [];
    }

    return readdirSync(this.WORKTREES_DIR).filter((name) => {
      const fullPath = join(this.WORKTREES_DIR, name);
      // Check if it has a .git file (worktree marker)
      return existsSync(join(fullPath, '.git'));
    });
  }

  /**
   * Get the branch name for a session
   */
  static getSessionBranchName(sessionId: string): string {
    this.validateSessionId(sessionId);
    return `lace/session/${sessionId}`;
  }
}
