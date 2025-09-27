// ABOUTME: Manages local git clones for isolated session workspaces
// ABOUTME: Uses git clone --local for space-efficient clones with hardlinks

import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CloneManager {
  private static readonly CLONES_DIR = join(homedir(), '.lace', 'clones');

  /**
   * Create a local git clone for a session workspace
   * Uses --local flag to create hardlinks for space efficiency
   */
  static async createSessionClone(projectDir: string, sessionId: string): Promise<string> {
    // Validate project directory exists
    if (!existsSync(projectDir)) {
      throw new Error('Project directory does not exist');
    }

    // Validate it's a git repository
    const gitDir = join(projectDir, '.git');
    if (!existsSync(gitDir)) {
      throw new Error(`${projectDir} is not a git repository`);
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
      await execAsync(`git clone --local "${projectDir}" "${clonePath}"`);
    } catch (error: any) {
      throw new Error(`Failed to create clone: ${error.message}`);
    }

    return clonePath;
  }

  /**
   * Remove a session clone
   */
  static async removeSessionClone(sessionId: string): Promise<void> {
    const clonePath = join(this.CLONES_DIR, sessionId);

    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }
  }

  /**
   * List all session clones
   */
  static async listSessionClones(): Promise<string[]> {
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
