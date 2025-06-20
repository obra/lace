// ABOUTME: Variable providers for template system - supplies dynamic context data
// ABOUTME: Implements System, Git, Project, Tool, and Context variable providers

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { TemplateContext } from './template-engine.js';

export interface VariableProvider {
  getVariables(): Promise<Record<string, any>>;
}

/**
 * Provides system-level context variables
 */
export class SystemVariableProvider implements VariableProvider {
  async getVariables(): Promise<Record<string, any>> {
    try {
      return {
        system: {
          os: os.platform(),
          arch: os.arch(),
          sessionTime: new Date().toISOString(),
        }
      };
    } catch (error) {
      logger.error('Failed to get system variables', { error: error instanceof Error ? error.message : String(error) });
      return { system: {} };
    }
  }
}

/**
 * Provides Git repository context variables
 */
export class GitVariableProvider implements VariableProvider {
  async getVariables(): Promise<Record<string, any>> {
    try {
      const gitVars: Record<string, any> = {};

      // Check if we're in a git repository
      try {
        execSync('git rev-parse --git-dir', { stdio: 'ignore' });
      } catch {
        return { git: {} };
      }

      // Get current branch
      try {
        const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
        if (branch) gitVars.branch = branch;
      } catch (error) {
        logger.debug('Could not get git branch', { error: error instanceof Error ? error.message : String(error) });
      }

      // Get repository status
      try {
        const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
        gitVars.status = status ? 'dirty' : 'clean';
      } catch (error) {
        logger.debug('Could not get git status', { error: error instanceof Error ? error.message : String(error) });
      }

      // Get user info
      try {
        const userName = execSync('git config user.name', { encoding: 'utf-8' }).trim();
        const userEmail = execSync('git config user.email', { encoding: 'utf-8' }).trim();
        if (userName || userEmail) {
          gitVars.user = { name: userName, email: userEmail };
        }
      } catch (error) {
        logger.debug('Could not get git user info', { error: error instanceof Error ? error.message : String(error) });
      }

      return { git: gitVars };
    } catch (error) {
      logger.error('Failed to get git variables', { error: error instanceof Error ? error.message : String(error) });
      return { git: {} };
    }
  }
}

/**
 * Provides project context variables
 */
export class ProjectVariableProvider implements VariableProvider {
  async getVariables(): Promise<Record<string, any>> {
    try {
      const cwd = process.cwd();
      
      // Generate a simple project tree (limit depth to avoid too much content)
      const tree = this.generateProjectTree(cwd, 2);

      return {
        project: {
          cwd,
          tree
        }
      };
    } catch (error) {
      logger.error('Failed to get project variables', { error: error instanceof Error ? error.message : String(error) });
      return { project: { cwd: process.cwd(), tree: '' } };
    }
  }

  private generateProjectTree(dir: string, maxDepth: number, currentDepth = 0): string {
    if (currentDepth >= maxDepth) return '';

    try {
      const items = fs.readdirSync(dir, { withFileTypes: true })
        .filter(item => !item.name.startsWith('.') && item.name !== 'node_modules')
        .slice(0, 20); // Limit number of items

      const indent = '  '.repeat(currentDepth);
      let tree = '';

      for (const item of items) {
        tree += `${indent}- ${item.name}${item.isDirectory() ? '/' : ''}\n`;
        
        if (item.isDirectory() && currentDepth < maxDepth - 1) {
          const subtree = this.generateProjectTree(path.join(dir, item.name), maxDepth, currentDepth + 1);
          tree += subtree;
        }
      }

      return tree;
    } catch (error) {
      logger.debug('Could not generate project tree', { dir, error: error instanceof Error ? error.message : String(error) });
      return '';
    }
  }
}

/**
 * Provides tool context variables
 */
export class ToolVariableProvider implements VariableProvider {
  constructor(private tools: Array<{ name: string; description: string }> = []) {}

  async getVariables(): Promise<Record<string, any>> {
    try {
      return {
        tools: this.tools.map(tool => ({
          name: tool.name,
          description: tool.description
        }))
      };
    } catch (error) {
      logger.error('Failed to get tool variables', { error: error instanceof Error ? error.message : String(error) });
      return { tools: [] };
    }
  }
}

/**
 * Provides context disclaimer about conversation start timing
 */
export class ContextDisclaimerProvider implements VariableProvider {
  async getVariables(): Promise<Record<string, any>> {
    return {
      context: {
        disclaimer: '\n\n**Note:** All project context information above is captured at the start of our conversation and will not be updated during our interaction.'
      }
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
        const variables = await provider.getVariables();
        Object.assign(context, variables);
      } catch (error) {
        logger.error('Variable provider failed', { 
          provider: provider.constructor.name, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }

    return context;
  }
}