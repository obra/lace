// ABOUTME: SkillRegistry discovers and manages skills from configured directories

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { logger } from '@lace/agent/utils/logger';
import type { SkillMetadata } from './types';
import { findSkillMd, parseSkillMd, SkillParseError } from './parser';

/**
 * Configuration options for SkillRegistry.
 */
export interface SkillRegistryOptions {
  /** Directories to scan for skills, in priority order (first wins) */
  skillDirs: string[];
}

/**
 * Content of a skill, including body and paths.
 */
export interface SkillContent {
  /** The markdown body content of the skill */
  body: string;
  /** Absolute path to the skill directory */
  skillDir: string;
  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
}

/**
 * Internal structure for storing skill data including body.
 */
interface SkillEntry {
  metadata: SkillMetadata;
  body: string;
}

/**
 * Registry that discovers and manages skills from configured directories.
 *
 * Skills are discovered on construction and cached. Earlier directories in
 * the skillDirs list take priority - if the same skill name exists in
 * multiple directories, only the first one is used.
 */
export class SkillRegistry {
  private readonly skillDirs: string[];
  private skills: Map<string, SkillEntry> = new Map();

  constructor(options: SkillRegistryOptions) {
    this.skillDirs = options.skillDirs;
    this.scanDirectories();
  }

  /**
   * List all discovered skills.
   *
   * @returns Array of skill metadata for all discovered skills
   */
  listSkills(): SkillMetadata[] {
    return Array.from(this.skills.values()).map((entry) => entry.metadata);
  }

  /**
   * Get skill metadata by name.
   *
   * @param name - The skill name to look up
   * @returns Skill metadata if found, null otherwise
   */
  getSkill(name: string): SkillMetadata | null {
    const entry = this.skills.get(name);
    return entry ? entry.metadata : null;
  }

  /**
   * Get skill content (body and paths) by name.
   *
   * @param name - The skill name to look up
   * @returns Skill content if found, null otherwise
   */
  getSkillContent(name: string): SkillContent | null {
    const entry = this.skills.get(name);
    if (!entry) {
      return null;
    }
    return {
      body: entry.body,
      skillDir: entry.metadata.skillDir,
      skillMdPath: entry.metadata.skillMdPath,
    };
  }

  /**
   * Refresh the registry by rescanning all configured directories.
   *
   * Use this after skill directories have changed to pick up new skills
   * or changes to existing skills.
   */
  refresh(): void {
    this.skills.clear();
    this.scanDirectories();
  }

  /**
   * Scan all configured directories for skills.
   */
  private scanDirectories(): void {
    for (const dir of this.skillDirs) {
      this.scanDirectory(dir);
    }
  }

  /**
   * Scan a single directory for skills.
   *
   * @param dir - The directory to scan
   */
  private scanDirectory(dir: string): void {
    // Handle non-existent directories gracefully
    if (!existsSync(dir)) {
      logger.debug(`Skill directory does not exist: ${dir}`);
      return;
    }

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (error) {
      logger.warn(`Failed to read skill directory: ${dir}`, { error });
      return;
    }

    for (const entry of entries) {
      const skillDir = join(dir, entry);

      // Skip if not a directory
      try {
        if (!statSync(skillDir).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      this.loadSkillFromDirectory(skillDir);
    }
  }

  /**
   * Attempt to load a skill from a directory.
   *
   * @param skillDir - The potential skill directory
   */
  private loadSkillFromDirectory(skillDir: string): void {
    const dirName = basename(skillDir);

    // Find SKILL.md
    const skillMdPath = findSkillMd(skillDir);
    if (!skillMdPath) {
      logger.debug(`No SKILL.md found in ${skillDir}`);
      return;
    }

    // Read and parse SKILL.md
    let content: string;
    try {
      content = readFileSync(skillMdPath, 'utf-8');
    } catch (error) {
      logger.warn(`Failed to read SKILL.md: ${skillMdPath}`, { error });
      return;
    }

    let parsed;
    try {
      parsed = parseSkillMd(content);
    } catch (error) {
      if (error instanceof SkillParseError) {
        logger.warn(`Invalid SKILL.md in ${skillDir}: ${error.message}`);
      } else {
        logger.warn(`Failed to parse SKILL.md in ${skillDir}`, { error });
      }
      return;
    }

    // Validate skill name matches directory name
    if (parsed.properties.name !== dirName) {
      logger.warn(
        `Skill name "${parsed.properties.name}" does not match directory name "${dirName}" in ${skillDir}`
      );
      return;
    }

    // Check if this skill is already registered (earlier directory wins)
    if (this.skills.has(parsed.properties.name)) {
      const existingEntry = this.skills.get(parsed.properties.name)!;
      logger.warn(
        `Skill "${parsed.properties.name}" is shadowed: keeping ${existingEntry.metadata.skillDir}, ignoring ${skillDir}`
      );
      return;
    }

    // Register the skill
    const metadata: SkillMetadata = {
      ...parsed.properties,
      skillDir,
      skillMdPath,
    };

    this.skills.set(parsed.properties.name, {
      metadata,
      body: parsed.body,
    });

    logger.debug(`Discovered skill: ${parsed.properties.name} from ${skillDir}`);
  }
}
