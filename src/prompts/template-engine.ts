// ABOUTME: Core template engine for prompt variable substitution and includes
// ABOUTME: Implements simple {{variable}} substitution and {{include:file.md}} functionality

import { PromptVariableProvider, PromptVariables } from './types.js';
import { logger } from '../utils/logger.js';

type FileLoader = Map<string, string> | ((path: string) => string | undefined);

export class PromptTemplateEngine {
  /**
   * Render template with provided variables
   */
  render(template: string, variables: PromptVariables): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, varPath) => {
      const value = this._resolveVariable(variables, varPath.trim());
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Render template using variable providers
   */
  renderWithProviders(template: string, providers: PromptVariableProvider[]): string {
    const mergedVariables = this._mergeProviderVariables(providers);
    return this.render(template, mergedVariables);
  }

  /**
   * Resolve variable path (supports dot notation like model.id)
   */
  private _resolveVariable(variables: PromptVariables, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = variables;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Merge variables from multiple providers (later providers override earlier ones)
   */
  private _mergeProviderVariables(providers: PromptVariableProvider[]): PromptVariables {
    const merged: PromptVariables = {};

    for (const provider of providers) {
      try {
        const vars = provider.getVariables();
        Object.assign(merged, vars);
      } catch (error) {
        logger.warn('Error getting variables from provider', {
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with other providers
      }
    }

    return merged;
  }

  /**
   * Render template with includes (testing interface with mock file system)
   */
  renderWithIncludes(template: string, fileLoader: FileLoader): string {
    return this._processIncludes(template, fileLoader, new Set());
  }

  /**
   * Render template with both includes and variable substitution
   */
  renderWithIncludesAndVariables(template: string, fileLoader: FileLoader, variables: PromptVariables): string {
    // First process includes, then variables
    const withIncludes = this.renderWithIncludes(template, fileLoader);
    return this.render(withIncludes, variables);
  }

  /**
   * Process include directives recursively
   */
  private _processIncludes(template: string, fileLoader: FileLoader, processedFiles: Set<string>, maxDepth: number = 10): string {
    if (maxDepth <= 0) {
      logger.warn('Maximum include depth reached, stopping recursion');
      return template;
    }

    return template.replace(/\{\{include:([^}]+)\}\}/g, (match, filePath) => {
      const trimmedPath = filePath.trim();
      
      // Prevent infinite recursion
      if (processedFiles.has(trimmedPath)) {
        logger.warn('Circular include detected, skipping', { filePath: trimmedPath });
        return match;
      }

      // Load file content
      let content: string | undefined;
      if (fileLoader instanceof Map) {
        content = fileLoader.get(trimmedPath);
      } else {
        content = fileLoader(trimmedPath);
      }

      if (content === undefined) {
        logger.debug('Include file not found, leaving directive unchanged', { filePath: trimmedPath });
        return match;
      }

      // Track this file to prevent recursion
      const newProcessedFiles = new Set(processedFiles);
      newProcessedFiles.add(trimmedPath);

      // Recursively process includes in the loaded content
      return this._processIncludes(content, fileLoader, newProcessedFiles, maxDepth - 1);
    });
  }
}