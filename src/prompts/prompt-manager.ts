// ABOUTME: Main prompt manager that orchestrates template engine and variable providers
// ABOUTME: Handles loading templates from files and rendering them with dynamic context

import * as fs from 'fs';
import * as path from 'path';
import { PromptTemplateEngine } from './template-engine.js';
import { 
  PromptVariableManager,
  SystemVariableProvider,
  GitVariableProvider,
  ProjectVariableProvider,
  ToolVariableProvider
} from './variable-providers.js';
import { Tool } from '../tools/types.js';

export interface PromptContext {
  tools?: Tool[];
  model?: { id: string; provider: string };
}

export class PromptManager {
  private templateEngine: PromptTemplateEngine;
  private variableManager: PromptVariableManager;
  
  constructor() {
    this.templateEngine = new PromptTemplateEngine();
    this.variableManager = new PromptVariableManager();
    
    // Add core variable providers
    this.variableManager.addProvider(new SystemVariableProvider());
    this.variableManager.addProvider(new GitVariableProvider());
    this.variableManager.addProvider(new ProjectVariableProvider());
  }
  
  /**
   * Generate system prompt from template file with dynamic context
   */
  generateSystemPrompt(templatePath: string, context: PromptContext = {}): string {
    // Add context-specific providers
    if (context.tools) {
      this.variableManager.addProvider(new ToolVariableProvider(context.tools));
    }
    
    // Add model variables if provided
    const additionalVariables: Record<string, string> = {};
    if (context.model) {
      additionalVariables['model.id'] = context.model.id;
      additionalVariables['model.provider'] = context.model.provider;
    }
    
    // Load template file
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    
    const template = fs.readFileSync(templatePath, 'utf-8');
    const baseDir = path.dirname(templatePath);
    
    // Get all variables and merge with additional ones
    const variables = {
      ...this.variableManager.getAllVariables(),
      ...additionalVariables
    };
    
    // Render template
    return this.templateEngine.render(template, variables, baseDir);
  }
  
  /**
   * Check if a path uses templates (contains template syntax)
   */
  isTemplate(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes('{{') && content.includes('}}');
  }
  
  /**
   * Load and render a template, or return static content if not a template
   */
  loadPrompt(filePath: string, context: PromptContext = {}): string {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt file not found: ${filePath}`);
    }
    
    if (this.isTemplate(filePath)) {
      return this.generateSystemPrompt(filePath, context);
    } else {
      // Static file, just read it
      return fs.readFileSync(filePath, 'utf-8');
    }
  }
}