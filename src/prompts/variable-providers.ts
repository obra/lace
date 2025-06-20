// ABOUTME: Variable providers for prompt templates - no heuristics, simple data extraction
// ABOUTME: Provides system, git, project, and tool context for template substitution

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Tool } from '../tools/types.js';
import { execSync } from 'child_process';

export interface VariableProvider {
  getVariables(): Record<string, string>;
}

export class SystemVariableProvider implements VariableProvider {
  getVariables(): Record<string, string> {
    return {
      'system.os': os.platform(),
      'system.version': process.version,
      'session.startTime': new Date().toISOString(),
    };
  }
}

export class GitVariableProvider implements VariableProvider {
  getVariables(): Record<string, string> {
    const variables: Record<string, string> = {};
    
    try {
      // Get current branch
      variables['git.branch'] = execSync('git rev-parse --abbrev-ref HEAD', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
    } catch {
      variables['git.branch'] = 'unknown';
    }
    
    try {
      // Get git status
      variables['git.status'] = execSync('git status --porcelain', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim() || 'clean';
    } catch {
      variables['git.status'] = 'unknown';
    }
    
    try {
      // Get recent commits
      variables['git.shortlog'] = execSync('git log --oneline -5', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
    } catch {
      variables['git.shortlog'] = 'unknown';
    }
    
    try {
      // Get git user info
      variables['git.user.name'] = execSync('git config user.name', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
    } catch {
      variables['git.user.name'] = 'unknown';
    }
    
    try {
      variables['git.user.email'] = execSync('git config user.email', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
    } catch {
      variables['git.user.email'] = 'unknown';
    }
    
    return variables;
  }
}

export class ProjectVariableProvider implements VariableProvider {
  getVariables(): Record<string, string> {
    const variables: Record<string, string> = {
      'project.cwd': process.cwd(),
    };
    
    // Get basic file tree (limited depth to avoid huge output)
    try {
      const treeOutput = execSync('find . -type f -name "*.ts" -o -name "*.js" -o -name "*.json" -o -name "*.md" | head -50', { 
        encoding: 'utf-8',
        stdio: 'pipe'
      }).trim();
      variables['project.tree'] = treeOutput;
    } catch {
      variables['project.tree'] = 'unknown';
    }
    
    // Count files
    try {
      const fileCount = fs.readdirSync('.', { recursive: true })
        .filter(file => typeof file === 'string' && !file.startsWith('.'))
        .length;
      variables['project.files'] = fileCount.toString();
    } catch {
      variables['project.files'] = 'unknown';
    }
    
    return variables;
  }
}

export class ToolVariableProvider implements VariableProvider {
  constructor(private tools: Tool[]) {}
  
  getVariables(): Record<string, string> {
    const toolNames = this.tools.map(tool => tool.name).join(', ');
    const toolDescriptions = this.tools
      .map(tool => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    
    return {
      'tools.list': toolNames,
      'tools.descriptions': toolDescriptions,
    };
  }
}

export class PromptVariableManager {
  private providers: VariableProvider[] = [];
  
  addProvider(provider: VariableProvider): void {
    this.providers.push(provider);
  }
  
  getAllVariables(): Record<string, string> {
    const variables: Record<string, string> = {};
    
    for (const provider of this.providers) {
      try {
        const providerVariables = provider.getVariables();
        Object.assign(variables, providerVariables);
      } catch (error) {
        // Skip providers that fail - don't let one failure break everything
        console.warn(`Variable provider failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return variables;
  }
}