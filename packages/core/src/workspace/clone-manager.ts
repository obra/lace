// ABOUTME: Manages local git clones for isolated session workspaces
// ABOUTME: Uses git clone --local for space-efficient clones with hardlinks

import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { logger } from '~/utils/logger';

const execFileAsync = promisify(execFile);

export class CloneManager {
  // Use LACE_DIR environment variable for test isolation
  private static get CLONES_DIR(): string {
    const laceDir = process.env.LACE_DIR || join(homedir(), '.lace');
    return join(laceDir, 'clones');
  }

  /**
   * Create a local git clone for a session workspace
   * Uses --local flag to create hardlinks for space efficiency
   * Auto-initializes git if not already a repository
   */
  static async createSessionClone(projectDir: string, sessionId: string): Promise<string> {
    // Validate projectDir is not empty
    if (!projectDir || projectDir.trim() === '') {
      throw new Error(
        `projectDir cannot be empty - this would cause git init in cwd (${process.cwd()}). ` +
          'In tests, this usually means tempDir was accessed before beforeEach ran.'
      );
    }

    // Validate project directory exists
    if (!existsSync(projectDir)) {
      throw new Error('Project directory does not exist');
    }

    // Check if it's a git repository, initialize if not
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      // In tests, validate we're not about to git init in source directories
      if (
        process.env.NODE_ENV === 'test' &&
        !projectDir.includes('/tmp/') &&
        !projectDir.includes('/T/')
      ) {
        throw new Error(
          `Refusing to git init in non-temp directory during tests! ` +
            `projectDir: ${projectDir}, cwd: ${process.cwd()}. ` +
            'This usually means a test passed the wrong directory path.'
        );
      }

      logger.warn('CloneManager: Project is not a git repository, initializing git', {
        projectDir,
        cwd: process.cwd(),
      });

      // Initialize git repository
      try {
        await execFileAsync('git', ['init'], { cwd: projectDir });

        // Set default user if not configured globally
        try {
          await execFileAsync('git', ['config', 'user.email'], {
            cwd: projectDir,
          });
        } catch {
          // User email not set, use a default
          await execFileAsync('git', ['config', 'user.email', 'lace@localhost'], {
            cwd: projectDir,
          });
          await execFileAsync('git', ['config', 'user.name', 'Lace User'], {
            cwd: projectDir,
          });
        }

        // Create initial commit with all files
        await execFileAsync('git', ['add', '-A'], { cwd: projectDir });
        await execFileAsync(
          'git',
          ['commit', '-m', 'Initial commit for workspace isolation', '--allow-empty'],
          {
            cwd: projectDir,
          }
        );

        logger.info('Git repository initialized successfully', { projectDir });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to initialize git repository: ${message}`);
      }
    }

    // Ensure clones directory exists
    mkdirSync(this.CLONES_DIR, { recursive: true });

    // Create clone path
    const clonePath = join(this.CLONES_DIR, sessionId);

    // Remove existing clone if it exists
    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }

    // Clone with --local flag for hardlinks
    try {
      await execFileAsync('git', ['clone', '--local', projectDir, clonePath]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create clone: ${message}`);
    }

    return clonePath;
  }

  /**
   * Remove a session clone
   */
  static removeSessionClone(sessionId: string): void {
    const clonePath = join(this.CLONES_DIR, sessionId);

    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }
  }

  /**
   * Get the path to a session's clone directory
   */
  static getClonePath(sessionId: string): string {
    return join(this.CLONES_DIR, sessionId);
  }

  /**
   * List all session clones
   */
  static listSessionClones(): string[] {
    if (!existsSync(this.CLONES_DIR)) {
      return [];
    }

    return readdirSync(this.CLONES_DIR).filter((name) => {
      const fullPath = join(this.CLONES_DIR, name);
      // Only include directories that are git repositories
      return existsSync(join(fullPath, '.git'));
    });
  }
}
