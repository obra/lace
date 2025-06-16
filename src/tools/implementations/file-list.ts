// ABOUTME: Directory listing tool with filtering capabilities
// ABOUTME: Lists files and directories with optional pattern matching

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Tool, ToolResult, ToolContext } from '../types.js';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export class FileListTool implements Tool {
  name = 'file_list';
  description = 'List files and directories with optional filtering';
  destructive = false;
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current directory)' },
      pattern: { type: 'string', description: 'Glob pattern to filter files (optional)' },
      includeHidden: { type: 'boolean', description: 'Include hidden files (default: false)' },
      recursive: { type: 'boolean', description: 'List recursively (default: false)' },
      maxDepth: { type: 'number', description: 'Maximum recursion depth (default: 3)' },
    },
    required: [],
  };

  async executeTool(input: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const {
      path = '.',
      pattern,
      includeHidden = false,
      recursive = false,
      maxDepth = 3,
    } = input as {
      path?: string;
      pattern?: string;
      includeHidden?: boolean;
      recursive?: boolean;
      maxDepth?: number;
    };

    try {
      const entries = await this.listDirectory(path, {
        pattern,
        includeHidden,
        recursive,
        maxDepth,
        currentDepth: 0,
      });

      const output = entries
        .map((entry) => {
          const typeIndicator = entry.type === 'directory' ? '/' : '';
          const size = entry.size !== undefined ? ` (${entry.size} bytes)` : '';
          return `${entry.path}${typeIndicator}${size}`;
        })
        .join('\n');

      return {
        success: true,
        content: [
          {
            type: 'text',
            text: output || 'No files found',
          },
        ],
      };
    } catch (error) {
      return {
        success: false,
        content: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  private async listDirectory(
    dirPath: string,
    options: {
      pattern?: string;
      includeHidden: boolean;
      recursive: boolean;
      maxDepth: number;
      currentDepth: number;
    }
  ): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];

    try {
      const items = await readdir(dirPath);

      for (const item of items) {
        if (!options.includeHidden && item.startsWith('.')) {
          continue;
        }

        if (options.pattern && !this.matchesPattern(item, options.pattern)) {
          continue;
        }

        const fullPath = join(dirPath, item);
        const stats = await stat(fullPath);

        const entry: FileEntry = {
          name: item,
          path: fullPath,
          type: stats.isDirectory() ? 'directory' : 'file',
        };

        if (stats.isFile()) {
          entry.size = stats.size;
        }

        entries.push(entry);

        if (stats.isDirectory() && options.recursive && options.currentDepth < options.maxDepth) {
          try {
            const subEntries = await this.listDirectory(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            entries.push(...subEntries);
          } catch {
            // Skip directories we can't read during recursive traversal
          }
        }
      }
    } catch (error) {
      // For the main directory, we want to propagate the error
      // Only skip errors for recursive subdirectories
      if (options.currentDepth === 0) {
        throw error;
      }
      // For subdirectories, silently skip unreadable directories
    }

    return entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
  }
}
