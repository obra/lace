// ABOUTME: Simple template engine for prompt templates with variable substitution and includes
// ABOUTME: Supports {{variable}} syntax and {{include:file.md}} for composable prompts

import * as fs from 'fs';
import * as path from 'path';

export interface TemplateEngine {
  render(template: string, variables: Record<string, string>, baseDir?: string): string;
}

export class PromptTemplateEngine implements TemplateEngine {
  private _includeCache = new Map<string, string>();
  private _includeStack = new Set<string>(); // Prevent circular includes

  render(template: string, variables: Record<string, string>, baseDir?: string): string {
    // First, resolve includes
    const withIncludes = this._resolveIncludes(template, baseDir || '');
    
    // Then substitute variables
    return this._substituteVariables(withIncludes, variables);
  }

  private _resolveIncludes(template: string, baseDir: string): string {
    const includeRegex = /\{\{include:([^}]+)\}\}/g;
    
    return template.replace(includeRegex, (match, filename) => {
      const fullPath = path.resolve(baseDir, filename);
      
      // Check for circular includes
      if (this._includeStack.has(fullPath)) {
        throw new Error(`Circular include detected: ${filename}`);
      }
      
      // Check cache first
      if (this._includeCache.has(fullPath)) {
        return this._includeCache.get(fullPath)!;
      }
      
      try {
        if (!fs.existsSync(fullPath)) {
          throw new Error(`Include file not found: ${filename}`);
        }
        
        this._includeStack.add(fullPath);
        const content = fs.readFileSync(fullPath, 'utf-8');
        
        // Recursively resolve includes in the included file
        const resolvedContent = this._resolveIncludes(content, path.dirname(fullPath));
        
        this._includeStack.delete(fullPath);
        this._includeCache.set(fullPath, resolvedContent);
        
        return resolvedContent;
      } catch (error) {
        this._includeStack.delete(fullPath);
        throw new Error(`Failed to include ${filename}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private _substituteVariables(template: string, variables: Record<string, string>): string {
    const variableRegex = /\{\{([^}]+)\}\}/g;
    
    return template.replace(variableRegex, (match, varName) => {
      const trimmedVarName = varName.trim();
      
      // Support dot notation for nested variables
      if (trimmedVarName.includes('.')) {
        return this._getNestedVariable(trimmedVarName, variables) || match;
      }
      
      return variables[trimmedVarName] || match;
    });
  }

  private _getNestedVariable(varPath: string, variables: Record<string, string>): string | undefined {
    const parts = varPath.split('.');
    let current: any = variables;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return typeof current === 'string' ? current : String(current);
  }

  clearCache(): void {
    this._includeCache.clear();
  }
}