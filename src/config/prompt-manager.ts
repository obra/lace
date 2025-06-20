// ABOUTME: Prompt manager that orchestrates template engine and variable providers
// ABOUTME: Provides backward compatibility with existing prompt system

import * as fs from 'fs';
import * as path from 'path';
import { TemplateEngine, TemplateContext } from './template-engine.js';
import { 
  VariableProvider,
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider,
  ContextDisclaimerProvider
} from './variable-providers.js';
import { logger } from '../utils/logger.js';
import { getLaceDir } from './lace-dir.js';

export interface PromptManagerConfig {
  templateDir?: string;
  tools?: Array<{ name: string; description: string }>;
  model?: { id: string; provider: string };
}

export class PromptManager {
  private _templateEngine: TemplateEngine;
  private _providers: VariableProvider[];
  private _templateDir: string;

  constructor(config: PromptManagerConfig = {}) {
    this._templateDir = config.templateDir || path.join(getLaceDir(), 'prompts');
    this._templateEngine = new TemplateEngine(this._templateDir);
    
    // Initialize variable providers
    this._providers = [
      new SystemVariableProvider(),
      new GitVariableProvider(),
      new ProjectVariableProvider(),
      new ContextDisclaimerProvider(),
    ];

    // Add tool provider if tools are provided
    if (config.tools) {
      this._providers.push(new ToolVariableProvider(config.tools));
    }

    // Add model context if provided
    if (config.model) {
      this._providers.push({
        getVariables: () => ({ model: config.model })
      });
    }
  }

  /**
   * Generate system prompt using templates or fallback to simple file
   */
  generateSystemPrompt(): string {
    try {
      // Try template-based system first
      const templatePath = path.join(this._templateDir, 'system.md');
      
      if (fs.existsSync(templatePath)) {
        logger.debug('Using template-based system prompt', { templatePath });
        const context = this._buildContext();
        return this._templateEngine.render('system.md', context);
      }

      // Fallback to simple system-prompt.md file
      const simplePath = path.join(this._templateDir, 'system-prompt.md');
      if (fs.existsSync(simplePath)) {
        logger.debug('Using simple system prompt file', { simplePath });
        return fs.readFileSync(simplePath, 'utf-8').trim();
      }

      // Fallback to legacy location
      const legacyPath = path.join(getLaceDir(), 'system-prompt.md');
      if (fs.existsSync(legacyPath)) {
        logger.debug('Using legacy system prompt file', { legacyPath });
        return fs.readFileSync(legacyPath, 'utf-8').trim();
      }

      logger.warn('No system prompt template found, using default');
      return this._getDefaultSystemPrompt();

    } catch (error) {
      logger.error('Failed to generate system prompt', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return this._getDefaultSystemPrompt();
    }
  }

  /**
   * Generate user instructions using templates or fallback
   */
  generateUserInstructions(): string {
    try {
      // Try template-based instructions first
      const templatePath = path.join(this._templateDir, 'instructions.md');
      
      if (fs.existsSync(templatePath)) {
        logger.debug('Using template-based user instructions', { templatePath });
        const context = this._buildContext();
        return this._templateEngine.render('instructions.md', context);
      }

      // Fallback to legacy location
      const legacyPath = path.join(getLaceDir(), 'instructions.md');
      if (fs.existsSync(legacyPath)) {
        logger.debug('Using legacy user instructions file', { legacyPath });
        return fs.readFileSync(legacyPath, 'utf-8').trim();
      }

      return '';

    } catch (error) {
      logger.error('Failed to generate user instructions', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return '';
    }
  }

  /**
   * Initialize default template files if they don't exist
   */
  createDefaultTemplates(): string[] {
    const created: string[] = [];

    try {
      // Ensure template directory exists
      if (!fs.existsSync(this._templateDir)) {
        fs.mkdirSync(this._templateDir, { recursive: true });
      }

      // Create sections directory
      const sectionsDir = path.join(this._templateDir, 'sections');
      if (!fs.existsSync(sectionsDir)) {
        fs.mkdirSync(sectionsDir, { recursive: true });
      }

      // Create main system template
      const systemTemplate = path.join(this._templateDir, 'system.md');
      if (!fs.existsSync(systemTemplate)) {
        fs.writeFileSync(systemTemplate, this._getDefaultSystemTemplate());
        created.push(systemTemplate);
      }

      // Create template sections
      const sections = this._getDefaultTemplateSections();
      for (const [filename, content] of Object.entries(sections)) {
        const sectionPath = path.join(sectionsDir, filename);
        if (!fs.existsSync(sectionPath)) {
          fs.writeFileSync(sectionPath, content);
          created.push(sectionPath);
        }
      }

    } catch (error) {
      logger.error('Failed to create default templates', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    return created;
  }

  /**
   * Build template context from all providers
   */
  private _buildContext(): TemplateContext {
    const context: TemplateContext = {};

    for (const provider of this._providers) {
      try {
        const variables = provider.getVariables();
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

  private _getDefaultSystemPrompt(): string {
    return `You are a coding assistant. Use the bash tool to help with programming tasks.

{{context.disclaimer}}`;
  }

  private _getDefaultSystemTemplate(): string {
    return `{{include:sections/agent-personality.md}}

{{include:sections/environment.md}}

{{include:sections/tools.md}}

{{include:sections/guidelines.md}}

---

**Context Notice:** {{context.disclaimer}}`;
  }

  private _getDefaultTemplateSections(): Record<string, string> {
    return {
      'agent-personality.md': `# Agent Personality

You are a helpful coding assistant designed to help with software development tasks. You should be:
- Direct and concise in your responses
- Focused on practical solutions
- Careful about security and best practices
- Willing to ask clarifying questions when needed`,

      'environment.md': `# Environment Context

**System Information:**
- OS: {{system.os}} ({{system.arch}})
- Session started: {{session.startTime}}

**Project Context:**
- Working Directory: {{project.cwd}}
- Project Name: {{project.name}}
{{#project.configFiles}}
- Config Files: {{.}}
{{/project.configFiles}}

**Git Context:**
{{#git.branch}}
- Branch: {{git.branch}}
{{/git.branch}}
{{#git.user.name}}
- Git User: {{git.user.name}} <{{git.user.email}}>
{{/git.user.name}}`,

      'tools.md': `# Available Tools

{{#tools.count}}
You have access to {{tools.count}} tools:
{{#tools.list}}
- {{.}}
{{/tools.list}}
{{/tools.count}}

Use these tools to help with programming tasks, file operations, and system interactions.`,

      'guidelines.md': `# Coding Guidelines

- Follow existing code style and conventions
- Prefer editing existing files over creating new ones
- Use proper error handling and logging
- Ensure code is well-tested and documented
- Ask questions if requirements are unclear`,
    };
  }
}