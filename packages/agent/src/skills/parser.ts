// ABOUTME: Parse SKILL.md files - extracts frontmatter and body content

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import matter from 'gray-matter';
import { validateSkillName, validateSkillDescription, type SkillProperties } from './types';

/**
 * Result of parsing a SKILL.md file.
 */
export interface ParsedSkill {
  properties: SkillProperties;
  body: string;
}

/**
 * Error thrown when parsing a SKILL.md file fails.
 */
export class SkillParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillParseError';
  }
}

/**
 * Find the SKILL.md file in a skill directory.
 * Prefers SKILL.md (uppercase) but accepts skill.md (lowercase).
 *
 * @param skillDir - Path to the skill directory
 * @returns Absolute path to the SKILL.md file, or null if not found
 */
export function findSkillMd(skillDir: string): string | null {
  for (const name of ['SKILL.md', 'skill.md']) {
    const filePath = join(skillDir, name);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Parse SKILL.md content into properties and body.
 *
 * @param content - Raw SKILL.md file content
 * @returns Parsed skill with properties and body
 * @throws SkillParseError if the content is invalid
 */
export function parseSkillMd(content: string): ParsedSkill {
  if (!content.startsWith('---')) {
    throw new SkillParseError('SKILL.md must start with YAML frontmatter (---)');
  }

  const parsed = matter(content);
  const data = parsed.data as Record<string, unknown>;

  // Validate required fields
  if (!data.name || typeof data.name !== 'string') {
    throw new SkillParseError('Missing required field: name');
  }

  if (!data.description || typeof data.description !== 'string') {
    throw new SkillParseError('Missing required field: description');
  }

  // Validate name format
  const nameValidation = validateSkillName(data.name);
  if (!nameValidation.valid) {
    throw new SkillParseError(`Invalid skill name: ${nameValidation.error}`);
  }

  // Validate description format
  const descValidation = validateSkillDescription(data.description);
  if (!descValidation.valid) {
    throw new SkillParseError(`Invalid skill description: ${descValidation.error}`);
  }

  // Build properties object
  const properties: SkillProperties = {
    name: data.name.trim(),
    description: data.description.trim(),
  };

  if (data.license && typeof data.license === 'string') {
    properties.license = data.license;
  }

  if (data.compatibility && typeof data.compatibility === 'string') {
    properties.compatibility = data.compatibility;
  }

  if (data.metadata && typeof data.metadata === 'object' && data.metadata !== null) {
    properties.metadata = Object.fromEntries(
      Object.entries(data.metadata as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    );
  }

  return {
    properties,
    body: parsed.content.trim(),
  };
}

/**
 * Read and parse a skill from a directory.
 *
 * @param skillDir - Path to the skill directory
 * @returns Parsed skill with properties and body
 * @throws SkillParseError if no SKILL.md is found or parsing fails
 */
export function readSkillFromDir(skillDir: string): ParsedSkill {
  const skillMdPath = findSkillMd(skillDir);
  if (!skillMdPath) {
    throw new SkillParseError(`No SKILL.md found in ${skillDir}`);
  }

  const content = readFileSync(skillMdPath, 'utf-8');
  return parseSkillMd(content);
}
