// ABOUTME: Variable providers for template system - supplies dynamic context data
// ABOUTME: Implements System, Git, Project, Tool, and Context variable providers

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, type StdioOptions } from 'child_process';
import { logger } from '~/utils/logger';
import { TemplateContext } from '~/config/template-engine';

interface VariableProvider {
  getVariables(): Promise<Record<string, unknown>> | Record<string, unknown>;
}

/**
 * Command runner - easier to mock than execSync directly
 */
export class CommandRunner {
  runCommand(
    command: string,
    args: string[],
    options?: { encoding?: 'utf8' | 'utf-8' | 'ascii' | 'base64' | 'hex'; stdio?: StdioOptions }
  ): string {
    const fullCommand = `${command} ${args.join(' ')}`;
    return execSync(fullCommand, { encoding: 'utf-8', ...options })
      .toString()
      .trim();
  }

  isGitRepository(): boolean {
    try {
      this.runCommand('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Provides system-level context variables
 */
export class SystemVariableProvider implements VariableProvider {
  getVariables(): Record<string, unknown> {
    try {
      return {
        system: {
          os: os.platform(),
          arch: os.arch(),
          sessionTime: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Failed to get system variables', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { system: {} };
    }
  }
}

/**
 * Provides Git repository context variables
 */
export class GitVariableProvider implements VariableProvider {
  private commandRunner: CommandRunner;

  constructor(commandRunner?: CommandRunner) {
    this.commandRunner = commandRunner || new CommandRunner();
  }

  getVariables(): Record<string, unknown> {
    try {
      const gitVars: Record<string, unknown> = {};

      // Check if we're in a git repository
      if (!this.commandRunner.isGitRepository()) {
        return { git: {} };
      }

      // Get current branch
      try {
        const branch = this.commandRunner.runCommand('git', ['branch', '--show-current']);
        if (branch) gitVars.branch = branch;
      } catch (error) {
        logger.debug('Could not get git branch', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Get repository status
      try {
        const status = this.commandRunner.runCommand('git', ['status', '--porcelain']);
        gitVars.status = status ? 'dirty' : 'clean';
      } catch (error) {
        logger.debug('Could not get git status', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Get user info
      try {
        const userName = this.commandRunner.runCommand('git', ['config', 'user.name']);
        const userEmail = this.commandRunner.runCommand('git', ['config', 'user.email']);
        if (userName || userEmail) {
          gitVars.user = { name: userName, email: userEmail };
        }
      } catch (error) {
        logger.debug('Could not get git user info', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return { git: gitVars };
    } catch (error) {
      logger.error('Failed to get git variables', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { git: {} };
    }
  }
}

/**
 * Provides project context variables
 */
export class ProjectVariableProvider implements VariableProvider {
  constructor(
    private session?: { getWorkingDirectory(): string },
    private project?: { getWorkingDirectory(): string }
  ) {}

  getVariables(): Record<string, unknown> {
    try {
      // Use session working directory if available, fall back to project, then process.cwd()
      let cwd = process.cwd();
      let source = 'process.cwd()';

      if (this.session) {
        cwd = this.session.getWorkingDirectory();
        source = 'session.getWorkingDirectory()';
      } else if (this.project) {
        cwd = this.project.getWorkingDirectory();
        source = 'project.getWorkingDirectory()';
      }

      logger.debug('ProjectVariableProvider.getVariables() - resolved working directory', {
        hasSession: !!this.session,
        hasProject: !!this.project,
        workingDirectory: cwd,
        source: source,
        processCwd: process.cwd(),
      });

      // Generate a simple project tree (limit depth to avoid too much content)
      const tree = this.generateProjectTree(cwd, 2);

      return {
        project: {
          cwd,
          tree,
        },
      };
    } catch (error) {
      logger.error('Failed to get project variables', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Fallback working directory for error case
      let fallbackCwd = process.cwd();
      if (this.session) {
        try {
          fallbackCwd = this.session.getWorkingDirectory();
        } catch {
          // Ignore error, use process.cwd()
        }
      } else if (this.project) {
        try {
          fallbackCwd = this.project.getWorkingDirectory();
        } catch {
          // Ignore error, use process.cwd()
        }
      }

      return { project: { cwd: fallbackCwd, tree: '' } };
    }
  }

  private generateProjectTree(dir: string, maxDepth: number, currentDepth = 0): string {
    if (currentDepth >= maxDepth) return '';

    try {
      const items = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((item) => !item.name.startsWith('.') && item.name !== 'node_modules')
        .slice(0, 20); // Limit number of items

      const indent = '  '.repeat(currentDepth);
      let tree = '';

      for (const item of items) {
        tree += `${indent}- ${item.name}${item.isDirectory() ? '/' : ''}\n`;

        if (item.isDirectory() && currentDepth < maxDepth - 1) {
          const subtree = this.generateProjectTree(
            path.join(dir, item.name),
            maxDepth,
            currentDepth + 1
          );
          tree += subtree;
        }
      }

      return tree;
    } catch (error) {
      logger.debug('Could not generate project tree', {
        dir,
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }
}

/**
 * Provides tool context variables
 */
export class ToolVariableProvider implements VariableProvider {
  constructor(private tools: Array<{ name: string; description: string }> = []) {}

  getVariables(): Record<string, unknown> {
    try {
      return {
        tools: this.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
      };
    } catch (error) {
      logger.error('Failed to get tool variables', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { tools: [] };
    }
  }
}

/**
 * Provides context disclaimer about conversation start timing
 */
export class ContextDisclaimerProvider implements VariableProvider {
  getVariables(): Record<string, unknown> {
    return {
      context: {
        disclaimer:
          '\n\n**Note:** All project context information above is captured at the start of our conversation and will not be updated during our interaction.',
      },
    };
  }
}

/**
 * Combines all variable providers into a single context object
 */
export class VariableProviderManager {
  private providers: VariableProvider[] = [];

  addProvider(provider: VariableProvider): void {
    this.providers.push(provider);
  }

  async getTemplateContext(): Promise<TemplateContext> {
    const context: TemplateContext = {};

    for (const provider of this.providers) {
      try {
        const variables = await Promise.resolve(provider.getVariables());
        Object.assign(context, variables);
      } catch (error) {
        logger.error('Variable provider failed', {
          provider: provider.constructor.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return context;
  }
}
