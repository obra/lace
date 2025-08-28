// ABOUTME: Template engine for system prompts using mustache with include functionality
// ABOUTME: Handles variable substitution and template includes with error handling and fallbacks

import * as fs from 'fs';
import * as path from 'path';
import mustache from 'mustache';
import { logger } from '~/utils/logger';
import { loadFileFromEmbeddedOrFilesystem } from '~/utils/resource-resolver';

export interface TemplateContext {
  [key: string]: unknown;
}

export class TemplateEngine {
  private readonly templateDirs: string[];
  private readonly processedIncludes = new Set<string>();

  constructor(templateDirs: string | string[]) {
    this.templateDirs = Array.isArray(templateDirs) ? templateDirs : [templateDirs];
  }

  /**
   * Render a template with the provided context
   */
  render(templatePath: string, context: TemplateContext): string {
    try {
      this.processedIncludes.clear();
      const templateContent = this.loadTemplateSync(templatePath);
      const processedContent = this.processIncludes(templateContent, path.dirname(templatePath));
      return mustache.render(processedContent, context);
    } catch (error) {
      logger.error('Failed to render template', {
        templatePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.getFallbackContent(templatePath);
    }
  }

  /**
   * Load template content from embedded files or file system (synchronous)
   */
  private loadTemplateSync(templatePath: string): string {
    // First try embedded files - check for the template path directly
    try {
      if (typeof Bun !== 'undefined' && Bun.embeddedFiles) {
        const targetPath = `packages/core/src/config/prompts/${templatePath}`;
        
        for (const file of Bun.embeddedFiles) {
          if (file.name.endsWith(targetPath)) {
            logger.debug('Loading template from embedded files', { templatePath, embeddedName: file.name });
            // For embedded files, try reading with Node's sync fs
            // The embedded files are accessible as regular file paths in Bun executables
            try {
              const content = fs.readFileSync(file.name, 'utf-8');
              return content;
            } catch (fileError) {
              logger.debug('Failed to read embedded file', { fileName: file.name, error: String(fileError) });
              // Continue to try other files
            }
          }
        }
      }
    } catch (e) {
      logger.debug('Embedded template load failed, falling back to file system', { templatePath, error: String(e) });
    }

    // Fallback to file system approach (development)
    for (const templateDir of this.templateDirs) {
      const fullPath = path.resolve(templateDir, templatePath);

      if (fs.existsSync(fullPath)) {
        logger.debug('Loading template from file system', { templatePath, templateDir });
        return fs.readFileSync(fullPath, 'utf-8');
      }
    }

    throw new Error(`Template file not found in embedded files or directories: ${templatePath}`);
  }

  /**
   * Process {{include:file.md}} directives with recursion protection
   */
  private processIncludes(content: string, currentDir: string): string {
    const includeRegex = /\{\{include:([^}]+)\}\}/g;

    return content.replace(includeRegex, (match, includePath: string) => {
      // Try to find the include file in any of the template directories
      let foundPath: string | null = null;
      let foundTemplateDir = '';

      for (const templateDir of this.templateDirs) {
        const fullIncludePath = path.resolve(templateDir, currentDir, includePath);
        const normalizedPath = path.normalize(fullIncludePath);

        if (fs.existsSync(normalizedPath)) {
          foundPath = normalizedPath;
          foundTemplateDir = templateDir;
          break;
        }
      }

      if (!foundPath) {
        logger.warn('Include file not found', { includePath, searchedDirs: this.templateDirs });
        return `<!-- Include not found: ${includePath} -->`;
      }

      // Prevent infinite recursion
      if (this.processedIncludes.has(foundPath)) {
        logger.warn('Circular include detected', { includePath, foundPath });
        return `<!-- Circular include: ${includePath} -->`;
      }

      try {
        this.processedIncludes.add(foundPath);

        const includeContent = fs.readFileSync(foundPath, 'utf-8');
        const includeDir = path.dirname(path.relative(foundTemplateDir, foundPath));

        // Recursively process includes in the included content
        return this.processIncludes(includeContent, includeDir);
      } catch (error) {
        logger.error('Failed to process include', {
          includePath,
          foundPath,
          error: error instanceof Error ? error.message : String(error),
        });
        return `<!-- Include error: ${includePath} -->`;
      } finally {
        this.processedIncludes.delete(foundPath);
      }
    });
  }

  /**
   * Get fallback content when template processing fails
   */
  private getFallbackContent(templatePath: string): string {
    logger.warn('Using fallback content for template', { templatePath });
    return 'You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.';
  }
}
