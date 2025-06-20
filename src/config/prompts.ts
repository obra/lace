// ABOUTME: Configuration management for system and user prompts
// ABOUTME: Handles reading/writing prompt files from LACE_DIR with auto-creation and defaults
// ABOUTME: Now supports both legacy static prompts and new template-based prompts

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir, ensureLaceDir } from './lace-dir.js';
import { loadTemplatePromptConfig, TemplatePromptOptions } from '../prompts/template-prompts.js';
import { Tool } from '../tools/types.js';
import { PromptVariables } from '../prompts/types.js';

export interface PromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

// Default system prompt - used for legacy mode and fallback
const DEFAULT_SYSTEM_PROMPT = `You are a coding assistant. Use the bash tool to help with programming tasks.`;

// Default user instructions - empty by default
const DEFAULT_USER_INSTRUCTIONS = ``;

/**
 * Enhanced prompt config loading with optional template support
 */
export interface EnhancedPromptOptions {
  tools?: Tool[];
  workingDir?: string;
  model?: {
    id: string;
    provider: string;
  };
  additionalVariables?: PromptVariables;
  useTemplates?: boolean; // Default: auto-detect
}

/**
 * Load prompt configuration with support for both legacy and template modes
 * Automatically detects whether to use templates based on directory structure
 */
export function loadPromptConfig(options: EnhancedPromptOptions = {}): PromptConfig {
  const laceDir = ensureLaceDir();
  const promptsDir = path.join(laceDir, 'prompts');
  
  // Auto-detect template mode: use templates if prompts/ directory exists or tools are provided
  const shouldUseTemplates = options.useTemplates ?? 
    (fs.existsSync(promptsDir) || (options.tools && options.tools.length > 0));

  if (shouldUseTemplates) {
    // Use new template-based system
    const templateOptions: TemplatePromptOptions = {
      laceDir,
      workingDir: options.workingDir || process.cwd(),
      tools: options.tools || [],
      model: options.model,
      additionalVariables: options.additionalVariables
    };

    return loadTemplatePromptConfig(templateOptions);
  } else {
    // Use legacy static file system for backward compatibility
    return loadLegacyPromptConfig();
  }
}

/**
 * Legacy prompt loading function (preserves existing behavior)
 */
function loadLegacyPromptConfig(): PromptConfig {
  const laceDir = ensureLaceDir();

  const systemPromptPath = path.join(laceDir, 'system-prompt.md');
  const userInstructionsPath = path.join(laceDir, 'instructions.md');

  const systemPromptResult = readPromptFile(systemPromptPath, DEFAULT_SYSTEM_PROMPT);
  const userInstructionsResult = readPromptFile(userInstructionsPath, DEFAULT_USER_INSTRUCTIONS);

  const filesCreated: string[] = [];
  if (systemPromptResult.wasCreated) {
    filesCreated.push(systemPromptPath);
  }
  if (userInstructionsResult.wasCreated) {
    filesCreated.push(userInstructionsPath);
  }

  return {
    systemPrompt: systemPromptResult.content.trim(),
    userInstructions: userInstructionsResult.content.trim(),
    filesCreated,
  };
}

/**
 * Read a prompt file, creating it with default content if it doesn't exist
 * Returns both the content and whether the file was newly created
 */
function readPromptFile(
  filePath: string,
  defaultContent: string
): { content: string; wasCreated: boolean } {
  try {
    if (fs.existsSync(filePath)) {
      return {
        content: fs.readFileSync(filePath, 'utf-8'),
        wasCreated: false,
      };
    } else {
      // File doesn't exist, create it with default content
      fs.writeFileSync(filePath, defaultContent, 'utf-8');
      return {
        content: defaultContent,
        wasCreated: true,
      };
    }
  } catch (error) {
    throw new Error(
      `Failed to read/create prompt file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the paths to the prompt configuration files
 * Useful for telling users where to edit their prompts
 */
export function getPromptFilePaths(): { systemPromptPath: string; userInstructionsPath: string } {
  const laceDir = getLaceDir();

  return {
    systemPromptPath: path.join(laceDir, 'system-prompt.md'),
    userInstructionsPath: path.join(laceDir, 'instructions.md'),
  };
}
