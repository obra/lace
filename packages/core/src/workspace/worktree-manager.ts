// ABOUTME: Manages git worktrees for session isolation
// ABOUTME: Creates worktrees on session branches that remain connected to main repo

import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { logger } from '~/utils/logger';

const execAsync = promisify(exec);

export class WorktreeManager {
  private static get WORKTREES_DIR(): string {
    const laceDir = process.env.LACE_DIR || join(homedir(), '.lace');
    return join(laceDir, 'worktrees');
  }

  /**
   * Create a git worktree for a session on a new branch
   * The worktree stays connected to the main repo - commits appear immediately
   */
  static async createSessionWorktree(projectDir: string, sessionId: string): Promise<string> {
    // Check if it's a git repository, initialize if not
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      logger.info('Project is not a git repository, initializing git', { projectDir });

      try {
        await execAsync('git init', { cwd: projectDir });

        // Set default user if not configured globally
        try {
          await execAsync('git config user.email', { cwd: projectDir });
        } catch {
          // User email not set, use a default
          await execAsync('git config user.email "lace@localhost"', { cwd: projectDir });
          await execAsync('git config user.name "Lace User"', { cwd: projectDir });
        }

        // Create initial commit with all files
        await execAsync('git add -A', { cwd: projectDir });
        await execAsync('git commit -m "Initial commit for workspace isolation" --allow-empty', {
          cwd: projectDir,
        });

        logger.info('Git repository initialized successfully', { projectDir });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to initialize git repository: ${message}`);
      }
    }

    // Ensure worktrees directory exists
    mkdirSync(this.WORKTREES_DIR, { recursive: true });

    // Create worktree path
    const worktreePath = join(this.WORKTREES_DIR, sessionId);

    // Remove existing worktree if it exists
    if (existsSync(worktreePath)) {
      try {
        // Try to remove via git first (cleaner)
        await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: projectDir });
      } catch {
        // Fallback to filesystem removal
        rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Branch name for this session
    const branchName = `lace/session/${sessionId}`;

    // Create worktree on new branch
    try {
      await execAsync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
        cwd: projectDir,
      });
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
    const worktreePath = join(this.WORKTREES_DIR, sessionId);
    const branchName = `lace/session/${sessionId}`;

    // Remove worktree
    if (existsSync(worktreePath)) {
      try {
        await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: projectDir });
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
        await execAsync(`git branch -D "${branchName}"`, { cwd: projectDir });
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
    return join(this.WORKTREES_DIR, sessionId);
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
    return `lace/session/${sessionId}`;
  }
}
