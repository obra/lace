// ABOUTME: Main prompt management class that orchestrates template loading and variable substitution
// ABOUTME: Integrates PromptTemplateEngine with all variable providers for complete prompt generation

import { PromptTemplateEngine } from './template-engine.js';
import { SystemVariableProvider } from './variable-providers/system.js';
import { GitVariableProvider } from './variable-providers/git.js';
import { ProjectVariableProvider } from './variable-providers/project.js';
import { ToolVariableProvider } from './variable-providers/tool.js';
import { PromptVariableProvider, PromptVariables } from './types.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface PromptManagerOptions {
  templatePath?: string;
  maxFileDepth?: number;
  maxFiles?: number;
}

export class PromptManager {
  private _templateEngine: PromptTemplateEngine;
  private _providers: PromptVariableProvider[];
  private _promptsDir: string;
  private _workingDir: string;
  private _options: PromptManagerOptions;

  constructor(
    promptsDir: string,
    workingDir: string = process.cwd(),
    tools: Tool[] = [],
    options: PromptManagerOptions = {}
  ) {
    this._templateEngine = new PromptTemplateEngine();
    this._promptsDir = promptsDir;
    this._workingDir = workingDir;
    this._options = options;

    // Initialize standard variable providers
    this._providers = [
      new SystemVariableProvider(),
      new GitVariableProvider(workingDir),
      new ProjectVariableProvider(workingDir, {
        maxDepth: options.maxFileDepth,
        maxFiles: options.maxFiles
      }),
      new ToolVariableProvider(tools)
    ];
  }

  /**
   * Generate system prompt with optional additional variables
   */
  generateSystemPrompt(additionalVariables: PromptVariables = {}): string {
    const templatePath = this._options.templatePath || path.join(this._promptsDir, 'system.md');
    
    try {
      // Load template content
      let template: string;
      
      if (fs.existsSync(templatePath)) {
        template = fs.readFileSync(templatePath, 'utf-8');
        logger.debug('Loaded system prompt template', { templatePath });
      } else {
        logger.warn('System prompt template not found, using fallback', { templatePath });
        template = this._getFallbackTemplate();
      }

      // Create file loader for includes
      const fileLoader = (filePath: string): string | undefined => {
        const fullPath = path.resolve(this._promptsDir, filePath);
        
        try {
          if (fs.existsSync(fullPath)) {
            return fs.readFileSync(fullPath, 'utf-8');
          }
        } catch (error) {
          logger.debug('Failed to load include file', {
            filePath,
            fullPath,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        
        return undefined;
      };

      // Gather all variables
      const allVariables = this._gatherVariables(additionalVariables);

      // Process template: first includes, then variables
      const withIncludes = this._templateEngine.renderWithIncludes(template, fileLoader);
      const finalPrompt = this._templateEngine.render(withIncludes, allVariables);

      logger.debug('Generated system prompt', {
        templateLength: template.length,
        finalLength: finalPrompt.length,
        variableCount: Object.keys(allVariables).length
      });

      return finalPrompt;

    } catch (error) {
      logger.error('Error generating system prompt', {
        templatePath,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return a basic fallback that should always work
      return this._getFallbackTemplate();
    }
  }

  /**
   * Add a custom variable provider
   */
  addProvider(provider: PromptVariableProvider): void {
    this._providers.push(provider);
  }

  /**
   * Get all available variables (useful for debugging)
   */
  getAvailableVariables(): PromptVariables {
    return this._gatherVariables();
  }

  /**
   * Check if template file exists
   */
  hasTemplate(): boolean {
    const templatePath = this._options.templatePath || path.join(this._promptsDir, 'system.md');
    return fs.existsSync(templatePath);
  }

  private _gatherVariables(additional: PromptVariables = {}): PromptVariables {
    const merged: PromptVariables = {};

    // Collect variables from all providers
    for (const provider of this._providers) {
      try {
        const variables = provider.getVariables();
        Object.assign(merged, variables);
      } catch (error) {
        logger.warn('Error getting variables from provider', {
          providerName: provider.constructor.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Add additional variables (these override provider variables)
    Object.assign(merged, additional);

    return merged;
  }

  private _getFallbackTemplate(): string {
    return `# AI Coding Assistant

You are an AI coding assistant designed to help with programming tasks.

## System Information
- Operating System: {{system.os}}
- Current Directory: {{project.cwd}}
- Git Branch: {{git.branch}}

## Available Tools
{{tools.descriptions}}

## Guidelines
- Be helpful and accurate in your responses
- Use the available tools to assist with coding tasks
- Always verify your recommendations when possible

Current session started at {{session.startTime}}.`;
  }
}