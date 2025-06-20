// ABOUTME: Configuration management for system and user prompts
// ABOUTME: Handles template system integration with fallback to legacy prompt files

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir, ensureLaceDir } from './lace-dir.js';
import { PromptManager } from './prompt-manager.js';
import { logger } from '../utils/logger.js';

export interface PromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

export interface PromptOptions {
  tools?: Array<{ name: string; description: string }>;
  useTemplateSystem?: boolean;
}

// Default system prompt - fallback when template system is not available
const DEFAULT_SYSTEM_PROMPT = `You are Lace, an AI coding assistant. Use the available tools to help with programming tasks.`;

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
 * Load the system prompt using template system if available, otherwise fallback to legacy files
 */
export async function loadPromptConfig(options: PromptOptions = {}): Promise<PromptConfig> {
  const filesCreated: string[] = [];

  try {
    // Try template system first if explicitly requested or if tools are provided
    if (options.useTemplateSystem !== false && (options.useTemplateSystem || options.tools)) {
      logger.debug('Attempting to use template system for prompt generation');
      
      const promptManager = new PromptManager({ tools: options.tools });
      
      if (promptManager.isTemplateSystemAvailable()) {
        const systemPrompt = await promptManager.generateSystemPrompt();
        const userInstructions = await loadUserInstructions();
        
        logger.info('Using template system for prompt generation');
        return {
          systemPrompt,
          userInstructions: userInstructions.content,
          filesCreated: userInstructions.wasCreated ? [getUserInstructionsPath()] : [],
        };
      } else {
        logger.warn('Template system requested but templates not available, falling back to legacy system');
      }
    }

    // Fallback to legacy file-based system
    logger.debug('Using legacy file-based prompt system');
    return loadLegacyPromptConfig();

  } catch (error) {
    logger.error('Error loading prompt config, falling back to legacy system', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    return loadLegacyPromptConfig();
  }
}

/**
 * Load prompt config using the legacy file-based system
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
 * Load user instructions (always from file, not templated)
 */
function loadUserInstructions(): { content: string; wasCreated: boolean } {
  const userInstructionsPath = getUserInstructionsPath();
  return readPromptFile(userInstructionsPath, DEFAULT_USER_INSTRUCTIONS);
}

/**
 * Get user instructions file path
 */
function getUserInstructionsPath(): string {
  const laceDir = ensureLaceDir();
  return path.join(laceDir, 'instructions.md');
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
