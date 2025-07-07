// ABOUTME: Orchestrates template engine and variable providers for system prompt generation
// ABOUTME: Handles template loading, variable provision, and rendering with fallbacks

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TemplateEngine } from '~/config/template-engine.js';
import {
  VariableProviderManager,
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  ContextDisclaimerProvider,
} from '~/config/variable-providers.js';
import { getLaceDir } from '~/config/lace-dir.js';
import { logger } from '~/utils/logger.js';

export interface PromptManagerOptions {
  tools?: Array<{ name: string; description: string }>;
  templateDirs?: string[];
}

export class PromptManager {
  private templateEngine: TemplateEngine;
  private variableManager: VariableProviderManager;
  private templateDirs: string[];

  constructor(options: PromptManagerOptions = {}) {
    // Set up template directories with user overlay support
    this.templateDirs = options.templateDirs || this.getTemplateDirsWithOverlay();

    this.templateEngine = new TemplateEngine(this.templateDirs);
    this.variableManager = new VariableProviderManager();

    // Add default variable providers
    this.variableManager.addProvider(new SystemVariableProvider());
    this.variableManager.addProvider(new GitVariableProvider());
    this.variableManager.addProvider(new ProjectVariableProvider());
    this.variableManager.addProvider(new ContextDisclaimerProvider());

    // Add tool provider if tools are provided
    if (options.tools && options.tools.length > 0) {
      this.variableManager.addProvider(new ToolVariableProvider(options.tools));
    }

    logger.debug('PromptManager initialized with template directories', {
      templateDirs: this.templateDirs,
    });
  }

  /**
   * Generate the system prompt using template system
   */
  async generateSystemPrompt(): Promise<string> {
    try {
      logger.debug('Generating system prompt using template system');

      const context = await this.variableManager.getTemplateContext();
      const prompt = this.templateEngine.render('system.md', context);

      logger.debug('System prompt generated successfully', {
        contextKeys: Object.keys(context),
        promptLength: prompt.length,
      });

      return prompt;
    } catch (error) {
      logger.error('Failed to generate system prompt', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getFallbackPrompt();
    }
  }

  /**
   * Get template directories with user overlay support
   * User templates take priority over embedded templates
   */
  private getTemplateDirsWithOverlay(): string[] {
    const userTemplateDir = this.getUserTemplateDir();
    const embeddedTemplateDir = this.getEmbeddedTemplateDir();

    return [userTemplateDir, embeddedTemplateDir];
  }

  /**
   * Get the user template directory path
   */
  private getUserTemplateDir(): string {
    const laceDir = getLaceDir();
    return path.join(laceDir, 'prompts');
  }

  /**
   * Get the embedded template directory path
   */
  private getEmbeddedTemplateDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.join(currentDir, 'prompts');
  }

  /**
   * Fallback prompt when template system fails
   */
  private getFallbackPrompt(): string {
    return 'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.';
  }

  /**
   * Check if template system is available
   */
  isTemplateSystemAvailable(): boolean {
    try {
      // Check if system.md exists in any of the configured template directories
      for (const templateDir of this.templateDirs) {
        const systemTemplatePath = path.join(templateDir, 'system.md');
        if (fs.existsSync(systemTemplatePath)) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }
}
