// ABOUTME: Type definitions for prompt template system
// ABOUTME: Defines interfaces for variable providers and template variables

export interface PromptVariableProvider {
  /**
   * Get variables from this provider
   * Should return an object with string keys and values that can be converted to strings
   */
  getVariables(): Record<string, unknown>;
}

export interface PromptVariables {
  [key: string]: unknown;
}

export interface TemplateContext {
  /**
   * Base directory for resolving include paths
   */
  baseDir: string;
  
  /**
   * Variable providers to use for substitution
   */
  providers: PromptVariableProvider[];
}