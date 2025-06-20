// ABOUTME: Main exports for the prompt template system
// ABOUTME: Provides public API for template-based prompt management

export { PromptTemplateEngine } from './template-engine.js';
export { PromptManager } from './prompt-manager.js';
export { loadTemplatePromptConfig } from './template-prompts.js';

// Variable providers
export { SystemVariableProvider } from './variable-providers/system.js';
export { GitVariableProvider } from './variable-providers/git.js';
export { ProjectVariableProvider } from './variable-providers/project.js';
export { ToolVariableProvider } from './variable-providers/tool.js';

// Types
export type { 
  PromptVariableProvider, 
  PromptVariables, 
  TemplateContext 
} from './types.js';

export type { 
  TemplatePromptConfig, 
  TemplatePromptOptions 
} from './template-prompts.js';

export type { 
  PromptManagerOptions 
} from './prompt-manager.js';

export type { 
  ProjectVariableOptions 
} from './variable-providers/project.js';