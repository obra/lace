// ABOUTME: Variable providers for template context generation
// ABOUTME: Language-agnostic system that provides dynamic context for prompt templates

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { TemplateContext } from './template-engine.js';

export interface VariableProvider {
  getVariables(): TemplateContext;
}

/**
 * System information provider - OS, platform, session info
 */
export class SystemVariableProvider implements VariableProvider {
  private _sessionStartTime: Date;

  constructor() {
    this._sessionStartTime = new Date();
  }

  getVariables(): TemplateContext {
    return {
      system: {
        os: os.platform(),
        arch: os.arch(),
        version: os.release(),
        homedir: os.homedir(),
      },
      session: {
        startTime: this._sessionStartTime.toISOString(),
        pid: process.pid,
      },
    };
  }
}

/**
 * Git context provider - branch, status, user info
 */
export class GitVariableProvider implements VariableProvider {
  private _cwd: string;

  constructor(cwd: string = process.cwd()) {
    this._cwd = cwd;
  }

  getVariables(): TemplateContext {
    const git: Record<string, unknown> = {};

    try {
      // Check if we're in a git repository
      execSync('git rev-parse --git-dir', { cwd: this._cwd, stdio: 'pipe' });

      // Get git information
      git.branch = this._safeExec('git branch --show-current') || 'unknown';
      git.status = this._safeExec('git status --porcelain') || '';
      git.shortlog = this._safeExec('git log --oneline -5') || '';
      
      // User information
      const userName = this._safeExec('git config user.name');
      const userEmail = this._safeExec('git config user.email');
      
      if (userName || userEmail) {
        git.user = {
          name: userName || 'unknown',
          email: userEmail || 'unknown',
        };
      }

      // Repository info
      const remoteUrl = this._safeExec('git config --get remote.origin.url');
      if (remoteUrl) {
        git.remote = remoteUrl;
      }

    } catch (error) {
      logger.debug('Not in a git repository or git not available', { cwd: this._cwd });
      git.branch = 'no-git';
      git.status = '';
    }

    return { git };
  }

  private _safeExec(command: string): string | null {
    try {
      return execSync(command, { 
        cwd: this._cwd, 
        encoding: 'utf-8', 
        stdio: 'pipe' 
      }).trim();
    } catch {
      return null;
    }
  }
}

/**
 * Project context provider - working directory, file structure
 */
export class ProjectVariableProvider implements VariableProvider {
  private _cwd: string;

  constructor(cwd: string = process.cwd()) {
    this._cwd = cwd;
  }

  getVariables(): TemplateContext {
    const project: Record<string, unknown> = {
      cwd: this._cwd,
      name: path.basename(this._cwd),
    };

    try {
      // Get basic file information
      const files = fs.readdirSync(this._cwd);
      project.files = files.length;
      
      // Detect common project files
      const commonFiles = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'pom.xml'];
      project.configFiles = files.filter(f => commonFiles.includes(f));

      // Simple directory structure (top-level only)
      const dirs = files.filter(f => {
        try {
          return fs.statSync(path.join(this._cwd, f)).isDirectory();
        } catch {
          return false;
        }
      });
      project.directories = dirs;

    } catch (error) {
      logger.debug('Failed to read project information', { 
        cwd: this._cwd,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return { project };
  }
}

/**
 * Tool context provider - available tools and their descriptions
 */
export class ToolVariableProvider implements VariableProvider {
  private _tools: Array<{ name: string; description: string }>;

  constructor(tools: Array<{ name: string; description: string }> = []) {
    this._tools = tools;
  }

  getVariables(): TemplateContext {
    return {
      tools: {
        list: this._tools.map(t => t.name),
        descriptions: this._tools.reduce((acc, tool) => {
          acc[tool.name] = tool.description;
          return acc;
        }, {} as Record<string, string>),
        count: this._tools.length,
      }
    };
  }

  updateTools(tools: Array<{ name: string; description: string }>) {
    this._tools = tools;
  }
}

/**
 * Context disclaimer provider - adds notices about data freshness
 */
export class ContextDisclaimerProvider implements VariableProvider {
  getVariables(): TemplateContext {
    return {
      context: {
        disclaimer: 'All project context (git status, file structure, etc.) is captured at the start of our conversation and will not update during our work.',
        timestamp: new Date().toISOString(),
      }
    };
  }
}