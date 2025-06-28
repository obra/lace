// ABOUTME: Fast text search tool using ripgrep for codebase analysis
// ABOUTME: Wraps ripgrep command with structured output and error handling

import { exec } from 'child_process';
import { promisify } from 'util';
import {
  Tool,
  ToolCall,
  ToolResult,
  ToolContext,
  createSuccessResult,
  createErrorResult,
} from '../types.js';

const execAsync = promisify(exec);

interface SearchMatch {
  path: string;
  lineNumber: number;
  content: string;
}

export class RipgrepSearchTool implements Tool {
  name = 'ripgrep_search';
  description = 'Fast text search across files using ripgrep';
  annotations = {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  };
  inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'Text pattern to search for' },
      path: {
        type: 'string',
        description: 'Directory or file path to search (default: current directory)',
      },
      caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
      wholeWord: { type: 'boolean', description: 'Match whole words only (default: false)' },
      includePattern: { type: 'string', description: 'File pattern to include (e.g., "*.ts")' },
      excludePattern: {
        type: 'string',
        description: 'File pattern to exclude (e.g., "*.test.ts")',
      },
      maxResults: { type: 'number', description: 'Maximum number of results (default: 100)' },
      contextLines: { type: 'number', description: 'Lines of context around matches (default: 0)' },
    },
    required: ['pattern'],
  };

  async executeTool(call: ToolCall, _context?: ToolContext): Promise<ToolResult> {
    const {
      pattern,
      path = '.',
      caseSensitive = false,
      wholeWord = false,
      includePattern,
      excludePattern,
      maxResults = 100,
      contextLines = 0,
    } = call.arguments as {
      pattern: string;
      path?: string;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      includePattern?: string;
      excludePattern?: string;
      maxResults?: number;
      contextLines?: number;
    };

    if (!pattern || typeof pattern !== 'string') {
      return createErrorResult('Pattern must be a non-empty string', call.id);
    }

    try {
      const args = this.buildRipgrepArgs({
        pattern,
        path,
        caseSensitive,
        wholeWord,
        includePattern,
        excludePattern,
        maxResults,
        contextLines,
      });

      const command = `rg ${args.join(' ')}`;

      try {
        const { stdout } = await execAsync(command, {
          cwd: process.cwd(),
          maxBuffer: 10485760, // 10MB buffer
        });

        const matches = this.parseRipgrepOutput(stdout);
        const resultText = this.formatResults(matches, pattern);

        return createSuccessResult(
          [
            {
              type: 'text',
              text: resultText,
            },
          ],
          call.id
        );
      } catch (execError: unknown) {
        // ripgrep exits with code 1 when no matches found
        const err = execError as { code?: number; message?: string };
        if (err.code === 1) {
          return createSuccessResult(
            [
              {
                type: 'text',
                text: `No matches found for pattern: ${pattern}`,
              },
            ],
            call.id
          );
        }

        // Other errors (e.g., invalid regex, file not found)
        throw execError;
      }
    } catch (error) {
      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        errorMessage = error.message;

        // Check if ripgrep is not installed
        if (errorMessage.includes('command not found') || errorMessage.includes('not recognized')) {
          errorMessage = 'ripgrep (rg) command not found. Please install ripgrep to use this tool.';
        }
      }

      return createErrorResult(errorMessage, call.id);
    }
  }

  private buildRipgrepArgs(options: {
    pattern: string;
    path: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    includePattern?: string;
    excludePattern?: string;
    maxResults: number;
    contextLines: number;
  }): string[] {
    const args = ['--line-number', '--with-filename'];

    if (!options.caseSensitive) {
      args.push('--ignore-case');
    }

    if (options.wholeWord) {
      args.push('--word-regexp');
    }

    if (options.includePattern) {
      args.push('--glob', `"${options.includePattern}"`);
    }

    if (options.excludePattern) {
      args.push('--glob', `!"${options.excludePattern}"`);
    }

    if (options.maxResults > 0) {
      args.push('--max-count', options.maxResults.toString());
    }

    if (options.contextLines > 0) {
      args.push('--context', options.contextLines.toString());
    }

    // Add pattern and path (escape quotes in pattern)
    args.push(`"${options.pattern.replace(/"/g, '\\"')}"`);
    args.push(`"${options.path}"`);

    return args;
  }

  private parseRipgrepOutput(output: string): SearchMatch[] {
    if (!output.trim()) {
      return [];
    }

    const lines = output.trim().split('\n');
    const matches: SearchMatch[] = [];

    for (const line of lines) {
      // ripgrep format: path:lineNumber:content
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (match) {
        matches.push({
          path: match[1],
          lineNumber: parseInt(match[2], 10),
          content: match[3],
        });
      }
    }

    return matches;
  }

  private formatResults(matches: SearchMatch[], pattern: string): string {
    if (matches.length === 0) {
      return `No matches found for pattern: ${pattern}`;
    }

    const resultLines = [`Found ${matches.length} match${matches.length === 1 ? '' : 'es'}:\n`];

    // Group matches by file
    const fileGroups = new Map<string, SearchMatch[]>();
    for (const match of matches) {
      if (!fileGroups.has(match.path)) {
        fileGroups.set(match.path, []);
      }
      fileGroups.get(match.path)!.push(match);
    }

    for (const [filePath, fileMatches] of fileGroups) {
      resultLines.push(`${filePath}:`);
      for (const match of fileMatches) {
        resultLines.push(`  ${match.lineNumber}: ${match.content}`);
      }
      resultLines.push('');
    }

    return resultLines.join('\n');
  }
}
