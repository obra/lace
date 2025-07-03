// ABOUTME: Schema-based file finding tool with structured output
// ABOUTME: Recursively searches for files using glob patterns with Zod validation

import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { Tool } from '../tool.js';
import { NonEmptyString } from '../schemas/common.js';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types.js';
import { TOOL_LIMITS } from '../constants.js';

const fileFindSchema = z.object({
  pattern: NonEmptyString,
  path: z
    .string()
    .min(1, 'Path cannot be empty')
    .transform((path) => resolve(path))
    .default('.'),
  type: z.enum(['file', 'directory', 'both']).default('both'),
  caseSensitive: z.boolean().default(false),
  maxDepth: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_DEPTH, `Must be at least ${TOOL_LIMITS.MIN_DEPTH}`)
    .max(TOOL_LIMITS.MAX_DEPTH, `Must be at most ${TOOL_LIMITS.MAX_DEPTH}`)
    .default(TOOL_LIMITS.DEFAULT_DEPTH),
  includeHidden: z.boolean().default(false),
  maxResults: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_SEARCH_RESULTS, `Must be at least ${TOOL_LIMITS.MIN_SEARCH_RESULTS}`)
    .max(TOOL_LIMITS.MAX_SEARCH_RESULTS, `Must be at most ${TOOL_LIMITS.MAX_SEARCH_RESULTS}`)
    .default(TOOL_LIMITS.DEFAULT_SEARCH_RESULTS),
});

export class FileFindTool extends Tool {
  name = 'file_find';
  description = 'Find files by name pattern or glob';
  schema = fileFindSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  protected async executeValidated(
    args: z.infer<typeof fileFindSchema>,
    _context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { pattern, path, type, caseSensitive, maxDepth, includeHidden, maxResults } = args;

      // Validate directory exists
      try {
        const pathStat = await stat(path);
        if (!pathStat.isDirectory()) {
          return this.createError(
            `Path ${path} is not a directory. Specify a directory path to search in.`
          );
        }
      } catch (error: unknown) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'ENOENT') {
          return this.createError(
            `Directory not found: ${path}. Ensure the directory exists before searching.`
          );
        }
        throw error;
      }

      const matches = await this.findFiles(path, {
        pattern,
        type,
        caseSensitive,
        maxDepth,
        includeHidden,
        maxResults,
        currentDepth: 0,
      });

      const limitedMatches = matches.slice(0, maxResults);
      const resultLines: string[] = [];

      if (limitedMatches.length > 0) {
        resultLines.push(...limitedMatches.map((match) => this.formatFileEntry(match)));

        // Add truncation message if we hit the limit
        if (matches.length > maxResults) {
          resultLines.push(
            `Results limited to ${maxResults}. Use maxResults parameter to see more.`
          );
        }
      } else {
        resultLines.push(`No files found matching pattern: ${pattern}`);
      }

      return this.createResult(resultLines.join('\n'));
    } catch (error: unknown) {
      return this.handleFileSystemError(error, args.path);
    }
  }

  private async findFiles(
    dirPath: string,
    options: {
      pattern: string;
      type: 'file' | 'directory' | 'both';
      caseSensitive: boolean;
      maxDepth: number;
      includeHidden: boolean;
      maxResults: number;
      currentDepth: number;
    }
  ): Promise<Array<{ path: string; size?: number; isDirectory: boolean }>> {
    const matches: Array<{ path: string; size?: number; isDirectory: boolean }> = [];

    if (options.currentDepth > options.maxDepth) {
      return matches;
    }

    try {
      const items = await readdir(dirPath);

      for (const item of items) {
        if (!options.includeHidden && item.startsWith('.')) {
          continue;
        }

        const fullPath = join(dirPath, item);

        try {
          const stats = await stat(fullPath);
          const isDirectory = stats.isDirectory();
          const isFile = stats.isFile();

          // Check if this item matches our criteria
          const shouldInclude =
            options.type === 'both' ||
            (options.type === 'file' && isFile) ||
            (options.type === 'directory' && isDirectory);

          if (shouldInclude && this.matchesPattern(item, options.pattern, options.caseSensitive)) {
            matches.push({
              path: fullPath,
              size: isFile ? stats.size : undefined,
              isDirectory,
            });

            // Early termination: collect more than maxResults to detect truncation later
            if (matches.length > options.maxResults) {
              return matches;
            }
          }

          // Recurse into directories
          if (isDirectory && options.currentDepth < options.maxDepth) {
            const subMatches = await this.findFiles(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            matches.push(...subMatches);

            // Early termination: collect more than maxResults to detect truncation later
            if (matches.length > options.maxResults) {
              return matches;
            }
          }
        } catch {
          // Skip items we can't stat (permission issues, broken symlinks, etc.)
          continue;
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return matches.sort((a, b) => a.path.localeCompare(b.path));
  }

  private formatFileEntry(entry: { path: string; size?: number; isDirectory: boolean }): string {
    if (entry.isDirectory) {
      return entry.path;
    } else {
      const sizeStr = entry.size !== undefined ? ` (${this.formatFileSize(entry.size)})` : '';
      return `${entry.path}${sizeStr}`;
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 bytes';
    if (bytes === 1) return '1 byte';
    if (bytes < 1024) return `${bytes} bytes`;

    const k = 1024;
    const sizes = ['bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(1));

    return `${size} ${sizes[i]}`;
  }

  private matchesPattern(filename: string, pattern: string, caseSensitive: boolean): boolean {
    const targetName = caseSensitive ? filename : filename.toLowerCase();
    const targetPattern = caseSensitive ? pattern : pattern.toLowerCase();

    // Convert glob pattern to regex
    const regexPattern = targetPattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(targetName);
  }

  private handleFileSystemError(error: unknown, dirPath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'ENOENT':
          return this.createError(
            `Directory not found: ${dirPath}. Ensure the directory exists before searching.`
          );

        case 'EACCES':
          return this.createError(
            `Permission denied accessing ${dirPath}. Check directory permissions or choose a different location. File system error: ${error.message}`
          );

        case 'ENOTDIR':
          return this.createError(
            `Path ${dirPath} is not a directory. Specify a directory path to search in.`
          );

        default:
          return this.createError(
            `File search failed: ${error.message}. Check the directory path and search parameters, then try again.`
          );
      }
    }

    return this.createError(
      `File search failed due to unknown error. Check the directory path and search parameters, then try again.`
    );
  }

  // Public method for testing
  validatePath(path: string): string {
    return resolve(path);
  }
}
