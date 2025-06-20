// ABOUTME: Project variable provider for file tree and working directory information
// ABOUTME: Provides project context like file structure, counts, and directory information

import { PromptVariableProvider } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';

export interface ProjectVariableOptions {
  maxDepth?: number;
  maxFiles?: number;
  ignorePatterns?: string[];
}

export class ProjectVariableProvider implements PromptVariableProvider {
  private _workingDir: string;
  private _options: ProjectVariableOptions;

  private static readonly DEFAULT_IGNORE_PATTERNS = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'target',
    '.DS_Store',
    'Thumbs.db',
    '*.log',
    '.env',
    '.env.local',
    '.env.*.local',
    'coverage',
    '.nyc_output',
    '.cache',
    '.parcel-cache',
    '.vscode',
    '.idea'
  ];

  constructor(workingDir: string = process.cwd(), options: ProjectVariableOptions = {}) {
    this._workingDir = workingDir;
    this._options = {
      maxDepth: options.maxDepth ?? 3,
      maxFiles: options.maxFiles ?? 100,
      ignorePatterns: options.ignorePatterns ?? ProjectVariableProvider.DEFAULT_IGNORE_PATTERNS
    };
  }

  getVariables(): Record<string, unknown> {
    const projectName = path.basename(this._workingDir);
    const treeInfo = this._generateFileTree();

    return {
      project: {
        name: projectName,
        cwd: this._workingDir,
        tree: treeInfo.tree,
        fileCount: treeInfo.fileCount,
        dirCount: treeInfo.dirCount,
        totalSize: treeInfo.totalSize
      }
    };
  }

  private _generateFileTree(): { tree: string; fileCount: number; dirCount: number; totalSize: number } {
    const result: string[] = [];
    let fileCount = 0;
    let dirCount = 0;
    let totalSize = 0;
    let truncated = false;

    const traverseDirectory = (dir: string, currentDepth: number, prefix: string = ''): void => {
      if (currentDepth > (this._options.maxDepth ?? 3)) {
        return;
      }

      if (fileCount >= (this._options.maxFiles ?? 100)) {
        truncated = true;
        return;
      }

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const filteredEntries = entries.filter(entry => !this._shouldIgnore(entry.name));

        filteredEntries.forEach((entry, index) => {
          if (fileCount >= (this._options.maxFiles ?? 100)) {
            truncated = true;
            return;
          }

          const isLast = index === filteredEntries.length - 1;
          const currentPrefix = prefix + (isLast ? '└── ' : '├── ');
          const nextPrefix = prefix + (isLast ? '    ' : '│   ');

          if (entry.isDirectory()) {
            result.push(`${currentPrefix}${entry.name}/`);
            dirCount++;
            traverseDirectory(path.join(dir, entry.name), currentDepth + 1, nextPrefix);
          } else {
            result.push(`${currentPrefix}${entry.name}`);
            fileCount++;
            
            // Add file size
            try {
              const stats = fs.statSync(path.join(dir, entry.name));
              totalSize += stats.size;
            } catch (error) {
              // Ignore size calculation errors
            }
          }
        });
      } catch (error) {
        logger.debug('Error reading directory for project tree', {
          directory: dir,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    };

    traverseDirectory(this._workingDir, 0);

    let tree = result.join('\n');
    if (truncated) {
      tree += '\n... (tree truncated, showing first ' + (this._options.maxFiles ?? 100) + ' files)';
    }

    return {
      tree: tree || '(empty directory)',
      fileCount,
      dirCount,
      totalSize
    };
  }

  private _shouldIgnore(filename: string): boolean {
    const patterns = this._options.ignorePatterns ?? [];
    
    return patterns.some(pattern => {
      if (pattern.includes('*')) {
        // Simple glob pattern matching
        const regexPattern = pattern.replace(/\*/g, '.*');
        return new RegExp(`^${regexPattern}$`).test(filename);
      } else {
        // Exact match
        return filename === pattern;
      }
    });
  }
}