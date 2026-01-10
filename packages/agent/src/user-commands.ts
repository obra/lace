// ABOUTME: Loads user-defined slash commands from ~/.lace/commands/ and .lace/commands/
// User commands are markdown files with YAML frontmatter containing name, description, and optional mode.

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface UserCommand {
  name: string;
  description: string;
  mode?:
    | 'ask'
    | 'approveReads'
    | 'approveEdits'
    | 'approve'
    | 'deny'
    | 'dangerouslySkipPermissions';
  body: string;
  source: 'user';
  filePath: string;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  source: 'builtin' | 'user';
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns the frontmatter object and the remaining body.
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};

  // Check for YAML frontmatter delimiter
  if (!content.startsWith('---')) {
    return { frontmatter, body: content };
  }

  // Find the closing delimiter
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter, body: content };
  }

  // Parse the frontmatter section
  const frontmatterSection = content.slice(4, endIndex).trim();
  const body = content.slice(endIndex + 4).trim();

  // Simple YAML parsing for key: value pairs
  for (const line of frontmatterSection.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Load user commands from a directory.
 * Returns an array of UserCommand objects.
 */
function loadCommandsFromDir(dir: string): UserCommand[] {
  const commands: UserCommand[] = [];

  if (!existsSync(dir)) {
    return commands;
  }

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;

      const filePath = join(dir, entry);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      try {
        const content = readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);

        // Require name and description
        const name = frontmatter.name;
        const description = frontmatter.description;

        if (!name || !description) {
          // Skip files without required fields
          continue;
        }

        // Validate mode if present
        const validModes = new Set([
          'ask',
          'approveReads',
          'approveEdits',
          'approve',
          'deny',
          'dangerouslySkipPermissions',
        ]);
        const mode =
          frontmatter.mode && validModes.has(frontmatter.mode)
            ? (frontmatter.mode as UserCommand['mode'])
            : undefined;

        commands.push({
          name,
          description,
          mode,
          body,
          source: 'user',
          filePath,
        });
      } catch {
        // Skip files that can't be read
        continue;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return commands;
}

/**
 * Load all user commands from global and project-local directories.
 * Project-local commands take precedence over global commands with the same name.
 *
 * @param workDir - The project working directory for project-local commands
 * @returns Array of user commands, with project-local taking precedence
 */
export function loadUserCommands(workDir?: string): UserCommand[] {
  const commandsByName = new Map<string, UserCommand>();

  // Load global commands first (~/.lace/commands/)
  const globalDir = join(homedir(), '.lace', 'commands');
  const globalCommands = loadCommandsFromDir(globalDir);
  for (const cmd of globalCommands) {
    commandsByName.set(cmd.name.toLowerCase(), cmd);
  }

  // Load project-local commands (overrides global)
  if (workDir) {
    const projectDir = join(workDir, '.lace', 'commands');
    const projectCommands = loadCommandsFromDir(projectDir);
    for (const cmd of projectCommands) {
      commandsByName.set(cmd.name.toLowerCase(), cmd);
    }
  }

  return Array.from(commandsByName.values());
}

/**
 * Find a user command by name.
 *
 * @param name - The command name (without leading /)
 * @param workDir - The project working directory for project-local commands
 * @returns The user command if found, undefined otherwise
 */
export function findUserCommand(name: string, workDir?: string): UserCommand | undefined {
  const commands = loadUserCommands(workDir);
  return commands.find((cmd) => cmd.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get slash command info for all user commands (for capabilities advertisement).
 *
 * @param workDir - The project working directory for project-local commands
 * @returns Array of slash command info objects
 */
export function getUserSlashCommands(workDir?: string): SlashCommandInfo[] {
  const commands = loadUserCommands(workDir);
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    source: 'user' as const,
  }));
}
