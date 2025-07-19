// ABOUTME: Schema-based directory listing tool with structured output
// ABOUTME: Lists files and directories with tree formatting and Zod validation

import { z } from 'zod';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { Tool } from '~/tools/tool';
import type { ToolResult, ToolContext, ToolAnnotations } from '~/tools/types';
import { TOOL_LIMITS } from '~/tools/constants';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'summary';
  children?: TreeNode[];
  summary?: { files: number; dirs: number };
  size?: number;
}

const fileListSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty').default('.'),
  pattern: z.string().optional(),
  includeHidden: z.boolean().default(false),
  recursive: z.boolean().default(false),
  maxDepth: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_DEPTH, `Must be at least ${TOOL_LIMITS.MIN_DEPTH}`)
    .max(TOOL_LIMITS.MAX_LIST_DEPTH, `Must be at most ${TOOL_LIMITS.MAX_LIST_DEPTH}`)
    .default(TOOL_LIMITS.DEFAULT_LIST_DEPTH),
  summaryThreshold: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_SUMMARY_THRESHOLD, `Must be at least ${TOOL_LIMITS.MIN_SUMMARY_THRESHOLD}`)
    .max(TOOL_LIMITS.MAX_SUMMARY_THRESHOLD, `Must be at most ${TOOL_LIMITS.MAX_SUMMARY_THRESHOLD}`)
    .default(TOOL_LIMITS.DEFAULT_SUMMARY_THRESHOLD),
  maxResults: z
    .number()
    .int('Must be an integer')
    .min(TOOL_LIMITS.MIN_SEARCH_RESULTS, `Must be at least ${TOOL_LIMITS.MIN_SEARCH_RESULTS}`)
    .max(TOOL_LIMITS.MAX_SEARCH_RESULTS, `Must be at most ${TOOL_LIMITS.MAX_SEARCH_RESULTS}`)
    .default(TOOL_LIMITS.DEFAULT_SEARCH_RESULTS),
});

export class FileListTool extends Tool {
  name = 'file_list';
  description = 'List files and directories with optional filtering';
  schema = fileListSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

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

  protected async executeValidated(
    args: z.infer<typeof fileListSchema>,
    context?: ToolContext
  ): Promise<ToolResult> {
    try {
      const { path, pattern, includeHidden, recursive, maxDepth, summaryThreshold, maxResults } =
        args;

      // Resolve path using working directory from context
      const resolvedPath = this.resolvePath(path, context);

      // Validate directory exists
      try {
        const pathStat = await stat(resolvedPath);
        if (!pathStat.isDirectory()) {
          return this.createError(
            `Path ${path} is not a directory. Specify a directory path to list.`
          );
        }
      } catch (error: unknown) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'ENOENT') {
          return this.createError(
            `Directory not found: ${path}. Ensure the directory exists before listing.`
          );
        }
        throw error;
      }

      const resultCounter = { count: 0, truncated: false };
      const tree = await this.buildTree(resolvedPath, {
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

      return this.createResult(output);
    } catch (error: unknown) {
      return this.handleFileSystemError(error, args.path);
    }
  }

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

  private matchesPattern(filename: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
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

  private handleFileSystemError(error: unknown, dirPath: string): ToolResult {
    if (error instanceof Error) {
      const nodeError = error as Error & { code?: string };

      switch (nodeError.code) {
        case 'ENOENT':
          return this.createError(
            `Directory not found: ${dirPath}. Ensure the directory exists before listing.`
          );

        case 'EACCES':
          return this.createError(
            `Permission denied accessing ${dirPath}. Check directory permissions or choose a different location. File system error: ${error.message}`
          );

        case 'ENOTDIR':
          return this.createError(
            `Path ${dirPath} is not a directory. Specify a directory path to list.`
          );

        default:
          return this.createError(
            `Directory listing failed: ${error.message}. Check the directory path and parameters, then try again.`
          );
      }
    }

    return this.createError(
      `Directory listing failed due to unknown error. Check the directory path and parameters, then try again.`
    );
  }

  // Public method for testing
  validatePath(path: string): string {
    return this.resolvePath(path);
  }
}
