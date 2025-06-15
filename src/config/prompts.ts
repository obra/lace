// ABOUTME: Configuration management for system and user prompts
// ABOUTME: Handles reading/writing prompt files from LACE_DIR with auto-creation and defaults

import * as fs from 'fs';
import * as path from 'path';
import { getLaceDir, ensureLaceDir } from './lace-dir';

export interface PromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

// Default system prompt - extracted from current hardcoded value
const DEFAULT_SYSTEM_PROMPT = `You are a coding assistant. Use the bash tool to help with programming tasks.`;

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
 */
export function loadPromptConfig(): PromptConfig {
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
