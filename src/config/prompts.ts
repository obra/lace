// ABOUTME: Configuration management for system and user prompts
// ABOUTME: Enhanced with template system support, handles both static and dynamic prompts

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir, ensureLaceDir } from './lace-dir.js';
import { PromptManager, PromptContext } from '../prompts/prompt-manager.js';
import { Tool } from '../tools/types.js';

export interface PromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

export interface EnhancedPromptConfig {
  getSystemPrompt(context?: PromptContext): string;
  userInstructions: string;
  filesCreated: string[];
  isTemplateMode: boolean;
}

// Fallback system prompt for when templates aren't available
const FALLBACK_SYSTEM_PROMPT = `You are a coding assistant. Use the available tools to help with programming tasks.`;

// Default user instructions - empty by default
const DEFAULT_USER_INSTRUCTIONS = ``;

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
 * Load the system prompt and user instructions from configuration files
 * Auto-creates files with defaults if they don't exist
 * @deprecated Use loadEnhancedPromptConfig for template support
 */
export function loadPromptConfig(): PromptConfig {
  const laceDir = ensureLaceDir();

  const systemPromptPath = path.join(laceDir, 'system-prompt.md');
  const userInstructionsPath = path.join(laceDir, 'instructions.md');

  const systemPromptResult = readPromptFile(systemPromptPath, FALLBACK_SYSTEM_PROMPT);
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
 * Load enhanced prompt configuration with template support
 * Attempts to use template system first, falls back to static files
 */
export function loadEnhancedPromptConfig(): EnhancedPromptConfig {
  const laceDir = ensureLaceDir();
  const userInstructionsPath = path.join(laceDir, 'instructions.md');
  
  // Check for default template system
  const defaultTemplatePath = path.resolve(process.cwd(), 'prompts', 'system.md');
  const userTemplatePath = path.join(laceDir, 'system-prompt.md');
  
  const filesCreated: string[] = [];
  let isTemplateMode = false;
  let promptManager: PromptManager | null = null;
  let systemPromptSource = '';
  
  // Try template system first (user's custom template, then default template)
  if (fs.existsSync(userTemplatePath)) {
    try {
      promptManager = new PromptManager();
      if (promptManager.isTemplate(userTemplatePath)) {
        systemPromptSource = userTemplatePath;
        isTemplateMode = true;
      }
    } catch (error) {
      console.warn(`Failed to load user template: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  if (!isTemplateMode && fs.existsSync(defaultTemplatePath)) {
    try {
      promptManager = new PromptManager();
      systemPromptSource = defaultTemplatePath;
      isTemplateMode = true;
    } catch (error) {
      console.warn(`Failed to load default template: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Fallback to static system
  if (!isTemplateMode) {
    const staticResult = readPromptFile(userTemplatePath, FALLBACK_SYSTEM_PROMPT);
    if (staticResult.wasCreated) {
      filesCreated.push(userTemplatePath);
    }
    systemPromptSource = staticResult.content;
  }
  
  // Load user instructions
  const userInstructionsResult = readPromptFile(userInstructionsPath, DEFAULT_USER_INSTRUCTIONS);
  if (userInstructionsResult.wasCreated) {
    filesCreated.push(userInstructionsPath);
  }
  
  return {
    getSystemPrompt: (context?: PromptContext) => {
      if (isTemplateMode && promptManager) {
        try {
          return promptManager.loadPrompt(systemPromptSource, context || {});
        } catch (error) {
          console.warn(`Template rendering failed: ${error instanceof Error ? error.message : String(error)}`);
          return FALLBACK_SYSTEM_PROMPT;
        }
      } else {
        return systemPromptSource;
      }
    },
    userInstructions: userInstructionsResult.content.trim(),
    filesCreated,
    isTemplateMode,
  };
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
