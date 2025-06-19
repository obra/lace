// ABOUTME: File system scanner for autocomplete with .gitignore support
// ABOUTME: Provides cached file/directory listings while respecting git ignore patterns

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger.js';

interface ScanResult {
  files: string[];
  directories: string[];
  lastScan: number;
}

export class FileScanner {
  private cache = new Map<string, ScanResult>();
  private cacheTimeout = 5000; // 5 seconds
  private gitignorePatterns: string[] = [];
  private gitignoreLoaded = false;

  constructor(private workingDirectory: string = process.cwd()) {
    this.loadGitignore();
  }

  /**
   * Load and parse .gitignore file if it exists
   */
  private loadGitignore(): void {
    try {
      const gitignorePath = path.join(this.workingDirectory, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf-8');
        this.gitignorePatterns = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'))
          .map((pattern) => this.normalizeGitignorePattern(pattern));

        logger.debug('Loaded .gitignore patterns', {
          count: this.gitignorePatterns.length,
          patterns: this.gitignorePatterns,
        });
      }

      // Always ignore common patterns
      this.gitignorePatterns.push('.git', 'node_modules', '.DS_Store', '*.log', '.env*');

      this.gitignoreLoaded = true;
    } catch (error) {
      logger.warn('Failed to load .gitignore', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.gitignoreLoaded = true;
    }
  }

  /**
   * Normalize gitignore pattern for simple matching
   */
  private normalizeGitignorePattern(pattern: string): string {
    // Remove leading/trailing slashes and handle basic patterns
    return pattern.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Check if a path should be ignored based on .gitignore patterns
   */
  private isIgnored(filePath: string): boolean {
    if (!this.gitignoreLoaded) {
      this.loadGitignore();
    }

    const relativePath = path.relative(this.workingDirectory, filePath);
    const pathParts = relativePath.split(path.sep);

    for (const pattern of this.gitignorePatterns) {
      // Simple pattern matching - could be enhanced with glob support
      if (
        this.matchesPattern(relativePath, pattern) ||
        pathParts.some((part) => this.matchesPattern(part, pattern))
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple pattern matching for gitignore patterns
   */
  private matchesPattern(text: string, pattern: string): boolean {
    // Handle exact matches
    if (pattern === text) return true;

    // Handle wildcard patterns (basic support)
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp(`^${regexPattern}$`).test(text);
    }

    // Handle directory patterns
    if (pattern.endsWith('/')) {
      return text === pattern.slice(0, -1) || text.startsWith(pattern);
    }

    return false;
  }

  /**
   * Scan directory for files and subdirectories
   */
  private scanDirectory(dirPath: string): { files: string[]; directories: string[] } {
    const files: string[] = [];
    const directories: string[] = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip if ignored
        if (this.isIgnored(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          directories.push(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.debug('Failed to scan directory', {
        dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { files, directories };
  }

  /**
   * Get all files and directories in a path, with caching
   */
  public async getCompletions(partialPath: string = ''): Promise<string[]> {
    const targetDir = partialPath ? path.dirname(partialPath) : '.';
    const searchTerm = partialPath ? path.basename(partialPath) : '';
    const absoluteDir = path.resolve(this.workingDirectory, targetDir);

    // Check cache
    const cacheKey = absoluteDir;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    let scanResult: ScanResult;

    if (cached && now - cached.lastScan < this.cacheTimeout) {
      scanResult = cached;
    } else {
      // Scan directory
      const { files, directories } = this.scanDirectory(absoluteDir);
      scanResult = {
        files,
        directories,
        lastScan: now,
      };
      this.cache.set(cacheKey, scanResult);
    }

    // Combine and filter results
    const allItems = [...scanResult.directories.map((dir) => dir + '/'), ...scanResult.files];

    // Convert to relative paths and filter by search term
    const relativePaths = allItems
      .map((item) => path.relative(this.workingDirectory, item))
      .filter((item) => item.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => {
        // Prioritize exact prefix matches
        const aStartsWith = a.toLowerCase().startsWith(searchTerm.toLowerCase());
        const bStartsWith = b.toLowerCase().startsWith(searchTerm.toLowerCase());

        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        // Then alphabetical
        return a.localeCompare(b);
      });

    return relativePaths;
  }

  /**
   * Clear the cache (useful for testing or when files change)
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Update working directory and reload gitignore
   */
  public setWorkingDirectory(newDir: string): void {
    this.workingDirectory = newDir;
    this.gitignoreLoaded = false;
    this.clearCache();
    this.loadGitignore();
  }
}
