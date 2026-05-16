// ABOUTME: Orchestrates template engine and variable providers for system prompt generation
// ABOUTME: Handles template loading, variable provision, and rendering with fallbacks

import * as fs from 'fs';
import * as path from 'path';
import { TemplateEngine } from './template-engine';
import {
  VariableProviderManager,
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  ContextDisclaimerProvider,
} from './variable-providers';
import { personaRegistry as defaultPersonaRegistry, PersonaRegistry } from './persona-registry';
import { logger } from '@lace/agent/utils/logger';
import type { SkillRegistry } from '@lace/agent/skills';
import { SkillVariableProvider } from '@lace/agent/skills';

interface PromptManagerOptions {
  tools?: Array<{ name: string; description: string }>;
  templateDirs?: string[];
  session?: { getWorkingDirectory(): string };
  project?: { getWorkingDirectory(): string };
  skillRegistry?: SkillRegistry;
  personaRegistry?: PersonaRegistry;
}

export class PromptManager {
  private templateEngine: TemplateEngine;
  private variableManager: VariableProviderManager;
  private templateDirs: string[];
  private personaRegistry: PersonaRegistry;

  constructor(options: PromptManagerOptions = {}) {
    this.personaRegistry = options.personaRegistry ?? defaultPersonaRegistry;
    // Set up template directories with user overlay support
    this.templateDirs = options.templateDirs || this.getTemplateDirsWithOverlay();

    this.templateEngine = new TemplateEngine(this.templateDirs);
    this.variableManager = new VariableProviderManager();

    // Add default variable providers
    this.variableManager.addProvider(new SystemVariableProvider());
    this.variableManager.addProvider(new GitVariableProvider());
    this.variableManager.addProvider(new ProjectVariableProvider(options.session, options.project));
    this.variableManager.addProvider(new ContextDisclaimerProvider());

    // Add tool provider if tools are provided
    if (options.tools && options.tools.length > 0) {
      this.variableManager.addProvider(new ToolVariableProvider(options.tools));
    }

    // Add skill provider if skill registry is provided
    if (options.skillRegistry) {
      this.variableManager.addProvider(new SkillVariableProvider(options.skillRegistry));
    }

    logger.debug('PromptManager initialized with template directories', {
      templateDirs: this.templateDirs,
    });
  }

  /**
   * Generate the system prompt using template system for specified persona (defaults to 'lace')
   */
  async generateSystemPrompt(persona: string = 'lace'): Promise<string> {
    try {
      logger.debug('Generating system prompt using template system', { persona });

      // Validate persona exists
      this.personaRegistry.validatePersona(persona);

      // Get persona template path
      const personaPath = this.personaRegistry.getPersonaPath(persona);
      if (!personaPath) {
        throw new Error(`Persona '${persona}' not found`);
      }

      const context = await this.variableManager.getTemplateContext();
      const prompt = this.templateEngine.render(`${persona}.md`, context);

      logger.debug('System prompt generated successfully', {
        persona,
        contextKeys: Object.keys(context),
        promptLength: prompt.length,
      });

      return prompt;
    } catch (error) {
      logger.error('Failed to generate system prompt', {
        persona,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getFallbackPrompt();
    }
  }

  /**
   * Get template directories with user overlay support.
   * Source of truth is the persona registry: its userPersonasPaths come first
   * (earlier wins) and the bundled path serves as the embedded overlay.
   */
  private getTemplateDirsWithOverlay(): string[] {
    return [
      ...this.personaRegistry.getUserPersonasPaths(),
      this.personaRegistry.getBundledPersonasPath(),
    ];
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
      // Check embedded first (Bun executable)
      if (typeof Bun !== 'undefined' && 'embeddedFiles' in Bun && Bun.embeddedFiles) {
        for (const f of Bun.embeddedFiles) {
          if ((f as File).name.endsWith('/agent-personas/lace.md')) return true;
        }
      }
      // Fallback: check file system (dev)
      for (const templateDir of this.templateDirs) {
        const systemTemplatePath = path.join(templateDir, 'lace.md');
        if (fs.existsSync(systemTemplatePath)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
