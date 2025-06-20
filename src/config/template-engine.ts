// ABOUTME: Template engine for system prompts using mustache with include functionality
// ABOUTME: Handles variable substitution and template includes with error handling and fallbacks

import * as fs from 'fs';
import * as path from 'path';
import mustache from 'mustache';
import { logger } from '../utils/logger.js';

export interface TemplateContext {
  [key: string]: any;
}

export class TemplateEngine {
  private readonly templateDir: string;
  private readonly processedIncludes = new Set<string>();

  constructor(templateDir: string) {
    this.templateDir = templateDir;
  }

  /**
   * Render a template with the provided context
   */
  render(templatePath: string, context: TemplateContext): string {
    try {
      this.processedIncludes.clear();
      const templateContent = this.loadTemplate(templatePath);
      const processedContent = this.processIncludes(templateContent, path.dirname(templatePath));
      return mustache.render(processedContent, context);
    } catch (error) {
      logger.error('Failed to render template', { templatePath, error: error instanceof Error ? error.message : String(error) });
      return this.getFallbackContent(templatePath);
    }
  }

  /**
   * Load template content from file
   */
  private loadTemplate(templatePath: string): string {
    const fullPath = path.resolve(this.templateDir, templatePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Template file not found: ${fullPath}`);
    }

    return fs.readFileSync(fullPath, 'utf-8');
  }

  /**
   * Process {{include:file.md}} directives with recursion protection
   */
  private processIncludes(content: string, currentDir: string): string {
    const includeRegex = /\{\{include:([^}]+)\}\}/g;
    
    return content.replace(includeRegex, (match, includePath: string) => {
      const fullIncludePath = path.resolve(this.templateDir, currentDir, includePath);
      const normalizedPath = path.normalize(fullIncludePath);

      // Prevent infinite recursion
      if (this.processedIncludes.has(normalizedPath)) {
        logger.warn('Circular include detected', { includePath, normalizedPath });
        return `<!-- Circular include: ${includePath} -->`;
      }

      try {
        this.processedIncludes.add(normalizedPath);
        
        if (!fs.existsSync(normalizedPath)) {
          logger.warn('Include file not found', { includePath, normalizedPath });
          return `<!-- Include not found: ${includePath} -->`;
        }

        const includeContent = fs.readFileSync(normalizedPath, 'utf-8');
        const includeDir = path.dirname(path.relative(this.templateDir, normalizedPath));
        
        // Recursively process includes in the included content
        return this.processIncludes(includeContent, includeDir);
      } catch (error) {
        logger.error('Failed to process include', { 
          includePath, 
          normalizedPath, 
          error: error instanceof Error ? error.message : String(error) 
        });
        return `<!-- Include error: ${includePath} -->`;
      } finally {
        this.processedIncludes.delete(normalizedPath);
      }
    });
  }

  /**
   * Get fallback content when template processing fails
   */
  private getFallbackContent(templatePath: string): string {
    logger.warn('Using fallback content for template', { templatePath });
    return 'You are a coding assistant. Use the available tools to help with programming tasks.';
  }
}