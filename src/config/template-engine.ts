// ABOUTME: Template engine using mustache for system prompt rendering
// ABOUTME: Handles variable substitution and include resolution with error handling

import * as fs from 'fs';
import * as path from 'path';
import * as mustache from 'mustache';
import { logger } from '../utils/logger.js';

export interface TemplateContext {
  [key: string]: unknown;
}

export class TemplateEngine {
  private _templateDir: string;
  private _processedIncludes = new Set<string>();

  constructor(templateDir: string) {
    this._templateDir = templateDir;
  }

  /**
   * Render a template file with the given context
   */
  render(templatePath: string, context: TemplateContext): string {
    try {
      const fullPath = path.isAbsolute(templatePath) 
        ? templatePath 
        : path.join(this._templateDir, templatePath);

      if (!fs.existsSync(fullPath)) {
        logger.warn('Template file not found, using empty content', { templatePath: fullPath });
        return '';
      }

      const template = fs.readFileSync(fullPath, 'utf-8');
      
      // Clear include tracking for this render
      this._processedIncludes.clear();
      
      const processed = this._processIncludes(template, path.dirname(fullPath));
      return mustache.render(processed, context);
    } catch (error) {
      logger.error('Template rendering failed', { 
        templatePath, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return '';
    }
  }

  /**
   * Process {{include:filename}} directives recursively
   */
  private _processIncludes(template: string, basePath: string): string {
    const includePattern = /\{\{include:([^}]+)\}\}/g;
    
    return template.replace(includePattern, (match, filename) => {
      const includePath = path.resolve(basePath, filename);
      
      // Prevent infinite recursion
      if (this._processedIncludes.has(includePath)) {
        logger.warn('Circular include detected, skipping', { includePath });
        return '';
      }
      
      if (!fs.existsSync(includePath)) {
        logger.warn('Include file not found', { includePath });
        return '';
      }
      
      try {
        this._processedIncludes.add(includePath);
        const includeContent = fs.readFileSync(includePath, 'utf-8');
        
        // Recursively process includes in the included file
        return this._processIncludes(includeContent, path.dirname(includePath));
      } catch (error) {
        logger.error('Failed to process include', { 
          includePath, 
          error: error instanceof Error ? error.message : String(error) 
        });
        return '';
      }
    });
  }
}