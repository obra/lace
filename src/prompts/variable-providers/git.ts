// ABOUTME: Git variable provider for repository context information
// ABOUTME: Uses child_process to execute git commands and extract repository state

import { PromptVariableProvider } from '../types.js';
import { execSync } from 'child_process';
import { logger } from '../../utils/logger.js';

export class GitVariableProvider implements PromptVariableProvider {
  private _workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    this._workingDir = workingDir;
  }

  getVariables(): Record<string, unknown> {
    return {
      git: {
        branch: this._getBranch(),
        status: this._getStatus(),
        shortlog: this._getShortlog(),
        user: this._getUserInfo(),
        root: this._getRepositoryRoot(),
        workingDir: this._workingDir,
        isClean: this._isWorkingDirectoryClean(),
        remote: this._getRemoteOrigin()
      }
    };
  }

  private _executeGitCommand(command: string): string | null {
    try {
      const result = execSync(`git ${command}`, {
        cwd: this._workingDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return result.trim();
    } catch (error) {
      logger.debug('Git command failed', {
        command,
        workingDir: this._workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private _getBranch(): string {
    const branch = this._executeGitCommand('rev-parse --abbrev-ref HEAD');
    return branch || '(not a git repository)';
  }

  private _getStatus(): string {
    const status = this._executeGitCommand('status --porcelain');
    if (status === null) {
      return '(not a git repository)';
    }
    return status || '(clean)';
  }

  private _getShortlog(): string {
    const shortlog = this._executeGitCommand('log --oneline -10');
    return shortlog || '(no commits)';
  }

  private _getUserInfo(): Record<string, string> {
    const name = this._executeGitCommand('config user.name') || '(not configured)';
    const email = this._executeGitCommand('config user.email') || '(not configured)';
    
    return {
      name,
      email
    };
  }

  private _getRepositoryRoot(): string {
    const root = this._executeGitCommand('rev-parse --show-toplevel');
    return root || this._workingDir;
  }

  private _isWorkingDirectoryClean(): boolean {
    const status = this._executeGitCommand('status --porcelain');
    return status !== null && status === '';
  }

  private _getRemoteOrigin(): string | null {
    const remote = this._executeGitCommand('remote get-url origin');
    return remote;
  }
}