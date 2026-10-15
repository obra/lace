// ABOUTME: SkillRegistry discovers and manages skills from configured directories

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, join } from 'path';
import { logger } from '@lace/agent/utils/logger';
import type { SkillDirEntry, SkillMetadata } from './types';
import { findSkillMd, parseSkillMd, SkillParseError } from './parser';

/**
 * Configuration options for SkillRegistry.
 */
export interface SkillRegistryOptions {
  /** Directories to scan for skills, in priority order (first wins) */
  skillDirs: SkillDirEntry[];
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
  /** Qualified name of the version returned */
  qualifiedName: string;
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
 * multiple directories, only the first one is listed and returned for the
 * bare name. Every version stays reachable by its qualified name
 * (`<namespace>:<name>`, or the bare name for a directory with no namespace).
 */
export class SkillRegistry {
  private readonly skillDirs: SkillDirEntry[];
  /** First-wins version of each skill, keyed by bare name */
  private skills: Map<string, SkillEntry> = new Map();
  /** Every loaded version, keyed by qualified name */
  private versions: Map<string, SkillEntry> = new Map();
  /**
   * Shadows already warned about, as `<kept skillDir>|<ignored skillDir>`.
   * Not cleared by refresh(): the registry rescans on every prompt render, and
   * a deliberate shadow should be logged once, not once per turn. A new winner
   * or a new shadowed copy is a new key, so it is still logged.
   */
  private readonly warnedShadows: Set<string> = new Set();

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
   * @param name - A bare name (returns the first-wins version) or a qualified
   *   name (returns that exact version, even if shadowed)
   * @returns Skill metadata if found, null otherwise
   */
  getSkill(name: string): SkillMetadata | null {
    const entry = this.lookup(name);
    return entry ? entry.metadata : null;
  }

  /**
   * Get skill content (body and paths) by name.
   *
   * @param name - A bare name (returns the first-wins version) or a qualified
   *   name (returns that exact version, even if shadowed)
   * @returns Skill content if found, null otherwise
   */
  getSkillContent(name: string): SkillContent | null {
    const entry = this.lookup(name);
    if (!entry) {
      return null;
    }
    return {
      body: entry.body,
      skillDir: entry.metadata.skillDir,
      skillMdPath: entry.metadata.skillMdPath,
      qualifiedName: entry.metadata.qualifiedName,
    };
  }

  /**
   * Skill names cannot contain ':', so a bare name and a qualified name never
   * collide: try the winner by bare name, then the exact qualified version.
   */
  private lookup(name: string): SkillEntry | undefined {
    return this.skills.get(name) ?? this.versions.get(name);
  }

  private warnShadowOnce(keptDir: string, ignoredDir: string, message: string): void {
    const key = `${keptDir}|${ignoredDir}`;
    if (this.warnedShadows.has(key)) return;
    this.warnedShadows.add(key);
    logger.warn(message);
  }

  /**
   * Refresh the registry by rescanning all configured directories.
   *
   * Use this after skill directories have changed to pick up new skills
   * or changes to existing skills.
   */
  refresh(): void {
    this.skills.clear();
    this.versions.clear();
    this.scanDirectories();
  }

  /**
   * Scan all configured directories for skills.
   */
  private scanDirectories(): void {
    for (const entry of this.skillDirs) {
      if (typeof entry === 'string') {
        this.scanDirectory(entry, undefined);
      } else {
        this.scanDirectory(entry.dir, entry.namespace);
      }
    }
  }

  /**
   * Scan a single directory for skills.
   *
   * @param dir - The directory to scan
   * @param namespace - Namespace given to every skill in the directory, if any
   */
  private scanDirectory(dir: string, namespace: string | undefined): void {
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

      this.loadSkillFromDirectory(skillDir, namespace);
    }
  }

  /**
   * Attempt to load a skill from a directory.
   *
   * @param skillDir - The potential skill directory
   * @param namespace - Namespace of the containing skill directory, if any
   */
  private loadSkillFromDirectory(skillDir: string, namespace: string | undefined): void {
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

    const name = parsed.properties.name;
    const qualifiedName = namespace ? `${namespace}:${name}` : name;
    const entry: SkillEntry = {
      metadata: {
        ...parsed.properties,
        skillDir,
        skillMdPath,
        ...(namespace ? { namespace } : {}),
        qualifiedName,
      },
      body: parsed.body,
    };

    // Keep every version reachable by qualified name; an earlier directory
    // with the same namespace still wins for that qualified name.
    const existingVersion = this.versions.get(qualifiedName);
    if (!existingVersion) {
      this.versions.set(qualifiedName, entry);
    } else if (namespace) {
      this.warnShadowOnce(
        existingVersion.metadata.skillDir,
        skillDir,
        `Skill "${qualifiedName}" is defined twice under namespace "${namespace}": keeping ${existingVersion.metadata.skillDir}, ignoring ${skillDir}`
      );
    }

    // Earlier directory wins the bare name.
    const existingEntry = this.skills.get(name);
    if (existingEntry) {
      this.warnShadowOnce(
        existingEntry.metadata.skillDir,
        skillDir,
        `Skill "${name}" is shadowed: keeping ${existingEntry.metadata.skillDir}, ignoring ${skillDir}`
      );
      return;
    }

    this.skills.set(name, entry);

    logger.debug(`Discovered skill: ${parsed.properties.name} from ${skillDir}`);
  }
}
