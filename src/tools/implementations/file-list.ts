// ABOUTME: Directory listing tool with filtering capabilities
// ABOUTME: Lists files and directories with optional pattern matching

import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { ToolCall, ToolResult, ToolContext, createSuccessResult } from '../types.js';
import { BaseTool, ValidationError } from '../base-tool.js';
import { TOOL_LIMITS } from '../constants.js';

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

export class FileListTool extends BaseTool {
  name = 'file_list';
  description = 'List files and directories with optional filtering';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };
  inputSchema = {
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
      maxResults: { type: 'number', description: 'Maximum number of total results (default: 50)' },
    },
    required: [],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    try {
      const path =
        this.validateOptionalParam(
          call.arguments.path,
          'path',
          (value) => this.validateNonEmptyStringParam(value, 'path'),
          call.id
        ) ?? '.';

      const pattern = this.validateOptionalParam(
        call.arguments.pattern,
        'pattern',
        (value) => this.validateStringParam(value, 'pattern'),
        call.id
      );

      const includeHidden =
        this.validateOptionalParam(
          call.arguments.includeHidden,
          'includeHidden',
          (value) => this.validateBooleanParam(value, 'includeHidden'),
          call.id
        ) ?? false;

      const recursive =
        this.validateOptionalParam(
          call.arguments.recursive,
          'recursive',
          (value) => this.validateBooleanParam(value, 'recursive'),
          call.id
        ) ?? false;

      const maxDepth =
        this.validateOptionalParam(
          call.arguments.maxDepth,
          'maxDepth',
          (value) =>
            this.validateNumberParam(value, 'maxDepth', call.id, {
              min: TOOL_LIMITS.MIN_DEPTH,
              max: TOOL_LIMITS.MAX_LIST_DEPTH,
              integer: true,
            }),
          call.id
        ) ?? TOOL_LIMITS.DEFAULT_LIST_DEPTH;

      const summaryThreshold =
        this.validateOptionalParam(
          call.arguments.summaryThreshold,
          'summaryThreshold',
          (value) =>
            this.validateNumberParam(value, 'summaryThreshold', call.id, {
              min: TOOL_LIMITS.MIN_SUMMARY_THRESHOLD,
              max: TOOL_LIMITS.MAX_SUMMARY_THRESHOLD,
              integer: true,
            }),
          call.id
        ) ?? TOOL_LIMITS.DEFAULT_SUMMARY_THRESHOLD;

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

      // Validate directory exists before listing
      await this.validateDirectoryExists(path, call.id);

      const resultCounter = { count: 0, truncated: false };
      const tree = await this.buildTree(path, {
        pattern,
        includeHidden,
        recursive,
        maxDepth,
        summaryThreshold,
        maxResults,
        currentDepth: 0,
        resultCounter,
      });

      // If tree has no children, return "No files found"
      let output = '';
      if (tree.children && tree.children.length > 0) {
        output = this.formatTree(tree);

        // Add truncation message if we hit the limit
        if (resultCounter.truncated) {
          output += `\n\nResults limited to ${maxResults}. Use maxResults parameter to see more.`;
        }
      } else {
        output = 'No files found';
      }

      return createSuccessResult(
        [
          {
            type: 'text',
            text: output,
          },
        ],
        call.id
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        return error.toolResult;
      }

      return this.createStructuredError(
        'Directory listing failed',
        'Check the directory path and parameters, then try again',
        error instanceof Error ? error.message : 'Unknown error occurred',
        call.id
      );
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
      maxResults: number;
      currentDepth: number;
      resultCounter: { count: number; truncated: boolean };
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
        // Early termination if we've reached the result limit
        if (options.resultCounter.count >= options.maxResults) {
          options.resultCounter.truncated = true;
          break;
        }

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
                options.resultCounter.count++;
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
            options.resultCounter.count++;
          } else {
            children.push({
              name: item,
              path: fullPath,
              type: 'directory',
            });
            options.resultCounter.count++;
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
          options.resultCounter.count++;
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
