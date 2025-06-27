// ABOUTME: File finding tool using name patterns and glob matching
// ABOUTME: Recursively searches for files matching specified patterns

import { readdir, stat, access } from 'fs/promises';
import { join } from 'path';
import { Tool, ToolCall, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

export class FileFindTool implements Tool {
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
    },
    required: ['pattern'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    const {
      pattern,
      path = '.',
      type = 'both',
      caseSensitive = false,
      maxDepth = 10,
      includeHidden = false,
    } = call.arguments as {
      pattern: string;
      path?: string;
      type?: 'file' | 'directory' | 'both';
      caseSensitive?: boolean;
      maxDepth?: number;
      includeHidden?: boolean;
    };

    if (!pattern || typeof pattern !== 'string') {
      return createErrorResult('Pattern must be a non-empty string', call.id);
    }

    try {
      // Check if path exists and is accessible
      await access(path);

      const matches = await this.findFiles(path, {
        pattern,
        type,
        caseSensitive,
        maxDepth,
        includeHidden,
        currentDepth: 0,
      });

      const resultText =
        matches.length > 0 ? matches.join('\n') : `No files found matching pattern: ${pattern}`;

      return createSuccessResult([
        {
          type: 'text',
          text: resultText,
        },
      ], call.id);
    } catch (error) {
      return createErrorResult(error instanceof Error ? error.message : 'Unknown error occurred', call.id);
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
      currentDepth: number;
    }
  ): Promise<string[]> {
    const matches: string[] = [];

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
            matches.push(fullPath);
          }

          // Recurse into directories
          if (isDirectory && options.currentDepth < options.maxDepth) {
            const subMatches = await this.findFiles(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            matches.push(...subMatches);
          }
        } catch {
          // Skip items we can't stat (permission issues, broken symlinks, etc.)
          continue;
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return matches.sort();
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
