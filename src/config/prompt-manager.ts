// ABOUTME: Orchestrates template engine and variable providers for system prompt generation
// ABOUTME: Handles template loading, variable provision, and rendering with fallbacks

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { TemplateEngine } from './template-engine.js';
import { 
  VariableProviderManager, 
  SystemVariableProvider, 
  GitVariableProvider, 
  ProjectVariableProvider, 
  ToolVariableProvider,
  ContextDisclaimerProvider 
} from './variable-providers.js';
import { logger } from '../utils/logger.js';

export interface PromptManagerOptions {
  tools?: Array<{ name: string; description: string }>;
  templateDir?: string;
}

export class PromptManager {
  private templateEngine: TemplateEngine;
  private variableManager: VariableProviderManager;

  constructor(options: PromptManagerOptions = {}) {
    // Determine template directory (embedded or external)
    const templateDir = options.templateDir || this.getEmbeddedTemplateDir();
    
    this.templateEngine = new TemplateEngine(templateDir);
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
        promptLength: prompt.length 
      });
      
      return prompt;
    } catch (error) {
      logger.error('Failed to generate system prompt', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return this.getFallbackPrompt();
    }
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
      const templateDir = this.getEmbeddedTemplateDir();
      const systemTemplatePath = path.join(templateDir, 'system.md');
      return fs.existsSync(systemTemplatePath);
    } catch {
      return false;
    }
  }
}