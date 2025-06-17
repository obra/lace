// ABOUTME: Directory listing tool with filtering capabilities
// ABOUTME: Lists files and directories with optional pattern matching

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Tool, ToolResult, ToolContext, createSuccessResult, createErrorResult } from '../types.js';

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'summary';
  children?: TreeNode[];
  summary?: { files: number; dirs: number };
  size?: number;
}

export class FileListTool implements Tool {
  name = 'file_list';
  description = 'List files and directories with optional filtering';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };
  input_schema = {
    type: 'object' as const,
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current directory)' },
      pattern: { type: 'string', description: 'Glob pattern to filter files (optional)' },
      includeHidden: { type: 'boolean', description: 'Include hidden files (default: false)' },
      recursive: { type: 'boolean', description: 'List recursively (default: false)' },
      maxDepth: { type: 'number', description: 'Maximum recursion depth (default: 3)' },
      summaryThreshold: {
        type: 'number',
        description: 'Number of entries before summarizing (default: 50)',
      },
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
      summaryThreshold = 50,
    } = input as {
      path?: string;
      pattern?: string;
      includeHidden?: boolean;
      recursive?: boolean;
      maxDepth?: number;
      summaryThreshold?: number;
    };

    try {
      const tree = await this.buildTree(path, {
        pattern,
        includeHidden,
        recursive,
        maxDepth,
        summaryThreshold,
        currentDepth: 0,
      });

      // If tree has no children, return "No files found"
      const output =
        tree.children && tree.children.length > 0 ? this.formatTree(tree) : 'No files found';

      return createSuccessResult([
        {
          type: 'text',
          text: output,
        },
      ]);
    } catch (error) {
      return createErrorResult(error instanceof Error ? error.message : 'Unknown error occurred');
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

  private readonly ALWAYS_SUMMARIZE = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    'vendor',
    'venv',
    '.venv',
    '__pycache__',
  ]);

  private async buildTree(
    dirPath: string,
    options: {
      pattern?: string;
      includeHidden: boolean;
      recursive: boolean;
      maxDepth: number;
      summaryThreshold: number;
      currentDepth: number;
    }
  ): Promise<TreeNode> {
    const dirName = dirPath.split('/').pop() || dirPath;
    const node: TreeNode = {
      name: dirName,
      path: dirPath,
      type: 'directory',
      children: [],
    };

    try {
      const items = await readdir(dirPath);
      const children: TreeNode[] = [];

      // Check if we should summarize this directory
      const shouldSummarize =
        options.currentDepth > 0 &&
        (this.ALWAYS_SUMMARIZE.has(dirName) || items.length > options.summaryThreshold);

      if (shouldSummarize) {
        // Count files and directories recursively
        const counts = await this.countFilesAndDirs(dirPath);
        node.type = 'summary';
        node.summary = counts;
        node.children = undefined;
        return node;
      }

      // Process children normally
      for (const item of items) {
        if (!options.includeHidden && item.startsWith('.')) {
          continue;
        }

        const fullPath = join(dirPath, item);
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          // For directories, check pattern matching on directory name
          if (options.pattern && !this.matchesPattern(item, options.pattern)) {
            // Still need to traverse if recursive, but don't include in output
            if (options.recursive && options.currentDepth < options.maxDepth) {
              const childNode = await this.buildTree(fullPath, {
                ...options,
                currentDepth: options.currentDepth + 1,
              });
              // Only include if it has matching children
              if (childNode.children && childNode.children.length > 0) {
                children.push(childNode);
              }
            }
            continue;
          }

          if (options.recursive && options.currentDepth < options.maxDepth) {
            const childNode = await this.buildTree(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            children.push(childNode);
          } else {
            children.push({
              name: item,
              path: fullPath,
              type: 'directory',
            });
          }
        } else {
          // For files, check pattern matching
          if (options.pattern && !this.matchesPattern(item, options.pattern)) {
            continue;
          }

          children.push({
            name: item,
            path: fullPath,
            type: 'file',
            size: stats.size,
          });
        }
      }

      // Sort children: directories first, then by name
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' || a.type === 'summary' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      node.children = children;
    } catch (error) {
      // For the main directory, we want to propagate the error
      if (options.currentDepth === 0) {
        throw error;
      }
      // For subdirectories, return empty node
      node.children = [];
    }

    return node;
  }

  private async countFilesAndDirs(dirPath: string): Promise<{ files: number; dirs: number }> {
    let fileCount = 0;
    let dirCount = 0;

    try {
      const items = await readdir(dirPath);

      for (const item of items) {
        const fullPath = join(dirPath, item);
        try {
          const stats = await stat(fullPath);
          if (stats.isDirectory()) {
            dirCount++;
            // Recursively count subdirectories
            const subCounts = await this.countFilesAndDirs(fullPath);
            fileCount += subCounts.files;
            dirCount += subCounts.dirs;
          } else {
            fileCount++;
          }
        } catch {
          // Skip items we can't stat
        }
      }
    } catch {
      // Skip directories we can't read
    }

    return { files: fileCount, dirs: dirCount };
  }

  private formatTree(node: TreeNode, prefix = '', isLast = true): string {
    const lines: string[] = [];

    // Format current node
    let nodeLine = '';
    if (prefix) {
      nodeLine = prefix.slice(0, -2) + (isLast ? '└ ' : '├ ');
    }

    nodeLine += node.name;

    if (node.type === 'directory' && !node.summary) {
      nodeLine += '/';
    } else if (node.type === 'summary') {
      nodeLine += `/ (${node.summary!.files} files; ${node.summary!.dirs} dirs)`;
    } else if (node.type === 'file' && node.size !== undefined) {
      nodeLine += ` (${node.size} bytes)`;
    }

    lines.push(nodeLine);

    // Format children
    if (node.children && node.children.length > 0) {
      const childPrefix = prefix + (isLast ? '  ' : '│ ');
      node.children.forEach((child, index) => {
        const isLastChild = index === node.children!.length - 1;
        const childLines = this.formatTree(child, childPrefix, isLastChild);
        lines.push(childLines);
      });
    }

    return lines.join('\n');
  }
}
