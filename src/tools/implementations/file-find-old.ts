// ABOUTME: File finding tool using name patterns and glob matching
// ABOUTME: Recursively searches for files matching specified patterns

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { ToolCall, ToolResult, ToolContext, createSuccessResult } from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';
import { TOOL_LIMITS } from '../constants.js';

export class FileFindTool extends BaseTool {
  name = 'file_find';
  description = 'Find files by name pattern or glob';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };
  inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'File name pattern or glob (e.g., "*.ts", "test*")' },
      path: { type: 'string', description: 'Directory to search in (default: current directory)' },
      type: {
        type: 'string',
        description: 'Type of entries to find',
        enum: ['file', 'directory', 'both'],
      },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
      maxDepth: { type: 'number', description: 'Maximum search depth (default: 10)' },
      includeHidden: {
        type: 'boolean',
        description: 'Include hidden files/directories (default: false)',
      },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 50)' },
    },
    required: ['pattern'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const pattern = this.validateNonEmptyStringParam(call.arguments.pattern, 'pattern', call.id);
      const path =
        this.validateOptionalParam(
          call.arguments.path,
          'path',
          (value) => this.validateNonEmptyStringParam(value, 'path'),
          call.id
        ) ?? '.';

      const type =
        this.validateOptionalParam(
          call.arguments.type,
          'type',
          (value) => {
            const validTypes = ['file', 'directory', 'both'] as const;
            if (
              typeof value !== 'string' ||
              !validTypes.includes(value as (typeof validTypes)[number])
            ) {
              throw new Error(`Must be one of: ${validTypes.join(', ')}`);
            }
            return value as 'file' | 'directory' | 'both';
          },
          call.id
        ) ?? 'both';

      const caseSensitive =
        this.validateOptionalParam(
          call.arguments.caseSensitive,
          'caseSensitive',
          (value) => this.validateBooleanParam(value, 'caseSensitive'),
          call.id
        ) ?? false;

      const maxDepth =
        this.validateOptionalParam(
          call.arguments.maxDepth,
          'maxDepth',
          (value) =>
            this.validateNumberParam(value, 'maxDepth', call.id, {
              min: TOOL_LIMITS.MIN_DEPTH,
              max: TOOL_LIMITS.MAX_DEPTH,
              integer: true,
            }),
          call.id
        ) ?? TOOL_LIMITS.DEFAULT_DEPTH;

      const includeHidden =
        this.validateOptionalParam(
          call.arguments.includeHidden,
          'includeHidden',
          (value) => this.validateBooleanParam(value, 'includeHidden'),
          call.id
        ) ?? false;

      const maxResults =
        this.validateOptionalParam(
          call.arguments.maxResults,
          'maxResults',
          (value) =>
            this.validateNumberParam(value, 'maxResults', call.id, {
              min: TOOL_LIMITS.MIN_SEARCH_RESULTS,
              max: TOOL_LIMITS.MAX_SEARCH_RESULTS,
              integer: true,
            }),
          call.id
        ) ?? TOOL_LIMITS.DEFAULT_SEARCH_RESULTS;

      // Validate directory exists before searching
      await this.validateDirectoryExists(path, call.id);

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

      const resultText = resultLines.join('\n');

      return createSuccessResult(
        [
          {
            type: 'text',
            text: resultText,
          },
        ],
        call.id
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }

      return this.createStructuredError(
        'File search failed',
        'Check the directory path and search parameters, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
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
}
