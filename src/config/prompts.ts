// ABOUTME: Configuration management for system and user prompts
// ABOUTME: Uses template system for system prompts and file-based user instructions

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir, ensureLaceDir } from '~/config/lace-dir.js';
import { PromptManager } from '~/config/prompt-manager.js';
import { logger } from '~/utils/logger.js';

export interface PromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

export interface PromptOptions {
  tools?: Array<{ name: string; description: string }>;
}

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
 * Load the system prompt using the template system
 */
export async function loadPromptConfig(options: PromptOptions = {}): Promise<PromptConfig> {
  logger.debug('Loading prompt config using template system');

  const promptManager = new PromptManager({ tools: options.tools });
  const systemPrompt = await promptManager.generateSystemPrompt();
  const userInstructions = await loadUserInstructions();

  logger.info('Loaded prompt config using template system');
  return {
    systemPrompt,
    userInstructions: userInstructions.content.trim(),
    filesCreated: userInstructions.wasCreated ? [getUserInstructionsPath()] : [],
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
 * Get the path to the user instructions file
 * System prompts are generated from templates and not file-based
 */
export function getUserInstructionsFilePath(): string {
  const laceDir = getLaceDir();
  return path.join(laceDir, 'instructions.md');
}
