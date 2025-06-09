// ABOUTME: Manages git operations for the snapshot system using custom git-dir
// ABOUTME: Handles repository initialization, commit operations, and maintenance with atomic safety

import { promises as fs } from 'fs';
import { join } from 'path';
import simpleGit from 'simple-git';

export class GitOperations {
  constructor(projectPath) {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('Invalid project path provided');
    }

    this.projectPath = projectPath;
    this.gitDir = join(projectPath, '.lace', 'history-snapshot-dotgit');
    this.workTree = projectPath;
    
    // Initialize simple-git - we'll handle custom git-dir differently
    this.git = simpleGit({
      baseDir: this.workTree,
      binary: 'git'
    });
  }

  /**
   * Initialize the git repository for snapshots
   */
  async initialize() {
    try {
      // Validate that project path exists and is a directory
      try {
        const stats = await fs.stat(this.projectPath);
        if (!stats.isDirectory()) {
          throw new Error(`Project path is not a directory: ${this.projectPath}`);
        }
      } catch (error) {
        throw new Error(`Invalid project path: ${this.projectPath}`);
      }

      // Create .lace directory if it doesn't exist
      await fs.mkdir(join(this.projectPath, '.lace'), { recursive: true });

      // Check if git repo already exists in this specific directory
      const gitFile = join(this.projectPath, '.git');
      if (await fs.access(gitFile).then(() => true).catch(() => false)) {
        return; // Already initialized
      }

      // Initialize git repository with separate git dir
      await this.git.init(['--separate-git-dir', this.gitDir]);

      // Create initial .gitignore to exclude main .git and .lace directories
      const gitignorePath = join(this.projectPath, '.gitignore');
      let gitignoreContent = '';
      
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
      } catch (error) {
        // File doesn't exist, will create new one
      }

      const linesToAdd = ['.git/', '.lace/'];
      for (const line of linesToAdd) {
        if (!gitignoreContent.includes(line)) {
          gitignoreContent += gitignoreContent.endsWith('\n') || gitignoreContent === '' ? '' : '\n';
          gitignoreContent += line + '\n';
        }
      }

      await fs.writeFile(gitignorePath, gitignoreContent);

      // Set git config for the snapshot repository
      await this.git.addConfig('user.name', 'Lace Snapshot System');
      await this.git.addConfig('user.email', 'noreply@lace-snapshot.local');

    } catch (error) {
      throw new Error(`Failed to initialize git repository: ${error.message}`);
    }
  }

  /**
   * Add files to git staging area
   */
  async add(pathPattern = '.') {
    await this.git.add(pathPattern);
  }

  /**
   * Commit changes with a message
   */
  async commit(message) {
    try {
      const result = await this.git.commit(message);
      
      // Check if commit was successful (has a commit hash)
      if (!result.commit || result.summary.changes === 0) {
        throw new Error('No changes to commit');
      }
      
      return result.commit;
    } catch (error) {
      if (error.message.includes('nothing to commit') || error.message.includes('No changes to commit')) {
        throw new Error('No changes to commit');
      }
      throw error;
    }
  }

  /**
   * Add and commit files atomically
   */
  async addAndCommit(message) {
    await this.add('.');
    return await this.commit(message);
  }

  /**
   * Get git status
   */
  async getStatus() {
    const status = await this.git.status();
    return status;
  }

  /**
   * Get git log with specified number of entries
   */
  async getLog(count = 10) {
    const log = await this.git.log(['--oneline', `-${count}`]);
    return log.all.map(entry => entry.hash).join('\n');
  }

  /**
   * Get changed files
   */
  async getChangedFiles() {
    try {
      const status = await this.git.status();
      
      return {
        modified: status.modified,
        untracked: status.not_added,
        deleted: status.deleted,
        staged: status.staged
      };
    } catch (error) {
      // If status fails, assume no changes
      return { modified: [], untracked: [], deleted: [], staged: [] };
    }
  }

  /**
   * Get repository statistics
   */
  async getRepositoryStats() {
    try {
      const log = await this.git.log();
      const commitCount = log.total;

      const files = await this.git.raw(['ls-files']);
      const fileCount = files ? files.trim().split('\n').filter(f => f).length : 0;

      // Get repository size (approximate)
      let repositorySize = 0;
      try {
        const stats = await fs.stat(this.gitDir);
        repositorySize = stats.size || 0;
      } catch (error) {
        // Size calculation failed, use 0
      }

      return {
        commitCount,
        fileCount,
        repositorySize
      };
    } catch (error) {
      return {
        commitCount: 0,
        fileCount: 0,
        repositorySize: 0
      };
    }
  }

  /**
   * Cleanup and optimize repository
   */
  async cleanup() {
    try {
      // Run git garbage collection
      await this.git.raw(['gc', '--aggressive', '--prune=now']);
    } catch (error) {
      // Cleanup failures are not critical
      console.warn(`Git cleanup warning: ${error.message}`);
    }
  }

  /**
   * Checkout a specific commit
   */
  async checkout(commitSha) {
    try {
      await this.git.checkout(commitSha);
      return { success: true, commit: commitSha };
    } catch (error) {
      throw new Error(`Failed to checkout commit ${commitSha}: ${error.message}`);
    }
  }

  /**
   * Get working tree status
   */
  async getWorkingTreeStatus() {
    try {
      const status = await this.git.status();
      
      return {
        modified: status.modified,
        untracked: status.not_added,
        deleted: status.deleted,
        hasChanges: status.modified.length > 0 || status.not_added.length > 0 || status.deleted.length > 0
      };
    } catch (error) {
      throw new Error(`Failed to get working tree status: ${error.message}`);
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(branchName, startPoint = null) {
    try {
      if (startPoint) {
        await this.git.checkoutBranch(branchName, startPoint);
      } else {
        await this.git.checkoutLocalBranch(branchName);
      }
      return { branch: branchName, startPoint };
    } catch (error) {
      throw new Error(`Failed to create branch ${branchName}: ${error.message}`);
    }
  }

  /**
   * Get current commit SHA
   */
  async getCurrentCommit() {
    try {
      const log = await this.git.log(['-1']);
      return log.latest?.hash || 'unknown';
    } catch (error) {
      throw new Error(`Failed to get current commit: ${error.message}`);
    }
  }

  /**
   * Get diff files between two commits
   */
  async getDiffFiles(fromCommit, toCommit) {
    try {
      const diffSummary = await this.git.diffSummary([fromCommit, toCommit]);
      
      return {
        modified: diffSummary.files.filter(f => f.changes > 0 && !f.binary).map(f => f.file),
        added: diffSummary.files.filter(f => f.insertions > 0 && f.deletions === 0).map(f => f.file),
        deleted: diffSummary.files.filter(f => f.deletions > 0 && f.insertions === 0).map(f => f.file),
        totalChanges: diffSummary.files.length
      };
    } catch (error) {
      throw new Error(`Failed to get diff between ${fromCommit} and ${toCommit}: ${error.message}`);
    }
  }

  /**
   * Restore specific files from a commit
   */
  async restoreFiles(commitSha, filePaths) {
    try {
      for (const filePath of filePaths) {
        await this.git.checkout([commitSha, '--', filePath]);
      }
      
      return { restoredFiles: filePaths, commit: commitSha };
    } catch (error) {
      throw new Error(`Failed to restore files from ${commitSha}: ${error.message}`);
    }
  }

  /**
   * Check if git is available in the system
   */
  async isGitAvailable() {
    try {
      await this.git.version();
      return true;
    } catch (error) {
      return false;
    }
  }
}