// ABOUTME: Type definitions and validation for Agent Skills

/**
 * Core properties that define a skill, extracted from SKILL.md frontmatter.
 */
export interface SkillProperties {
  /** Unique identifier for the skill (1-64 chars, kebab-case) */
  name: string;
  /** Human-readable description of what the skill does (1-1024 chars) */
  description: string;
  /** Optional license identifier (e.g., "MIT", "Apache-2.0") */
  license?: string;
  /** Optional version compatibility constraint (e.g., ">=1.0.0") */
  compatibility?: string;
  /** Optional additional metadata as key-value pairs */
  metadata?: Record<string, string>;
}

/**
 * Extended skill metadata including file system paths.
 * Used after a skill has been discovered and parsed.
 */
export interface SkillMetadata extends SkillProperties {
  /** Absolute path to the skill directory */
  skillDir: string;
  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
}

/**
 * Result of a validation operation.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;

/**
 * Validates a skill name according to the Agent Skills spec.
 *
 * Requirements:
 * - 1-64 characters
 * - Lowercase alphanumeric and hyphens only
 * - Cannot start or end with a hyphen
 * - Cannot contain consecutive hyphens
 */
export function validateSkillName(name: string): ValidationResult {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, error: 'Skill name must be a non-empty string' };
  }

  const trimmed = name.trim();

  if (trimmed.length > MAX_NAME_LENGTH) {
    return {
      valid: false,
      error: `Skill name exceeds ${MAX_NAME_LENGTH} character limit`,
    };
  }

  if (trimmed !== trimmed.toLowerCase()) {
    return { valid: false, error: 'Skill name must be lowercase' };
  }

  if (trimmed.startsWith('-')) {
    return { valid: false, error: 'Skill name cannot start with a hyphen' };
  }

  if (trimmed.endsWith('-')) {
    return { valid: false, error: 'Skill name cannot end with a hyphen' };
  }

  if (trimmed.includes('--')) {
    return {
      valid: false,
      error: 'Skill name cannot contain consecutive hyphens',
    };
  }

  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Skill name can only contain lowercase letters, numbers, and hyphens',
    };
  }

  return { valid: true };
}

/**
 * Validates a skill description according to the Agent Skills spec.
 *
 * Requirements:
 * - 1-1024 characters
 * - Non-empty (after trimming whitespace)
 */
export function validateSkillDescription(description: string): ValidationResult {
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return { valid: false, error: 'Skill description must be a non-empty string' };
  }

  const trimmed = description.trim();

  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    return {
      valid: false,
      error: `Skill description exceeds ${MAX_DESCRIPTION_LENGTH} character limit`,
    };
  }

  return { valid: true };
}
