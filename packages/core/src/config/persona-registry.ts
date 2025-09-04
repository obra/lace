// ABOUTME: Service for discovering and validating agent personas
// ABOUTME: Handles both built-in (bundled) and user-defined persona files

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLaceDir } from '~/config/lace-dir';
import { scanEmbeddedFiles } from '~/utils/resource-resolver';

export interface PersonaInfo {
  name: string;
  isUserDefined: boolean;
  path: string;
}

export class PersonaRegistry {
  private bundledPersonasCache: Set<string> = new Set();
  private userPersonasCache: Map<string, string> = new Map(); // name -> path
  private userCacheExpiry = 0;
  private readonly USER_CACHE_TTL = 5000; // 5 seconds

  constructor(private readonly bundledPersonasPath: string) {
    this.loadBundledPersonas();
  }

  private loadBundledPersonas(): void {
    try {
      // Use shared utility to scan for persona files
      const personaFiles = scanEmbeddedFiles(
        'config/agent-personas',
        '.md',
        this.bundledPersonasPath
      );

      // Filter out section files and add to cache
      for (const file of personaFiles) {
        if (!file.fullPath.includes('/sections/')) {
          this.bundledPersonasCache.add(file.name);
        }
      }
    } catch (error) {
      // Bundled personas should always exist, but handle gracefully
      console.warn('Failed to load bundled personas:', error);
    }
  }

  private loadUserPersonas(): void {
    const now = Date.now();
    if (now < this.userCacheExpiry) {
      return; // Cache still valid
    }

    this.userPersonasCache.clear();

    try {
      const userPersonasPath = path.join(getLaceDir(), 'agent-personas');
      if (!fs.existsSync(userPersonasPath)) {
        this.userCacheExpiry = now + this.USER_CACHE_TTL;
        return;
      }

      const files = fs.readdirSync(userPersonasPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const name = file.slice(0, -3); // Remove .md extension
          this.userPersonasCache.set(name, path.join(userPersonasPath, file));
        }
      }

      this.userCacheExpiry = now + this.USER_CACHE_TTL;
    } catch (error) {
      // User directory may not exist, that's ok
      this.userCacheExpiry = now + this.USER_CACHE_TTL;
    }
  }

  /**
   * Get all available personas (user personas override built-in ones)
   */
  listAvailablePersonas(): PersonaInfo[] {
    this.loadUserPersonas();

    const personas: PersonaInfo[] = [];
    const seen = new Set<string>();

    // User personas first (they override built-ins)
    for (const [name, filePath] of this.userPersonasCache) {
      personas.push({ name, isUserDefined: true, path: filePath });
      seen.add(name);
    }

    // Built-in personas (only if not overridden)
    for (const name of this.bundledPersonasCache) {
      if (!seen.has(name)) {
        const filePath = path.join(this.bundledPersonasPath, `${name}.md`);
        personas.push({ name, isUserDefined: false, path: filePath });
      }
    }

    return personas.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Check if a persona exists
   */
  hasPersona(name: string): boolean {
    this.loadUserPersonas();
    return this.userPersonasCache.has(name) || this.bundledPersonasCache.has(name);
  }

  /**
   * Get path to a persona file (user overrides built-in)
   * Note: For built-in personas, returns logical path - actual loading handled by TemplateEngine
   */
  getPersonaPath(name: string): string | null {
    this.loadUserPersonas();

    // Check user personas first
    if (this.userPersonasCache.has(name)) {
      return this.userPersonasCache.get(name)!;
    }

    // Check built-in personas - return logical path
    if (this.bundledPersonasCache.has(name)) {
      return `${name}.md`; // TemplateEngine will resolve this in bundled or file mode
    }

    return null;
  }

  /**
   * Validate persona exists, throw helpful error if not
   */
  validatePersona(name: string): void {
    if (!this.hasPersona(name)) {
      const available = this.listAvailablePersonas().map((p) => p.name);
      throw new Error(`Persona '${name}' not found. Available personas: ${available.join(', ')}`);
    }
  }
}

// Singleton instance - resolve to config/agent-personas relative to this file
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const bundledPersonasPath = path.resolve(currentDir, '../../config/agent-personas');

export const personaRegistry = new PersonaRegistry(bundledPersonasPath);
