// ABOUTME: List files tool - focused directory listing functionality
// ABOUTME: Provides file and directory listing with filtering options

import { BaseTool, ToolSchema, ToolContext } from './base-tool.js';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { stat } from 'fs/promises';

export interface ListFilesParams {
  path: string;
  recursive?: boolean;
  pattern?: string;
  include_hidden?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export interface ListFilesResult {
  path: string;
  entries: FileEntry[];
  count: number;
}

export class ListFilesTool extends BaseTool {
  getMetadata(): ToolSchema {
    return {
      name: 'list_files',
      description: 'List files and directories',
      methods: {
        run: {
          description: 'List contents of a directory with optional filtering',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: 'Directory path to list'
            },
            recursive: {
              type: 'boolean',
              required: false,
              default: false,
              description: 'List files recursively'
            },
            pattern: {
              type: 'string',
              required: false,
              description: 'File name pattern to match (glob-style)'
            },
            include_hidden: {
              type: 'boolean',
              required: false,
              default: false,
              description: 'Include hidden files and directories'
            }
          }
        }
      }
    };
  }

  async run(params: ListFilesParams, context?: ToolContext): Promise<ListFilesResult> {
    const { path, recursive = false, pattern, include_hidden = false } = params;

    try {
      // Check if path exists and is a directory
      const pathStats = await stat(path);
      if (!pathStats.isDirectory()) {
        throw new Error(`Path '${path}' is not a directory`);
      }

      // Check for cancellation before starting
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      const entries: FileEntry[] = [];
      
      if (recursive) {
        await this.listRecursive(path, entries, pattern, include_hidden, context);
      } else {
        await this.listDirectory(path, entries, pattern, include_hidden, context);
      }

      return {
        path,
        entries,
        count: entries.length
      };

    } catch (error) {
      if (error instanceof Error) {
        if ((error as any).code === 'ENOENT') {
          throw new Error(`Directory not found: ${path}`);
        }
        if ((error as any).code === 'EACCES') {
          throw new Error(`Permission denied: ${path}`);
        }
      }
      throw error;
    }
  }

  private async listDirectory(
    dirPath: string, 
    entries: FileEntry[], 
    pattern?: string, 
    includeHidden?: boolean,
    context?: ToolContext
  ): Promise<void> {
    const items = await fs.readdir(dirPath);

    for (const item of items) {
      // Check for cancellation
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      // Skip hidden files if not requested
      if (!includeHidden && item.startsWith('.')) {
        continue;
      }

      // Apply pattern filter if specified
      if (pattern && !this.matchesPattern(item, pattern)) {
        continue;
      }

      const itemPath = join(dirPath, item);
      
      try {
        const itemStats = await stat(itemPath);
        
        const entry: FileEntry = {
          name: item,
          path: itemPath,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          modified: itemStats.mtime.toISOString()
        };

        if (entry.type === 'file') {
          entry.size = itemStats.size;
        }

        entries.push(entry);
      } catch (error) {
        // Skip items we can't stat (broken symlinks, etc.)
        continue;
      }
    }
  }

  private async listRecursive(
    dirPath: string, 
    entries: FileEntry[], 
    pattern?: string, 
    includeHidden?: boolean,
    context?: ToolContext
  ): Promise<void> {
    await this.listDirectory(dirPath, entries, pattern, includeHidden, context);

    // Get directories for recursive listing
    const directories = entries
      .filter(entry => entry.type === 'directory')
      .map(entry => entry.path);

    for (const dir of directories) {
      // Check for cancellation
      if (context?.signal?.aborted) {
        throw new Error('Operation was cancelled');
      }

      try {
        await this.listRecursive(dir, entries, pattern, includeHidden, context);
      } catch (error) {
        // Skip directories we can't access
        continue;
      }
    }
  }

  private matchesPattern(filename: string, pattern: string): boolean {
    // Simple glob-style pattern matching
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
  }
}