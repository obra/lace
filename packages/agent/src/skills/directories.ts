// ABOUTME: Skill directory resolution with precedence ordering
// ABOUTME: Returns skill directories from project-level to user-level for shadowing

import os from 'os';
import { join } from 'path';

/**
 * Returns skill directories in precedence order (highest to lowest priority).
 *
 * Precedence order:
 * 1. <projectDir>/.lace/skills/ - Project-level lace skills
 * 2. <projectDir>/.claude/skills/ - Project-level claude skills
 * 3. ~/.lace/skills/ - User-level lace skills
 * 4. ~/.claude/skills/ - User-level claude skills
 *
 * If projectDir is undefined or empty, only user-level directories are returned.
 *
 * @param projectDir - The project directory path, or undefined/empty for user-only
 * @returns Array of skill directory paths in precedence order
 */
export function getSkillDirectories(projectDir: string | undefined): string[] {
  const homeDir = os.homedir();
  const directories: string[] = [];

  // Add project-level directories if projectDir is provided and non-empty
  if (projectDir && projectDir.length > 0) {
    directories.push(join(projectDir, '.lace', 'skills') + '/');
    directories.push(join(projectDir, '.claude', 'skills') + '/');
  }

  // Add user-level directories
  directories.push(join(homeDir, '.lace', 'skills') + '/');
  directories.push(join(homeDir, '.claude', 'skills') + '/');

  return directories;
}
